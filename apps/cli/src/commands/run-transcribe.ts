import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import {
  readMarmotConfig,
  resolveTranscriptionDefaults,
} from '@marmot-sh/core';
import {
  PROVIDER_API_KEY_ENV_VARS,
  type ProviderSlug,
} from '@marmot-sh/core';
import {
  assertProviderEnabled,
  resolveProviderAuth,
} from '@marmot-sh/core';
import { AICliError, toAICliError } from '@marmot-sh/core';
import { sniffAudioMime } from '@marmot-sh/core';
import { parseProviderOptions } from '../lib/provider-options.js';
import {
  readStdin,
  type StdinReader,
} from '@marmot-sh/core';
import { resolveUserPath } from '@marmot-sh/core';
import {
  DEFAULT_RETRY_BASE_DELAY_MS,
  isRetryableProviderError,
  runWithRetries,
} from '@marmot-sh/core';
import { withSpinner, type StatusStream } from '@marmot-sh/core';
import { renderTranscribeOutput } from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';
import {
  getProviderAdapter,
  type ProviderAdapter,
} from '../providers/index.js';
import {
  resolveTranscribeRunInput,
  type ResolvedTranscribeRunInput,
} from '@marmot-sh/core';
import type {
  NormalizedTranscribeRunResult,
  ProviderTranscribeResult,
} from '@marmot-sh/core';
import { keySource as resolveKeySource } from '@marmot-sh/core';
import { logCallToSession, resolveSessionBinding } from '../lib/session-binding.js';
import { ensureAutoConfig, formatNoProvidersHint } from '../lib/auto-config.js';

const TRANSCRIBE_CAPABLE_HINT =
  'Try --provider openai, --provider openrouter, --provider vercel, or --provider cloudflare.';

const MIME_BY_EXT: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
};

export type TranscribeRunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  input?: string;
  output?: string;
  language?: string;
  prompt?: string;
  format?: string;
  text?: boolean;
  json?: boolean;
  retries?: string | number;
  timeout?: string | number;
  session?: string;
  providerOption?: string[];
};

type TranscribeRunCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: StatusStream;
  stdin?: StdinReader;
  fetchFn?: typeof fetch;
  now?: () => Date;
  resolveProvider?: (provider: ProviderSlug) => ProviderAdapter;
  sleep?: (milliseconds: number) => Promise<void>;
  retryBaseDelayMs?: number;
  readAudioBytesFromStdin?: () => Promise<Uint8Array | null>;
};

export type TranscribeRunCommandOutcome = {
  result: ProviderTranscribeResult;
  rendered: NormalizedTranscribeRunResult;
  input: ResolvedTranscribeRunInput;
  adapter: ProviderAdapter;
  resolvedOutputPath: string | null;
  timestamp: string;
};

async function readBinaryStdin(): Promise<Uint8Array | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return null;
  return new Uint8Array(Buffer.concat(chunks));
}

