import { readFile } from 'node:fs/promises';

import {
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_VIDEO_DEFAULT_MODELS,
  type ProviderSlug,
} from '@marmot-sh/core';
import {
  assertProviderEnabled,
  resolveProviderAuth,
} from '@marmot-sh/core';
import { AICliError } from '@marmot-sh/core';
import {
  readPromptFile,
  resolveUserPath,
  warnText,
  type StdinReader,
} from '@marmot-sh/core';
import { sniffStdin } from '../lib/stdin-sniff.js';
import { parseProviderOptions } from '../lib/provider-options.js';
import {
  DEFAULT_RETRY_BASE_DELAY_MS,
  isRetryableProviderError,
  runWithRetries,
} from '@marmot-sh/core';
import { readMarmotConfig, resolveVideoDefaults } from '@marmot-sh/core';
import { withSpinner, type StatusStream } from '@marmot-sh/core';
import {
  renderVideoBinaryOutput,
  renderVideoFileEnvelopeJson,
  renderVideoFileOutput,
} from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';
import {
  resolveVideoRunInput,
  type ResolvedVideoRunInput,
} from '@marmot-sh/core';
import type {
  NormalizedVideoRunResult,
  ProviderVideoGenerateResult,
  ProviderVideoImageInput,
} from '@marmot-sh/core';
import { mimeFromExtension, sniffImageMime } from '@marmot-sh/core';
import {
  getProviderAdapter,
  type ProviderAdapter,
} from '../providers/index.js';
import { ensureAutoConfig, formatNoProvidersHint } from '../lib/auto-config.js';
import { withUsageLogging } from '../lib/usage-recorder.js';
import { resolveSessionBinding } from '../lib/session-binding.js';
import { isDryRun, emitDryRun } from '../lib/dry-run.js';

const VIDEO_CAPABLE_HINT =
  'Try --provider openrouter or --provider vercel (only those route video generation today).';

export type VideoRunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  output?: string;
  prompt?: string;
  promptFile?: string;
  aspect?: string;
  resolution?: string;
  duration?: string | number;
  fps?: string | number;
  audio?: boolean;
  image?: string[];
  n?: string | number;
  seed?: string | number;
  binary?: boolean;
  b64?: boolean;
  json?: boolean;
  retries?: string | number;
  timeout?: string | number;
  session?: string;
  preset?: string;
  preset_id?: string;
  providerOption?: string[];
};

type VideoRunCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: StatusStream;
  stdin?: StdinReader;
  fetchFn?: typeof fetch;
  now?: () => Date;
  cwd?: string;
  resolveProvider?: (provider: ProviderSlug) => ProviderAdapter;
  sleep?: (milliseconds: number) => Promise<void>;
  retryBaseDelayMs?: number;
};

export type VideoRunCommandOutcome = {
  result: ProviderVideoGenerateResult;
  rendered: NormalizedVideoRunResult | null;
  input: ResolvedVideoRunInput;
  adapter: ProviderAdapter;
  resolvedOutputPath: string | null;
  timestamp: string;
};

async function loadImagesFromPaths(
  paths: string[],
): Promise<ProviderVideoImageInput[]> {
  const out: ProviderVideoImageInput[] = [];
  for (const p of paths) {
    const resolved = resolveUserPath(p);
    let buf: Buffer;
    try {
      buf = await readFile(resolved);
    } catch (error) {
      throw new AICliError('io', `Failed to read --image "${resolved}".`, {
        cause: error,
      });
    }
    const data = new Uint8Array(buf);
    const mimeType =
      sniffImageMime(data) ?? mimeFromExtension(resolved) ?? 'image/png';
    out.push({ data, mimeType });
  }
  return out;
}

