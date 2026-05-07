import {
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
  type ProviderSlug,
} from '@marmot-sh/core';
import {
  assertProviderEnabled,
  resolveProviderAuth,
} from '@marmot-sh/core';
import { AICliError } from '@marmot-sh/core';
import { parseProviderOptions } from '../lib/provider-options.js';
import {
  readPromptFile,
  readStdin,
  type StdinReader,
} from '@marmot-sh/core';
import {
  DEFAULT_RETRY_BASE_DELAY_MS,
  isRetryableProviderError,
  runWithRetries,
} from '@marmot-sh/core';
import { readMarmotConfig, resolveImageDefaults } from '@marmot-sh/core';
import { withSpinner, type StatusStream } from '@marmot-sh/core';
import { renderImageBinaryOutput } from '@marmot-sh/core';
import {
  detectImagePreviewProtocol,
  emitImagePreview,
} from '@marmot-sh/core';
import {
  renderImageB64EnvelopeJson,
  renderImageB64Output,
} from '@marmot-sh/core';
import {
  renderImageFileEnvelopeJson,
  renderImageFileOutput,
} from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';
import {
  getProviderAdapter,
  type ProviderAdapter,
} from '../providers/index.js';
import {
  resolveImageRunInput,
  type ResolvedImageRunInput,
} from '@marmot-sh/core';
import type {
  NormalizedImageRunResult,
  ProviderImageGenerateResult,
} from '@marmot-sh/core';
import { keySource as resolveKeySource } from '@marmot-sh/core';
import { recordCall, resolveSessionBinding } from '../lib/session-binding.js';
import { ensureAutoConfig, formatNoProvidersHint } from '../lib/auto-config.js';

export type ImageRunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  output?: string;
  promptFile?: string;
  n?: string | number;
  size?: string;
  quality?: string;
  style?: string;
  seed?: string | number;
  negative?: string;
  binary?: boolean;
  b64?: boolean;
  json?: boolean;
  retries?: string | number;
  timeout?: string | number;
  session?: string;
  providerOption?: string[];
  // Commander binds --no-preview to `preview: false` (default true).
  preview?: boolean;
};

