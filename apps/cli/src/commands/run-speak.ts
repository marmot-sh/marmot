import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { playAudioFile } from '@marmot-sh/core';
import { readMarmotConfig, resolveSpeechDefaults } from '@marmot-sh/core';
import {
  PROVIDER_API_KEY_ENV_VARS,
  type ProviderSlug,
} from '@marmot-sh/core';
import {
  assertProviderEnabled,
  resolveProviderAuth,
} from '@marmot-sh/core';
import { AICliError, toAICliError } from '@marmot-sh/core';
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
import { withSpinner, type StatusStream } from '@marmot-sh/core';
import {
  renderSpeechB64EnvelopeJson,
  renderSpeechB64Output,
} from '@marmot-sh/core';
import { renderSpeechBinaryOutput } from '@marmot-sh/core';
import {
  renderSpeechFileEnvelopeJson,
  renderSpeechFileOutput,
} from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';
import {
  getProviderAdapter,
  type ProviderAdapter,
} from '../providers/index.js';
import {
  resolveSpeechRunInput,
  type ResolvedSpeechRunInput,
} from '@marmot-sh/core';
import type {
  NormalizedSpeechRunResult,
  ProviderSpeechResult,
} from '@marmot-sh/core';
import { keySource as resolveKeySource } from '@marmot-sh/core';
import { logCallToSession, resolveSessionBinding } from '../lib/session-binding.js';
import { ensureAutoConfig, formatNoProvidersHint } from '../lib/auto-config.js';

export type SpeechRunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  output?: string;
  promptFile?: string;
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
  binary?: boolean;
  b64?: boolean;
  json?: boolean;
  play?: boolean;
  wait?: boolean;
  retries?: string | number;
  timeout?: string | number;
  session?: string;
};