export async function handleVideoRunCommand(
  promptParts: string[],
  options: VideoRunCommandOptions,
  dependencies: VideoRunCommandDependencies = {},
): Promise<VideoRunCommandOutcome> {
  const env = dependencies.env ?? process.env;
  const stderr = dependencies.stderr ?? process.stderr;
  const resolveProvider = dependencies.resolveProvider ?? getProviderAdapter;
  const sessionBinding = await resolveSessionBinding(options, env);
  // Preset-supplied `prompt` (concat rule in engine) prepends positional args.
  const positionalPrompt = promptParts.join(' ');
  const inlinePrompt = options.prompt
    ? [options.prompt, positionalPrompt].filter((s) => s.trim().length > 0).join('\n\n')
    : positionalPrompt;

  const promptFile = options.promptFile
    ? await readPromptFile(options.promptFile)
    : undefined;

  // Sniff stdin so a piped image (PNG/JPEG/WebP/GIF) becomes first-frame
  // conditioning instead of being decoded as UTF-8 and shoved into the
  // prompt. Mirrors the run-modality pattern from `marmot run`. Audio /
  // video / PDF stdin is rejected because video models don't accept
  // those as conditioning. Text stdin still folds into the prompt as
  // before. Empty pipes warn so an upstream failure isn't silent.
  const stdinSource = (dependencies.stdin ?? process.stdin) as StdinReader;
  const sniffed = await sniffStdin(stdinSource);
  let stdinContent: string | undefined;
  let stdinImagePayload: { bytes: Uint8Array; mimeType: string } | null = null;
  switch (sniffed.kind) {
    case 'tty':
      break;
    case 'empty-pipe':
      if (
        inlinePrompt.trim().length > 0
        || promptFile?.content.trim().length
      ) {
        stderr.write(
          `${warnText('[video] stdin was piped but empty (upstream command may have failed). Falling back to other prompt sources.')}\n`,
        );
      }
      break;
    case 'text':
      stdinContent = sniffed.text;
      break;
    case 'image':
      stdinImagePayload = { bytes: sniffed.bytes, mimeType: sniffed.mimeType };
      break;
    case 'audio':
    case 'video':
    case 'file':
      throw new AICliError(
        'validation',
        `marmot video doesn't accept ${sniffed.kind} input via stdin. Pipe an image (PNG/JPEG/WebP/GIF) for first-frame conditioning, or pass text for the prompt.`,
      );
  }

  // The two-image cap (first-frame + last-frame) is enforced in the core
  // schema against imagePaths. Stdin image counts toward the cap but
  // isn't visible to that validator, so check the combined total here.
  const explicitImageCount = options.image?.length ?? 0;
  if (explicitImageCount + (stdinImagePayload ? 1 : 0) > 2) {
    throw new AICliError(
      'validation',
      '--image accepts at most two references (first-frame + last-frame). A piped stdin image counts toward this limit.',
    );
  }

  // Same auto-config pattern as the other AI verbs: with a --provider
  // override we just read; otherwise we ensure the config has a video
  // default by walking the pecking order and writing the first one that
  // has credentials in env. Persists so subsequent runs are zero-config.
  const config = options.provider
    ? await readMarmotConfig(env)
    : await ensureAutoConfig('video', { env, stderr: dependencies.stderr });
  let defaults: ReturnType<typeof resolveVideoDefaults>;
  try {
    defaults = resolveVideoDefaults(config, {
      provider: options.provider,
      model: options.model,
    });
  } catch (error) {
    if (error instanceof AICliError && error.category === 'validation' && !options.provider) {
      throw new AICliError('validation', formatNoProvidersHint('video'));
    }
    throw error;
  }

  const input = resolveVideoRunInput({
    provider: defaults.provider,
    model: defaults.model,
    apiKey: options.apiKey,
    outputPath: options.output,
    promptFilePath: promptFile?.path,
    inlinePrompt,
    promptFileContent: promptFile?.content,
    stdinContent: stdinContent ?? undefined,
    aspect: options.aspect,
    resolution: options.resolution,
    duration: options.duration,
    fps: options.fps,
    audio: options.audio,
    imagePaths: options.image ?? [],
    n: options.n,
    seed: options.seed,
    binary: Boolean(options.binary),
    b64: Boolean(options.b64),
    json: Boolean(options.json),
    retries: options.retries,
    timeoutSeconds: options.timeout,
  });

  const adapter = resolveProvider(input.provider);

  if (!adapter.capabilities.video || !adapter.generateVideo) {
    throw new AICliError(
      'validation',
      `${adapter.name} does not support video generation. ${VIDEO_CAPABLE_HINT}`,
    );
  }

  assertProviderEnabled(input.provider, config);
  const { apiKey } = resolveProviderAuth(input.provider, config, env, {
    apiKey: input.apiKey,
  });

  if (adapter.requiresApiKey && !apiKey) {
    const envVar = PROVIDER_API_KEY_ENV_VARS[input.provider];
    throw new AICliError(
      'auth',
      `${adapter.name} requires --api-key or ${envVar}.`,
    );
  }

  const model =
    input.model
    ?? adapter.defaultVideoModel
    ?? PROVIDER_VIDEO_DEFAULT_MODELS[input.provider];

  if (!model) {
    throw new AICliError(
      'validation',
      `${adapter.name} has no default video model configured. Pass --model.`,
    );
  }

  // Optional image conditioning -- read from disk and hand bytes to the
  // adapter. Position 0 = first-frame / single ref; position 1 = last-frame.
  // A piped stdin image takes position 0, pushing any explicit --image
  // flags one slot over (so `cat first.png | marmot video --image last.png`
  // does the natural thing: stdin = first frame, flag = last frame).
  const fileImages = await loadImagesFromPaths(input.imagePaths);
  const images: ProviderVideoImageInput[] = stdinImagePayload
    ? [{ data: stdinImagePayload.bytes, mimeType: stdinImagePayload.mimeType }, ...fileImages]
    : fileImages;

  const videoFlags: Record<string, string | number | boolean> = {};
  if (input.aspect) videoFlags.aspect = input.aspect;
  if (input.resolution) videoFlags.resolution = input.resolution;
  if (typeof input.duration === 'number') videoFlags.duration = input.duration;
  if (typeof input.fps === 'number') videoFlags.fps = input.fps;
  if (typeof input.n === 'number') videoFlags.n = input.n;
  if (typeof input.seed === 'number') videoFlags.seed = input.seed;
  if (typeof input.audio === 'boolean') videoFlags.audio = input.audio;

  if (isDryRun(env)) {
    const stdout = dependencies.stdout ?? process.stdout;
    emitDryRun(
      {
        verb: 'video',
        provider: input.provider,
        model,
        request: {
          prompt_chars: input.prompt.length,
          images: images.length,
          aspect: input.aspect,
          resolution: input.resolution,
          duration: input.duration,
          fps: input.fps,
          n: input.n,
          seed: input.seed,
          audio: input.audio,
        },
        retries: input.retries,
        timeoutMs: input.timeoutMs,
      },
      stdout,
    );
    const now = dependencies.now ?? (() => new Date());
    return {
      result: {
        provider: input.provider,
        model,
        videos: [],
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        finishReason: null,
      },
      rendered: null,
      input,
      adapter,
      resolvedOutputPath: null,
      timestamp: now().toISOString(),
    };
  }

  const { result } = await withUsageLogging(
    config,
    {
      verb: 'video',
      provider: input.provider,
      model,
      preset_id: options.preset_id,
      flags: videoFlags,
      flag_presence: { prompt: true, images: images.length > 0 },
      session: sessionBinding?.name ?? null,
      sensitive: { prompt: input.prompt },
    },
    async () => {
      const out = await withSpinner(
        `Generating ${adapter.name} video…`,
        () =>
          runWithRetries(
            (abortSignal) =>
              adapter.generateVideo!({
                model,
                prompt: input.prompt,
                aspectRatio: input.aspect,
                resolution: input.resolution,
                duration: input.duration,
                fps: input.fps,
                n: input.n,
                seed: input.seed,
                audio: input.audio,
                images,
                providerOptions: parseProviderOptions(options.providerOption),
                apiKey,
                fetchFn: dependencies.fetchFn,
                abortSignal,
              }),
            {
              retries: input.retries,
              timeoutMs: input.timeoutMs,
              baseDelayMs: dependencies.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
              shouldRetry: isRetryableProviderError,
              sleep: dependencies.sleep,
            },
          ),
        { stream: stderr, env },
      );
      return {
        result: out,
        cached: false,
        quantity: { videos: out.videos.length },
        cost: null,
      };
    },
    env,
  );

  const stdout = dependencies.stdout ?? process.stdout;
  const now = dependencies.now ?? (() => new Date());

  // TTY-aware default output: file write + path on stdout when running
  // interactively; raw bytes on stdout when piped (only for n=1).
  const noExplicitOutput =
    !input.binary && !input.b64 && !input.json && !input.outputPath;
  const stdoutIsTTY = Boolean(stdout.isTTY);
  const autoBinary = noExplicitOutput && !stdoutIsTTY && input.n === 1;

  let rendered: NormalizedVideoRunResult | null = null;

  if (input.binary || autoBinary) {
    renderVideoBinaryOutput(
      result,
      stdout as unknown as { write: (chunk: Uint8Array) => boolean },
    );
  } else if (input.b64) {
    // For now treat b64 the same as JSON envelope -- emit a JSON object
    // with base64 video data. Mirror once we add a dedicated b64 renderer.
    const payload = {
      ok: true as const,
      provider: result.provider,
      model: result.model,
      videos: result.videos.map((v) => ({
        format: v.mimeType.split('/')[1] ?? 'mp4',
        b64: Buffer.from(v.data).toString('base64'),
        bytes: v.data.byteLength,
      })),
    };
    writeLine(stdout, JSON.stringify(payload, null, 2));
  } else {
    rendered = await renderVideoFileOutput({
      result,
      outputPath: input.outputPath,
      provider: input.provider,
      cwd: dependencies.cwd,
      now,
    });
    if (input.json) {
      writeLine(stdout, renderVideoFileEnvelopeJson(rendered));
    } else {
      for (const clip of rendered.videos) {
        if (clip.path) writeLine(stdout, clip.path);
      }
    }
  }

  return {
    result,
    rendered,
    input,
    adapter,
    resolvedOutputPath: rendered?.videos[0]?.path ?? null,
    timestamp: now().toISOString(),
  };
}