type ImageRunCommandDependencies = {
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

export type ImageRunCommandOutcome = {
  result: ProviderImageGenerateResult;
  rendered: NormalizedImageRunResult | null;
  input: ResolvedImageRunInput;
  adapter: ProviderAdapter;
  resolvedOutputPath: string | null;
  timestamp: string;
};

const IMAGE_CAPABLE_HINT = 'Try --provider openai, --provider openrouter, --provider vercel, or --provider cloudflare.';

export async function handleImageRunCommand(
  promptParts: string[],
  options: ImageRunCommandOptions,
  dependencies: ImageRunCommandDependencies = {},
): Promise<ImageRunCommandOutcome> {
  const env = dependencies.env ?? process.env;
  const sessionBinding = await resolveSessionBinding(options, env);
  const startedAtMs = Date.now();
  const stderr = dependencies.stderr ?? process.stderr;
  const resolveProvider = dependencies.resolveProvider ?? getProviderAdapter;
  const inlinePrompt = promptParts.join(' ');

  const promptFile = options.promptFile
    ? await readPromptFile(options.promptFile)
    : undefined;
  const stdinContent = await readStdin(dependencies.stdin);

  // Apply config defaults so flag > config > image-capable fallback.
  const config = options.provider
    ? await readMarmotConfig(env)
    : await ensureAutoConfig('image', { env, stderr: dependencies.stderr });
  let defaults: ReturnType<typeof resolveImageDefaults>;
  try {
    defaults = resolveImageDefaults(config, {
      provider: options.provider,
      model: options.model,
    });
  } catch (error) {
    if (error instanceof AICliError && error.category === 'validation' && !options.provider) {
      throw new AICliError('validation', formatNoProvidersHint('image'));
    }
    throw error;
  }

  const input = resolveImageRunInput({
    provider: defaults.provider,
    model: defaults.model,
    apiKey: options.apiKey,
    outputPath: options.output,
    promptFilePath: promptFile?.path,
    inlinePrompt,
    promptFileContent: promptFile?.content,
    stdinContent: stdinContent ?? undefined,
    n: options.n,
    size: options.size,
    quality: options.quality,
    style: options.style,
    seed: options.seed,
    negative: options.negative,
    binary: Boolean(options.binary),
    b64: Boolean(options.b64),
    json: Boolean(options.json),
    retries: options.retries,
    timeoutSeconds: options.timeout,
  });

  const adapter = resolveProvider(input.provider);

  if (!adapter.capabilities.image || !adapter.generateImage) {
    throw new AICliError(
      'validation',
      `${adapter.name} does not support image generation. ${IMAGE_CAPABLE_HINT}`,
    );
  }

  assertProviderEnabled(input.provider, config);
  const { apiKey, apiSecret } = resolveProviderAuth(input.provider, config, env, {
    apiKey: input.apiKey,
  });
  const cloudflareAccountId = input.provider === 'cloudflare' ? apiSecret : undefined;

  if (adapter.requiresApiKey && !apiKey) {
    const envVar = PROVIDER_API_KEY_ENV_VARS[input.provider];
    throw new AICliError(
      'auth',
      `${adapter.name} requires --api-key or ${envVar}.`,
    );
  }

  if (input.provider === 'cloudflare' && !cloudflareAccountId) {
    throw new AICliError(
      'auth',
      'Cloudflare Workers AI requires CLOUDFLARE_ACCOUNT_ID.',
    );
  }

  const model = input.model
    ?? adapter.defaultImageModel
    ?? PROVIDER_IMAGE_DEFAULT_MODELS[input.provider];

  if (!model) {
    throw new AICliError(
      'validation',
      `${adapter.name} has no default image model configured. Pass --model.`,
    );
  }

  // Image model lists are mostly small curated sets (OpenAI/Cloudflare).
  // OpenRouter has hundreds but the chat-completions endpoint rejects
  // unknown ids cleanly. Skip cache validation here; we'll add a proper
  // image-cache store as a follow-up if cataloging becomes useful.

  const result = await withSpinner(
    `Generating ${adapter.name} image…`,
    () =>
      runWithRetries(
        (abortSignal) =>
          adapter.generateImage!({
            model,
            prompt: input.prompt,
            n: input.n,
            size: input.size,
            quality: input.quality,
            style: input.style,
            seed: input.seed,
            negative: input.negative,
            providerOptions: parseProviderOptions(options.providerOption),
            apiKey,
            cloudflareAccountId,
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

  // TTY-aware default: when no explicit output flag is set and the user only
  // wants one image, emit binary on a piped stdout (so `marmot image "..." > out.png`
  // works). On a TTY, fall through to the file-write+path branch which is also
  // safe for n > 1.
  const noExplicitOutput =
    !input.binary && !input.b64 && !input.json && !input.outputPath;
  const stdoutIsTTY = Boolean(stdout.isTTY);
  const autoBinary = noExplicitOutput && !stdoutIsTTY && input.n === 1;

  let rendered: NormalizedImageRunResult | null = null;

  if (input.binary || autoBinary) {
    renderImageBinaryOutput(result, stdout as unknown as { write: (chunk: Uint8Array) => boolean });
  } else if (input.b64) {
    rendered = renderImageB64Output({
      result,
      requestedSize: input.size,
      now,
    });
    writeLine(stdout, renderImageB64EnvelopeJson(rendered));
  } else {
    rendered = await renderImageFileOutput({
      result,
      requestedSize: input.size,
      outputPath: input.outputPath,
      provider: input.provider,
      cwd: dependencies.cwd,
      now,
    });
    if (input.json) {
      writeLine(stdout, renderImageFileEnvelopeJson(rendered));
    } else {
      // Default: print one file path per line — pipe-friendly. The JSON
      // envelope is still available via --json.
      for (const img of rendered.images) {
        if (img.path) writeLine(stdout, img.path);
      }
      maybeEmitInlinePreview({
        result,
        env,
        stderr,
        stdoutIsTTY,
        previewOptIn: options.preview !== false,
      });
    }
  }

  // Privacy-safe usage extras. Image flags are non-sensitive; prompt body
  // and negative prompt are recorded as boolean presence only.
  const imageFlags: Record<string, string | number | boolean> = {};
  if (typeof input.n === 'number') imageFlags.n = input.n;
  if (input.size) imageFlags.size = input.size;
  if (input.quality) imageFlags.quality = input.quality;
  if (input.style) imageFlags.style = input.style;
  if (typeof input.seed === 'number') imageFlags.seed = input.seed;

  await recordCall(
    sessionBinding,
    {
      verb: 'image',
      provider: input.provider,
      model,
      startedAtMs,
      finishedAtMs: Date.now(),
      input: { prompt_chars: input.prompt.length, files: 0, images: 0 },
      tokens: undefined,
      keySource: resolveKeySource(
        apiKey,
        [PROVIDER_API_KEY_ENV_VARS[input.provider]].filter((v): v is string => v !== null),
        env,
      ),
      prompt: input.prompt,
      exit: 'ok',
    },
    {
      flags: imageFlags,
      flag_presence: { prompt: true, negative: Boolean(input.negative) },
      cost: null,
      sensitive: {
        prompt: input.prompt,
        ...(input.negative ? { flags: { negative: input.negative } } : {}),
      },
    },
    config,
    env,
  );

  return {
    result,
    rendered,
    input,
    adapter,
    resolvedOutputPath: rendered?.images[0]?.path ?? null,
    timestamp: now().toISOString(),
  };
}

function maybeEmitInlinePreview(input: {
  result: ProviderImageGenerateResult;
  env: NodeJS.ProcessEnv;
  stderr: StatusStream;
  stdoutIsTTY: boolean;
  previewOptIn: boolean;
}): void {
  if (!input.previewOptIn) return;
  if (!input.stdoutIsTTY) return; // Skip when piped — preview escape codes would corrupt output.
  if (!input.stderr.isTTY) return; // Need a real terminal on stderr to render.
  const protocol = detectImagePreviewProtocol(input.env);
  if (protocol === 'none') return;
  for (const image of input.result.images) {
    emitImagePreview(image.data, protocol, input.stderr as unknown as Parameters<typeof emitImagePreview>[2]);
  }
}

export { resolveImageRunInput } from '@marmot-sh/core';
