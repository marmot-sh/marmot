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
  readStdin,
  resolveUserPath,
  type StdinReader,
} from '@marmot-sh/core';
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

const VIDEO_CAPABLE_HINT =
  'Try --provider openrouter or --provider vercel (only those route video generation today).';

export type VideoRunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  output?: string;
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
  const inlinePrompt = promptParts.join(' ');

  const promptFile = options.promptFile
    ? await readPromptFile(options.promptFile)
    : undefined;
  const stdinContent = await readStdin(dependencies.stdin);

  // Video provider auto-config isn't wired yet (only openrouter and vercel
  // route video; the user picks one). Plain config read; no auto-discover.
  const config = await readMarmotConfig(env);
  const defaults = resolveVideoDefaults(config, {
    provider: options.provider,
    model: options.model,
  });

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
  const images = await loadImagesFromPaths(input.imagePaths);

  const result = await withSpinner(
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