type SpeechRunCommandDependencies = {
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

export type SpeechRunCommandOutcome = {
  result: ProviderSpeechResult;
  rendered: NormalizedSpeechRunResult | null;
  input: ResolvedSpeechRunInput;
  adapter: ProviderAdapter;
  timestamp: string;
};

const SPEECH_CAPABLE_HINT =
  'Try --provider openai, --provider openrouter, --provider vercel, or --provider cloudflare.';

export async function handleSpeechRunCommand(
  textParts: string[],
  options: SpeechRunCommandOptions,
  dependencies: SpeechRunCommandDependencies = {},
): Promise<SpeechRunCommandOutcome> {
  const env = dependencies.env ?? process.env;
  const sessionBinding = await resolveSessionBinding(options, env);
  const startedAtMs = Date.now();
  const stderr = dependencies.stderr ?? process.stderr;
  const resolveProvider = dependencies.resolveProvider ?? getProviderAdapter;
  const inlineText = textParts.join(' ');

  const promptFile = options.promptFile
    ? await readPromptFile(options.promptFile)
    : undefined;
  const stdinContent = await readStdin(dependencies.stdin);

  const config = options.provider
    ? await readMarmotConfig(env)
    : await ensureAutoConfig('speech', { env, stderr: dependencies.stderr });
  let defaults: ReturnType<typeof resolveSpeechDefaults>;
  try {
    defaults = resolveSpeechDefaults(config, {
      provider: options.provider,
      model: options.model,
      voice: options.voice,
    });
  } catch (error) {
    if (error instanceof AICliError && error.category === 'validation' && !options.provider) {
      throw new AICliError('validation', formatNoProvidersHint('speech'));
    }
    throw error;
  }

  const input = resolveSpeechRunInput({
    provider: defaults.provider,
    model: defaults.model,
    apiKey: options.apiKey,
    outputPath: options.output,
    promptFilePath: promptFile?.path,
    inlineText,
    promptFileContent: promptFile?.content,
    stdinContent: stdinContent ?? undefined,
    voice: defaults.voice,
    format: options.format,
    speed: options.speed,
    instructions: options.instructions,
    binary: Boolean(options.binary),
    b64: Boolean(options.b64),
    json: Boolean(options.json),
    play: Boolean(options.play),
    wait: Boolean(options.wait),
    retries: options.retries,
    timeoutSeconds: options.timeout,
  });

  const adapter = resolveProvider(input.provider);

  if (!adapter.capabilities.speech || !adapter.generateSpeech) {
    throw new AICliError(
      'validation',
      `${adapter.name} does not support speech generation. ${SPEECH_CAPABLE_HINT}`,
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

  const model = input.model ?? adapter.defaultSpeechModel;
  if (!model) {
    throw new AICliError(
      'validation',
      `${adapter.name} has no default speech model configured. Pass --model.`,
    );
  }

  // Speech model lists are hardcoded curated sets (3–5 per provider).
  // Skip cache validation; the provider API will reject invalid model ids
  // with a clean error.

  const result = await withSpinner(
    `Generating ${adapter.name} speech…`,
    () =>
      runWithRetries(
        (abortSignal) =>
          adapter.generateSpeech!({
            model,
            text: input.text,
            voice: input.voice,
            format: input.format,
            speed: input.speed,
            instructions: input.instructions,
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
      `${adapter.name} speech generation failed for model "${model}".`,
    );
  });

  const stdout = dependencies.stdout ?? process.stdout;
  const now = dependencies.now ?? (() => new Date());

  // TTY-aware default: when no explicit output flag is set, play if interactive,
  // emit binary if piped/redirected. This matches user intuition — typing
  // `marmot speak "hi"` in a terminal speaks; piping it gives bytes.
  const noExplicitOutput =
    !input.binary
    && !input.b64
    && !input.json
    && !input.play
    && !input.outputPath;
  const stdoutIsTTY = Boolean(stdout.isTTY);
  const autoPlay = noExplicitOutput && stdoutIsTTY;
  const autoBinary = noExplicitOutput && !stdoutIsTTY;

  // Explicit --play: play AND emit bytes downstream when piped. On a TTY there
  // is nothing downstream, so just play. This lets the user fan out audio with
  // a single flag instead of needing `tee >(afplay -)` shell tricks.
  const explicitPlayWithDownstream = input.play && !stdoutIsTTY;

  let rendered: NormalizedSpeechRunResult | null = null;

  if (input.binary || autoBinary) {
    renderSpeechBinaryOutput(result, stdout as unknown as { write: (chunk: Uint8Array) => boolean });
  } else if (input.b64) {
    rendered = renderSpeechB64Output({
      result,
      formatHint: input.format,
      now,
    });
    writeLine(stdout, renderSpeechB64EnvelopeJson(rendered));
  } else {
    // For --play (or auto-TTY-play) without explicit -o, write to a temp file
    // and clean up after playback.
    const shouldPlay = input.play || autoPlay;
    const ephemeral = shouldPlay && !input.outputPath;
    const tempPath = ephemeral
      ? join(tmpdir(), `marmot-speak-${Date.now()}.${input.format ?? 'mp3'}`)
      : undefined;

    rendered = await renderSpeechFileOutput({
      result,
      formatHint: input.format,
      outputPath: input.outputPath ?? tempPath,
      provider: input.provider,
      cwd: dependencies.cwd,
      now,
    });

    if (shouldPlay && rendered.audio.path) {
      // Auto-play (TTY default) blocks like --play --wait so the user actually
      // hears it before the prompt comes back. Explicit --play without --wait
      // keeps the previous detach-and-return behavior.
      const blockUntilDone = input.wait || autoPlay;
      if (blockUntilDone) {
        try {
          await playAudioFile(rendered.audio.path, { background: false });
        } finally {
          if (ephemeral) {
            await rm(rendered.audio.path, { force: true });
          }
        }
      } else {
        await playAudioFile(rendered.audio.path, {
          background: true,
          cleanupAfter: ephemeral ? rendered.audio.path : undefined,
        });
      }
    }

    if (!ephemeral) {
      if (input.json) {
        writeLine(stdout, renderSpeechFileEnvelopeJson(rendered));
      } else if (rendered.audio.path) {
        // Default: print just the file path — pipe-friendly.
        writeLine(stdout, rendered.audio.path);
      }
    }
  }

  // --play piped to a non-TTY: also emit bytes downstream so chains like
  // `marmot speak --play | marmot transcribe` both play and continue.
  if (explicitPlayWithDownstream && !input.binary && !input.b64) {
    renderSpeechBinaryOutput(result, stdout as unknown as { write: (chunk: Uint8Array) => boolean });
  }

  await logCallToSession(
    sessionBinding,
    {
      verb: 'speak',
      provider: input.provider,
      model,
      startedAtMs,
      finishedAtMs: Date.now(),
      input: { prompt_chars: input.text.length },
      tokens: undefined,
      keySource: resolveKeySource(
        apiKey,
        [PROVIDER_API_KEY_ENV_VARS[input.provider]].filter((v): v is string => v !== null),
        env,
      ),
      prompt: input.text,
      exit: 'ok',
    },
    env,
  );

  return {
    result,
    rendered,
    input,
    adapter,
    timestamp: now().toISOString(),
  };
}