export async function handleTranscribeRunCommand(
  audioPathArg: string | undefined,
  options: TranscribeRunCommandOptions,
  dependencies: TranscribeRunCommandDependencies = {},
): Promise<TranscribeRunCommandOutcome> {
  const env = dependencies.env ?? process.env;
  const sessionBinding = await resolveSessionBinding(options, env);
  const startedAtMs = Date.now();
  const stderr = dependencies.stderr ?? process.stderr;
  const resolveProvider = dependencies.resolveProvider ?? getProviderAdapter;

  // Resolve audio source: positional arg → --input → stdin
  const explicitPath = audioPathArg ?? options.input;
  let audioBytes: Uint8Array | null = null;
  let audioMimeType: string | undefined;

  if (explicitPath) {
    const resolved = resolveUserPath(explicitPath);
    try {
      const buf = await readFile(resolved);
      audioBytes = new Uint8Array(buf);
      const ext = extname(resolved).slice(1).toLowerCase();
      audioMimeType = MIME_BY_EXT[ext];
    } catch (error) {
      throw new AICliError(
        'io',
        `Failed to read audio file "${resolved}".`,
        { cause: error },
      );
    }
  } else {
    // Try stdin. When bytes arrive without an extension to infer from,
    // sniff magic numbers (mp3 / wav / flac / ogg / m4a) so the
    // adapter can label the audio correctly. Without this, OpenRouter
    // rejects the request with a 400 -- the upstream `marmot speak`
    // emits valid mp3 bytes but transcribe was sending them with no
    // mime hint.
    audioBytes = dependencies.readAudioBytesFromStdin
      ? await dependencies.readAudioBytesFromStdin()
      : await readBinaryStdin();
    if (audioBytes && audioBytes.byteLength > 0) {
      audioMimeType = sniffAudioMime(audioBytes);
    }
  }

  if (!audioBytes || audioBytes.byteLength === 0) {
    throw new AICliError(
      'validation',
      'Provide an audio file via positional arg, --input <path>, or piped stdin.',
    );
  }

  const config = options.provider
    ? await readMarmotConfig(env)
    : await ensureAutoConfig('transcription', { env, stderr: dependencies.stderr });
  let defaults: ReturnType<typeof resolveTranscriptionDefaults>;
  try {
    defaults = resolveTranscriptionDefaults(config, {
      provider: options.provider,
      model: options.model,
    });
  } catch (error) {
    if (error instanceof AICliError && error.category === 'validation' && !options.provider) {
      throw new AICliError('validation', formatNoProvidersHint('transcription'));
    }
    throw error;
  }

  // --json is sugar for --format json; explicit --format wins if both passed.
  const resolvedFormat = options.format ?? (options.json ? 'json' : undefined);
  const input = resolveTranscribeRunInput({
    provider: defaults.provider,
    model: defaults.model,
    apiKey: options.apiKey,
    audioPath: explicitPath,
    outputPath: options.output,
    language: options.language,
    prompt: options.prompt,
    format: resolvedFormat,
    text: Boolean(options.text),
    retries: options.retries,
    timeoutSeconds: options.timeout,
  });

  // Suppress unused stdin reader (kept for tests/advanced injection).
  void readStdin;

  const adapter = resolveProvider(input.provider);

  if (!adapter.capabilities.transcription || !adapter.transcribe) {
    throw new AICliError(
      'validation',
      `${adapter.name} does not support transcription. ${TRANSCRIBE_CAPABLE_HINT}`,
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

  const model = input.model ?? adapter.defaultTranscriptionModel;
  if (!model) {
    throw new AICliError(
      'validation',
      `${adapter.name} has no default transcription model configured. Pass --model.`,
    );
  }

  // Transcription model lists are hardcoded curated sets. Skip cache
  // validation; provider API rejects invalid model ids cleanly.

  const result = await withSpinner(
    `Transcribing with ${adapter.name}…`,
    () =>
      runWithRetries(
        (abortSignal) =>
          adapter.transcribe!({
            model,
            audio: audioBytes!,
            audioMimeType,
            language: input.language,
            prompt: input.prompt,
            format: input.format,
            providerOptions: parseProviderOptions(options.providerOption),
            apiKey,
            cloudflareAccountId,
            fetchFn: dependencies.fetchFn,
            abortSignal,
          }),
        {
          retries: input.retries,
          timeoutMs: input.timeoutMs,
          baseDelayMs:
            dependencies.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
          shouldRetry: isRetryableProviderError,
          sleep: dependencies.sleep,
        },
      ),
    { stream: stderr, env },
  ).catch((error) => {
    throw toAICliError(
      error,
      'provider',
      `${adapter.name} transcription failed for model "${model}".`,
    );
  });

  const stdout = dependencies.stdout ?? process.stdout;
  const now = dependencies.now ?? (() => new Date());

  const { rendered, stdoutBody, filePath } = await renderTranscribeOutput({
    result,
    format: input.format,
    textOnly: input.text,
    outputPath: input.outputPath,
    now,
  });

  writeLine(stdout, stdoutBody);

  await logCallToSession(
    sessionBinding,
    {
      verb: 'transcribe',
      provider: input.provider,
      model,
      startedAtMs,
      finishedAtMs: Date.now(),
      input: { files: 1 },
      tokens: undefined,
      keySource: resolveKeySource(
        apiKey,
        [PROVIDER_API_KEY_ENV_VARS[input.provider]].filter((v): v is string => v !== null),
        env,
      ),
      exit: 'ok',
    },
    env,
  );

  return {
    result,
    rendered,
    input,
    adapter,
    resolvedOutputPath: filePath ?? null,
    timestamp: now().toISOString(),
  };
}
