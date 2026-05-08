import { ensureProviderCache } from '@marmot-sh/core';
import {
  assertProviderEnabled,
  getOllamaApiBaseUrl,
  resolveProviderAuth,
} from '@marmot-sh/core';
import { readFile } from 'node:fs/promises';

import {
  openOutputFileStream,
  readPromptFile,
  writeOutputFile,
  type StdinReader,
} from '@marmot-sh/core';
import { readStdinAsBytes, sniffStdin } from '../lib/stdin-sniff.js';
import { parseProviderOptions } from '../lib/provider-options.js';
import { mimeFromExtension, sniffImageMime, sniffPdfMime } from '@marmot-sh/core';
import type { FilePart, ImagePart } from '@marmot-sh/core';
import { AICliError, toAICliError } from '@marmot-sh/core';
import { resolveUserPath, warnText } from '@marmot-sh/core';
import {
  DEFAULT_RETRY_BASE_DELAY_MS,
  isRetryableProviderError,
  runWithRetries,
} from '@marmot-sh/core';
import { resolveStructuredSchema } from '@marmot-sh/core';
import { renderJsonOutput } from '@marmot-sh/core';
import { renderTextOutput } from '@marmot-sh/core';
import { renderObjectJsonOutput } from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';
import { info, succeed, withSpinner, type StatusStream } from '@marmot-sh/core';
import { readMarmotConfig, resolveTextDefaults } from '@marmot-sh/core';
import {
  getProviderAdapter,
  type ProviderAdapter,
} from '../providers/index.js';
import { resolveRunInput } from '@marmot-sh/core';
import type {
  NormalizedObjectRunResult,
  NormalizedRunResult,
} from '@marmot-sh/core';
import { PROVIDER_API_KEY_ENV_VARS, type ProviderSlug } from '@marmot-sh/core';
import type {
  MarmotConfig,
  NormalizedUsageSummary,
  ProviderModelCacheEntry,
  ResolvedRunInput,
} from '@marmot-sh/core';
import { computeTextCallCost, resolveTextPricing } from '@marmot-sh/core';
import {
  appendChatMessage,
  chatMessagesToHistory,
  keySource as resolveKeySource,
  readChatMessages,
  type ChatHistoryEntry,
} from '@marmot-sh/core';
import { recordCall, resolveSessionBinding, type SessionBinding } from '../lib/session-binding.js';
import { categorizeError } from '../lib/usage-recorder.js';
import { assertNoCommandConfusion } from '../lib/command-typo.js';
import { ensureAutoConfig, formatNoProvidersHint } from '../lib/auto-config.js';

/**
 * Choose where to set Anthropic-style cache_control breakpoints. For chat-mode
 * sessions we mark both system and the last user message so subsequent turns
 * hit the cached prefix. OpenAI auto-caches; OpenRouter / Vercel Claude
 * routing is a follow-up. Returns undefined when no breakpoints apply.
 */
function pickCacheBreakpoints(
  execution: { input: { provider: string; system?: string } },
  sessionMode: string | undefined,
): { system?: boolean; lastUserMessage?: boolean } | undefined {
  if (sessionMode !== 'chat') return undefined;
  if (execution.input.provider !== 'anthropic') return undefined;
  return {
    system: Boolean(execution.input.system),
    lastUserMessage: true,
  };
}

/**
 * For chat-mode bindings, append the user prompt and assistant reply to
 * messages.jsonl. No-op for stateless sessions or null bindings. Called
 * only on the success path; failed calls don't poison the conversation.
 */
async function appendChatTurn(
  binding: SessionBinding | null,
  prompt: string,
  reply: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (!binding || binding.meta.mode !== 'chat') return;
  await appendChatMessage(binding.name, { role: 'user', content: prompt }, env);
  await appendChatMessage(binding.name, { role: 'assistant', content: reply }, env);
}

/** Log a failed run-verb adapter call to session log + usage log. The
 *  success path uses recordCall directly with full result-derived data;
 *  the error path passes a stub (no tokens, no cost) plus the error
 *  category so `marmot usage --failed-only` surfaces it. */
async function recordRunError(
  sessionBinding: SessionBinding | null,
  execution: PreparedRunExecution,
  startedAtMs: number,
  error: unknown,
  options: { preset_id?: string },
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await recordCall(
    sessionBinding,
    {
      verb: 'run',
      provider: execution.input.provider as ProviderSlug,
      model: execution.input.model ?? undefined,
      preset_id: options.preset_id,
      startedAtMs,
      finishedAtMs: Date.now(),
      input: {
        prompt_chars: execution.input.prompt.length,
        system_chars: execution.input.system?.length,
        files: execution.files?.length ?? 0,
        images: execution.images?.length ?? 0,
      },
      keySource: resolveKeySource(
        execution.apiKey,
        [PROVIDER_API_KEY_ENV_VARS[execution.input.provider as ProviderSlug]].filter((v): v is string => v !== null),
        env,
      ),
      prompt: execution.input.prompt,
      system: execution.input.system,
      exit: 'error',
      errorCategory: categorizeError(error),
    },
    buildRunUsageExtras(execution, null, execution.input.prompt, execution.input.system),
    execution.config,
    env,
  );
}

/** Build privacy-safe usage extras for a run-verb call. Non-sensitive
 *  sampling controls go in `flags`; prompt/system/schema bodies are
 *  recorded as boolean presence only. Cost is read from OpenRouter's
 *  per-call cost when reported (NormalizedUsageSummary.costCredits). */
function buildRunUsageExtras(
  execution: { input: { temperature?: number; maxOutputTokens?: number; topP?: number; seed?: number; reasoning?: string; stream?: boolean; system?: string; schema?: unknown }; images?: unknown[]; files?: unknown[] },
  usage: { costCredits?: number | null } | null | undefined,
  prompt?: string,
  system?: string,
): {
  flags?: Record<string, string | number | boolean>;
  flag_presence?: Record<string, boolean>;
  cost: number | null;
  sensitive?: { prompt?: string; system?: string; schema?: string };
} {
  const flags: Record<string, string | number | boolean> = {};
  if (typeof execution.input.temperature === 'number') flags.temperature = execution.input.temperature;
  if (typeof execution.input.maxOutputTokens === 'number') flags.max_tokens = execution.input.maxOutputTokens;
  if (typeof execution.input.topP === 'number') flags.top_p = execution.input.topP;
  if (typeof execution.input.seed === 'number') flags.seed = execution.input.seed;
  if (execution.input.reasoning) flags.reasoning = execution.input.reasoning;
  if (execution.input.stream) flags.stream = true;
  const sensitive: { prompt?: string; system?: string; schema?: string } = {};
  if (typeof prompt === 'string') sensitive.prompt = prompt;
  if (typeof system === 'string') sensitive.system = system;
  if (execution.input.schema && typeof execution.input.schema === 'object') {
    try {
      sensitive.schema = JSON.stringify(execution.input.schema);
    } catch {
      /* skip non-serializable schema */
    }
  } else if (typeof execution.input.schema === 'string') {
    sensitive.schema = execution.input.schema;
  }
  return {
    flags: Object.keys(flags).length > 0 ? flags : undefined,
    flag_presence: {
      prompt: true,
      system: Boolean(execution.input.system),
      schema: Boolean(execution.input.schema),
      images: (execution.images?.length ?? 0) > 0,
      files: (execution.files?.length ?? 0) > 0,
    },
    cost: typeof usage?.costCredits === 'number' ? usage.costCredits : null,
    sensitive: Object.keys(sensitive).length > 0 ? sensitive : undefined,
  };
}

export type RunCommandOptions = {
  provider?: string;
  model?: string;
  apiKey?: string;
  output?: string;
  schema?: string;
  schemaFile?: string;
  schemaModule?: string;
  system?: string;
  systemFile?: string;
  promptFile?: string;
  image?: string[];
  imageMime?: string;
  file?: string[];
  fileMime?: string;
  textStdin?: boolean;
  temperature?: string | number;
  maxTokens?: string | number;
  topP?: string | number;
  seed?: string | number;
  stop?: string[];
  reasoning?: 'low' | 'medium' | 'high';
  providerOption?: string[];
  text?: boolean;
  json?: boolean;
  stream?: boolean;
  retries?: string | number;
  timeout?: string | number;
  session?: string;
  preset?: string;
  preset_id?: string;
};

type RunCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: StatusStream;
  stdin?: StdinReader;
  fetchFn?: typeof fetch;
  now?: () => Date;
  resolveProvider?: (provider: ProviderSlug) => ProviderAdapter;
  sleep?: (milliseconds: number) => Promise<void>;
  retryBaseDelayMs?: number;
};

export type RunCommandOutcome = {
  result: NormalizedRunResult | NormalizedObjectRunResult;
  renderedOutput: string;
  text: boolean;
};

/**
 * Returns true if the user clearly assembled a prompt with intent
 * (--prompt-file, --system-file, --image, or --file). When true, we skip
 * the typo check — the single positional is part of a richer input, not
 * a bare command-shaped token.
 *
 * We deliberately do NOT inspect stdin. `process.stdin.isTTY` is
 * `undefined` in many real terminal contexts (notably when the CLI is
 * spawned as a child process), so it's not a reliable signal. The typo
 * guard's worst case on a piped invocation like `echo foo | marmot search`
 * is a clear error pointing at how to quote — easier to recover from
 * than burning tokens on a typo.
 */
function hasOtherPromptInput(options: RunCommandOptions): boolean {
  if (options.promptFile) return true;
  if (options.systemFile) return true;
  if (options.image && options.image.length > 0) return true;
  if (options.file && options.file.length > 0) return true;
  return false;
}

export async function handleRunCommand(
  promptParts: string[],
  options: RunCommandOptions,
  dependencies: RunCommandDependencies = {},
): Promise<RunCommandOutcome> {
  // Guard the most common confused-CLI mistake before reading stdin or
  // hitting any provider: `marmot search` (intending the command) or
  // `marmot serach` (typo) silently becoming a paid AI prompt.
  assertNoCommandConfusion(promptParts, hasOtherPromptInput(options));
  const env = dependencies.env ?? process.env;
  const sessionBinding = await resolveSessionBinding(options, env);
  const startedAtMs = Date.now();
  const execution = await prepareRunExecution(promptParts, options, dependencies);
  const stderr = dependencies.stderr ?? process.stderr;

  const history: readonly ChatHistoryEntry[] | undefined =
    sessionBinding?.meta.mode === 'chat'
      ? chatMessagesToHistory(await readChatMessages(sessionBinding.name, env))
      : undefined;
  const cacheBreakpoints = pickCacheBreakpoints(execution, sessionBinding?.meta.mode);

  if (execution.input.schemaSource) {
    const schema = await resolveStructuredSchema(execution.input.schemaSource);
    let generationResult;
    try {
      generationResult = await withSpinner(
        `Generating ${execution.adapter.name} response…`,
        () =>
          runWithRetries(
            (abortSignal) =>
              execution.adapter.generateObject({
                model: execution.input.model,
                prompt: execution.input.prompt,
                system: execution.input.system,
                schema,
                apiKey: execution.apiKey,
                ollamaBaseUrl: execution.ollamaBaseUrl,
                cloudflareAccountId: execution.cloudflareAccountId,
                images: execution.images,
                files: execution.files,
                history,
                cacheBreakpoints,
                temperature: execution.input.temperature,
                maxOutputTokens: execution.input.maxOutputTokens,
                topP: execution.input.topP,
                seed: execution.input.seed,
                stopSequences: execution.input.stopSequences,
                reasoning: execution.input.reasoning,
                providerOptions: execution.input.providerOptions,
                fetchFn: dependencies.fetchFn,
                abortSignal,
              }),
            getRetryOptions(execution, dependencies),
          ),
        { stream: stderr, env },
      );
    } catch (error) {
      await recordRunError(sessionBinding, execution, startedAtMs, error, options, env);
      throw error;
    }

    const result: NormalizedObjectRunResult = {
      ok: true,
      provider: generationResult.provider,
      model: generationResult.model,
      output: generationResult.output,
      usage: attachCostToUsage(generationResult.usage, execution),
      finishReason: generationResult.finishReason,
      cachedModelValidated: true,
      outputFile: execution.resolvedOutputFile,
      timestamp: execution.timestamp,
    };

    const renderedOutput = renderObjectJsonOutput(result);

    if (result.outputFile) {
      await writeOutputFile(result.outputFile, renderedOutput);
    }

    writeLine(execution.stdout, renderedOutput);

    await recordCall(
      sessionBinding,
      {
        verb: 'run',
        provider: result.provider as ProviderSlug,
        model: result.model ?? undefined,
        startedAtMs,
        finishedAtMs: Date.now(),
        input: {
          prompt_chars: execution.input.prompt.length,
          system_chars: execution.input.system?.length,
          files: execution.files?.length ?? 0,
          images: execution.images?.length ?? 0,
        },
        tokens: {
          input: result.usage.inputTokens ?? undefined,
          output: result.usage.outputTokens ?? undefined,
          cache_read: result.usage.cachedInputTokens,
          cache_write: result.usage.cacheWriteInputTokens,
        },
        keySource: resolveKeySource(
          execution.apiKey,
          [PROVIDER_API_KEY_ENV_VARS[result.provider as ProviderSlug]].filter((v): v is string => v !== null),
          env,
        ),
        prompt: execution.input.prompt,
        system: execution.input.system,
        exit: 'ok',
      },
      buildRunUsageExtras(execution, result.usage, execution.input.prompt, execution.input.system),
      execution.config,
      env,
    );

    await appendChatTurn(
      sessionBinding,
      execution.input.prompt,
      JSON.stringify(result.output),
      env,
    );

    return {
      result,
      renderedOutput,
      text: false,
    };
  }

  let generationResult;
  try {
    generationResult = await withSpinner(
      `Generating ${execution.adapter.name} response…`,
      () =>
        runWithRetries(
          (abortSignal) =>
            execution.adapter.generate({
              model: execution.input.model,
              prompt: execution.input.prompt,
              system: execution.input.system,
              apiKey: execution.apiKey,
              ollamaBaseUrl: execution.ollamaBaseUrl,
              cloudflareAccountId: execution.cloudflareAccountId,
              images: execution.images,
              files: execution.files,
              temperature: execution.input.temperature,
              maxOutputTokens: execution.input.maxOutputTokens,
              topP: execution.input.topP,
              seed: execution.input.seed,
              stopSequences: execution.input.stopSequences,
              reasoning: execution.input.reasoning,
              providerOptions: execution.input.providerOptions,
              fetchFn: dependencies.fetchFn,
              abortSignal,
            }),
          getRetryOptions(execution, dependencies),
        ),
      { stream: stderr, env },
    );
  } catch (error) {
    await recordRunError(sessionBinding, execution, startedAtMs, error, options, env);
    throw error;
  }

  const result: NormalizedRunResult = {
    ok: true,
    provider: generationResult.provider,
    model: generationResult.model,
    text: generationResult.text,
    usage: attachCostToUsage(generationResult.usage, execution),
    finishReason: generationResult.finishReason,
    cachedModelValidated: true,
    outputFile: execution.resolvedOutputFile,
    timestamp: execution.timestamp,
  };

  const renderedOutput = execution.input.text
    ? renderTextOutput(result.text)
    : renderJsonOutput(result);

  if (result.outputFile) {
    await writeOutputFile(result.outputFile, renderedOutput);
  }

  writeLine(execution.stdout, renderedOutput);

  await recordCall(
    sessionBinding,
    {
      verb: 'run',
      provider: result.provider as ProviderSlug,
      model: result.model ?? undefined,
      startedAtMs,
      finishedAtMs: Date.now(),
      input: {
        prompt_chars: execution.input.prompt.length,
        system_chars: execution.input.system?.length,
        files: execution.files?.length ?? 0,
        images: execution.images?.length ?? 0,
      },
      tokens: {
        input: result.usage.inputTokens ?? undefined,
        output: result.usage.outputTokens ?? undefined,
        cache_read: result.usage.cachedInputTokens,
        cache_write: result.usage.cacheWriteInputTokens,
      },
      keySource: resolveKeySource(
          execution.apiKey,
          [PROVIDER_API_KEY_ENV_VARS[result.provider as ProviderSlug]].filter((v): v is string => v !== null),
          env,
        ),
      prompt: execution.input.prompt,
      system: execution.input.system,
      exit: 'ok',
    },
    buildRunUsageExtras(execution, result.usage, execution.input.prompt, execution.input.system),
    execution.config,
    env,
  );

  await appendChatTurn(sessionBinding, execution.input.prompt, result.text, env);

  return {
    result,
    renderedOutput,
    text: execution.input.text,
  };
}

export async function handleStreamRunCommand(
  promptParts: string[],
  options: RunCommandOptions,
  dependencies: RunCommandDependencies = {},
): Promise<RunCommandOutcome> {
  assertNoCommandConfusion(promptParts, hasOtherPromptInput(options));
  const env = dependencies.env ?? process.env;
  const sessionBinding = await resolveSessionBinding(options, env);
  const startedAtMs = Date.now();
  const execution = await prepareRunExecution(promptParts, {
    ...options,
    stream: true,
  }, dependencies);

  const _history: readonly ChatHistoryEntry[] | undefined =
    sessionBinding?.meta.mode === 'chat'
      ? chatMessagesToHistory(await readChatMessages(sessionBinding.name, env))
      : undefined;
  const _cacheBreakpoints = pickCacheBreakpoints(execution, sessionBinding?.meta.mode);

  let lastAttemptWroteChunks = false;

  let streamedResult;
  try {
    streamedResult = await runWithRetries(async (abortSignal) => {
    const streamed = await execution.adapter.stream({
      model: execution.input.model,
      prompt: execution.input.prompt,
      system: execution.input.system,
      apiKey: execution.apiKey,
      ollamaBaseUrl: execution.ollamaBaseUrl,
      cloudflareAccountId: execution.cloudflareAccountId,
      images: execution.images,
      files: execution.files,
      temperature: execution.input.temperature,
      maxOutputTokens: execution.input.maxOutputTokens,
      topP: execution.input.topP,
      seed: execution.input.seed,
      stopSequences: execution.input.stopSequences,
      reasoning: execution.input.reasoning,
      providerOptions: execution.input.providerOptions,
      fetchFn: dependencies.fetchFn,
      abortSignal,
    });
    const outputFile = execution.resolvedOutputFile
      ? await openOutputFileStream(execution.resolvedOutputFile)
      : undefined;
    const textParts: string[] = [];
    let endedWithNewline = false;

    lastAttemptWroteChunks = false;

    try {
      for await (const chunk of streamed.textStream) {
        lastAttemptWroteChunks = true;
        textParts.push(chunk);
        endedWithNewline = chunk.endsWith('\n');
        execution.stdout.write(chunk);
        outputFile?.stream.write(chunk);
      }

      return {
        completed: await streamed.complete,
        text: textParts.join(''),
        endedWithNewline,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Streaming generation failed for model "${execution.input.model}".`,
      );
    } finally {
      if (outputFile) {
        await outputFile.close();
      }
    }
  }, {
      ...getRetryOptions(execution, dependencies),
      shouldRetry: (error) => !lastAttemptWroteChunks && isRetryableProviderError(error),
    });
  } catch (error) {
    await recordRunError(sessionBinding, execution, startedAtMs, error, options, env);
    throw error;
  }

  if (!streamedResult.endedWithNewline) {
    execution.stdout.write('\n');
  }

  const renderedOutput = renderTextOutput(streamedResult.text);
  const result: NormalizedRunResult = {
    ok: true,
    provider: streamedResult.completed.provider,
    model: streamedResult.completed.model,
    text: streamedResult.completed.text,
    usage: attachCostToUsage(streamedResult.completed.usage, execution),
    finishReason: streamedResult.completed.finishReason,
    cachedModelValidated: true,
    outputFile: execution.resolvedOutputFile,
    timestamp: execution.timestamp,
  };

  await recordCall(
    sessionBinding,
    {
      verb: 'run',
      provider: result.provider as ProviderSlug,
      model: result.model ?? undefined,
      startedAtMs,
      finishedAtMs: Date.now(),
      input: {
        prompt_chars: execution.input.prompt.length,
        system_chars: execution.input.system?.length,
        files: execution.files?.length ?? 0,
        images: execution.images?.length ?? 0,
      },
      tokens: {
        input: result.usage.inputTokens ?? undefined,
        output: result.usage.outputTokens ?? undefined,
        cache_read: result.usage.cachedInputTokens,
        cache_write: result.usage.cacheWriteInputTokens,
      },
      keySource: resolveKeySource(
          execution.apiKey,
          [PROVIDER_API_KEY_ENV_VARS[result.provider as ProviderSlug]].filter((v): v is string => v !== null),
          env,
        ),
      prompt: execution.input.prompt,
      system: execution.input.system,
      exit: 'ok',
    },
    buildRunUsageExtras(execution, result.usage, execution.input.prompt, execution.input.system),
    execution.config,
    env,
  );

  await appendChatTurn(sessionBinding, execution.input.prompt, result.text, env);

  return {
    result,
    renderedOutput,
    text: true,
  };
}

type PreparedRunExecution = {
  input: ResolvedRunInput;
  adapter: ProviderAdapter;
  apiKey?: string;
  ollamaBaseUrl?: string;
  cloudflareAccountId?: string;
  images?: ImagePart[];
  files?: FilePart[];
  stdout: OutputWriter;
  resolvedOutputFile: string | null;
  timestamp: string;
  modelCacheEntry: ProviderModelCacheEntry | null;
  config: MarmotConfig | null;
};

type StdinPayload = { bytes: Uint8Array; mimeType?: string };

/** Map a stdin file's mimeType to the corresponding model-modality
 *  string. Audio/video/PDF all flow through the file attachment path
 *  but providers split them out under different modality names. */
function inferStdinFileModality(mimeType: string | undefined): string {
  if (!mimeType) return 'file';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

async function loadImages(
  paths: string[],
  stdinPayload: StdinPayload | null,
  mimeOverride?: string,
): Promise<ImagePart[]> {
  const parts: ImagePart[] = [];

  for (const path of paths) {
    const buf = await readFile(path);
    const data = new Uint8Array(buf);
    const mimeType =
      mimeOverride
      ?? sniffImageMime(data)
      ?? mimeFromExtension(path)
      ?? 'image/png';
    parts.push({ data, mimeType, sourceName: path });
  }

  if (stdinPayload) {
    const data = stdinPayload.bytes;
    const mimeType =
      mimeOverride ?? stdinPayload.mimeType ?? sniffImageMime(data) ?? 'image/png';
    parts.push({ data, mimeType, sourceName: '<stdin>' });
  }

  return parts;
}

async function loadFiles(
  paths: string[],
  stdinPayload: StdinPayload | null,
  mimeOverride?: string,
): Promise<FilePart[]> {
  const parts: FilePart[] = [];

  for (const path of paths) {
    const buf = await readFile(path);
    const data = new Uint8Array(buf);
    const mimeType =
      mimeOverride
      ?? sniffPdfMime(data)
      ?? mimeFromExtension(path)
      ?? 'application/octet-stream';
    parts.push({ data, mimeType, sourceName: path });
  }

  if (stdinPayload) {
    const data = stdinPayload.bytes;
    const mimeType =
      mimeOverride ?? stdinPayload.mimeType ?? sniffPdfMime(data) ?? 'application/octet-stream';
    parts.push({ data, mimeType, sourceName: '<stdin>' });
  }

  return parts;
}

async function prepareRunExecution(
  promptParts: string[],
  options: RunCommandOptions,
  dependencies: RunCommandDependencies,
): Promise<PreparedRunExecution> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const resolveProvider = dependencies.resolveProvider ?? getProviderAdapter;
  const inlinePrompt = promptParts.join(' ');
  const systemFile = options.systemFile
    ? await readPromptFile(options.systemFile)
    : undefined;
  const promptFile = options.promptFile
    ? await readPromptFile(options.promptFile)
    : undefined;

  // Image inputs: split file paths from stdin sentinel.
  const imageRefs = options.image ?? [];
  const imagePaths = imageRefs.filter((p) => p !== '-');
  const imageStdinSentinel = imageRefs.some((p) => p === '-');

  // File/PDF inputs: same convention.
  const fileRefs = options.file ?? [];
  const filePaths = fileRefs.filter((p) => p !== '-');
  const fileStdinSentinel = fileRefs.some((p) => p === '-');

  // Read stdin once, then route. Stdin carries either text, a binary
  // image, or a binary file — never more than one. If the user passed
  // an explicit `--image -` / `--file -` sentinel, honor that. Otherwise
  // sniff the first bytes: a known binary signature routes to image or
  // file automatically; anything else is treated as a text prompt
  // suffix (the historical default). `--text-stdin` forces the text
  // path even when bytes look binary.
  let stdinContent: string | null = null;
  let stdinImagePayload: StdinPayload | null = null;
  let stdinFilePayload: StdinPayload | null = null;

  if (imageStdinSentinel || fileStdinSentinel) {
    // Explicit sentinel: caller already told us what stdin is, skip
    // sniffing entirely and read raw bytes. Mime falls back to the
    // override flag, then later to magic detection inside loadImages /
    // loadFiles.
    const stdinSource = (dependencies.stdin ?? process.stdin) as StdinReader;
    const bytes = await readStdinAsBytes(stdinSource);
    if (!bytes || bytes.byteLength === 0) {
      throw new AICliError(
        'validation',
        `${imageStdinSentinel ? '--image -' : '--file -'} was passed but no bytes were piped to stdin.`,
      );
    }
    if (imageStdinSentinel) {
      stdinImagePayload = { bytes, mimeType: options.imageMime };
    } else {
      stdinFilePayload = { bytes, mimeType: options.fileMime };
    }
  } else {
    const stdinSource = (dependencies.stdin ?? process.stdin) as StdinReader;
    const sniffed = await sniffStdin(stdinSource, Boolean(options.textStdin));
    switch (sniffed.kind) {
      case 'tty':
        // No pipe attached at all.
        break;
      case 'empty-pipe':
        // Pipe attached but upstream sent zero bytes. If we have a
        // positional/file/system prompt to fall back to, warn -- this
        // usually means an upstream pipeline stage failed and the user
        // should know rather than getting a "successful" generic answer.
        if (
          inlinePrompt.trim().length > 0
          || promptFile?.content.trim().length
          || systemFile?.content.trim().length
        ) {
          const stderr = dependencies.stderr ?? process.stderr;
          stderr.write(
            `${warnText('[run] stdin was piped but empty (upstream command may have failed). Falling back to other prompt sources.')}\n`,
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
        // Audio/video/PDFs all flow through the file attachment path.
        // The model's input modalities decide whether the call succeeds.
        stdinFilePayload = { bytes: sniffed.bytes, mimeType: sniffed.mimeType };
        break;
    }
  }

  // Apply config defaults so flag > config > hardcoded fallback. When no
  // --provider override is given and no defaults exist, try auto-config
  // first so the user can run "install + set a key + marmot 'hello'"
  // without an explicit `marmot setup` step.
  const config = options.provider
    ? await readMarmotConfig(env)
    : await ensureAutoConfig('text', { env, stderr: dependencies.stderr });
  let defaults: ReturnType<typeof resolveTextDefaults>;
  try {
    defaults = resolveTextDefaults(config, {
      provider: options.provider,
      model: options.model,
    });
  } catch (error) {
    if (error instanceof AICliError && error.category === 'validation' && !options.provider) {
      throw new AICliError('validation', formatNoProvidersHint('text'));
    }
    throw error;
  }

  const input = resolveRunInput({
    provider: defaults.provider,
    model: defaults.model,
    apiKey: options.apiKey,
    outputPath: options.output,
    schema: options.schema,
    schemaFilePath: options.schemaFile,
    schemaModulePath: options.schemaModule,
    system: options.system,
    systemFilePath: systemFile?.path,
    systemFileContent: systemFile?.content,
    promptFilePath: promptFile?.path,
    inlinePrompt,
    promptFileContent: promptFile?.content,
    stdinContent: stdinContent ?? undefined,
    imagePaths,
    imageStdin: stdinImagePayload !== null,
    imageMimeOverride: options.imageMime,
    filePaths,
    fileStdin: stdinFilePayload !== null,
    fileMimeOverride: options.fileMime,
    temperature: options.temperature,
    maxOutputTokens: options.maxTokens,
    topP: options.topP,
    seed: options.seed,
    // Commander's collectStop defaults to [] when --stop isn't passed.
    // Empty arrays look like "an explicit empty value" to downstream
    // adapters and the Vercel AI SDK warns when a provider doesn't
    // implement stopSequences (Ollama). Treat absence as undefined.
    stopSequences: options.stop && options.stop.length > 0 ? options.stop : undefined,
    reasoning: options.reasoning,
    providerOptions: parseProviderOptions(options.providerOption),
    text: Boolean(options.text),
    json: Boolean(options.json),
    stream: Boolean(options.stream),
    retries: options.retries,
    timeoutSeconds: options.timeout,
  });

  assertProviderEnabled(input.provider, config);
  const adapter = resolveProvider(input.provider);
  const { apiKey, apiSecret } = resolveProviderAuth(input.provider, config, env, {
    apiKey: input.apiKey,
  });
  const ollamaBaseUrl = input.provider === 'ollama'
    ? getOllamaApiBaseUrl(env)
    : undefined;
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

  const stderr = dependencies.stderr ?? process.stderr;

  const cacheResult = await ensureProviderCache({
    provider: input.provider,
    adapter,
    apiKey,
    ollamaBaseUrl,
    cloudflareAccountId,
    fetchFn: dependencies.fetchFn,
    now: dependencies.now,
    env,
    wrapRefresh: ({ reason }, fn) => {
      const text = reason === 'missing'
        ? `Caching ${adapter.name} models…`
        : `Refreshing ${adapter.name} cache…`;
      return withSpinner(text, fn, { stream: stderr, env });
    },
  });

  if (cacheResult.refreshed && cacheResult.refreshReason === 'missing') {
    succeed(
      `Cached ${cacheResult.cache.models.length} ${adapter.name} models (24h)`,
      { stream: stderr, env },
    );
  }

  if (cacheResult.usedStaleCache) {
    info(
      `Using stale ${adapter.name} cache (refresh failed)`,
      { stream: stderr, env },
    );
  }

  const modelEntry = cacheResult.cache.models.find((model) => model.id === input.model);

  if (!modelEntry) {
    throw new AICliError(
      'validation',
      `Model "${input.model}" is not available for provider "${input.provider}". Refresh the cache with "marmot cache refresh ${input.provider}".`,
    );
  }

  // Modality capability check. Catches the "piped a PNG into a text-only
  // model" case before we waste a provider call -- without this the
  // bytes get base64-encoded into a multi-megabyte text prompt and the
  // provider rejects it as exceeding the context window.
  const requiredModality = stdinImagePayload
    ? 'image'
    : stdinFilePayload
      ? inferStdinFileModality(stdinFilePayload.mimeType)
      : (input.imagePaths.length > 0 ? 'image' : null)
        ?? (input.filePaths.length > 0 ? 'file' : null);
  if (requiredModality && !modelEntry.inputModalities.includes(requiredModality)) {
    const supported = modelEntry.inputModalities.join(', ') || 'text only';
    throw new AICliError(
      'validation',
      `Model "${input.model}" does not accept ${requiredModality} input (supports: ${supported}). Pick a multimodal model, or pass --text-stdin to send the bytes as text.`,
    );
  }

  const images = await loadImages(
    input.imagePaths,
    stdinImagePayload,
    input.imageMimeOverride,
  );
  const files = await loadFiles(
    input.filePaths,
    stdinFilePayload,
    input.fileMimeOverride,
  );

  const modelCacheEntry = cacheResult.cache.models.find((m) => m.id === input.model) ?? null;

  return {
    input,
    adapter,
    apiKey,
    ollamaBaseUrl,
    cloudflareAccountId,
    images: images.length > 0 ? images : undefined,
    files: files.length > 0 ? files : undefined,
    stdout,
    resolvedOutputFile: input.outputPath ? resolveUserPath(input.outputPath) : null,
    timestamp: (dependencies.now?.() ?? new Date()).toISOString(),
    modelCacheEntry,
    config: config ?? null,
  };
}

/**
 * Enrich a usage summary with USD cost computed from the model cache entry's
 * pricing (real, vendor-supplied) or a user config override. Returns the same
 * usage shape with `costUsd` and (when applicable) `costSource` filled in.
 * `costUsd` is `null` when no rates are known — distinct from `undefined`,
 * which would mean "not computed."
 */
function attachCostToUsage(
  usage: NormalizedUsageSummary,
  execution: PreparedRunExecution,
): NormalizedUsageSummary {
  const resolved = resolveTextPricing({
    provider: execution.input.provider,
    modelId: execution.input.model,
    cacheEntry: execution.modelCacheEntry,
    config: execution.config,
  });
  if (!resolved) {
    return { ...usage, costUsd: null };
  }
  const costUsd = computeTextCallCost({ usage, pricing: resolved.pricing });
  if (costUsd === null) {
    return { ...usage, costUsd: null };
  }
  return { ...usage, costUsd, costSource: resolved.source };
}

function getRetryOptions(
  execution: PreparedRunExecution,
  dependencies: RunCommandDependencies,
) {
  return {
    retries: execution.input.retries,
    timeoutMs: execution.input.timeoutMs,
    sleep: dependencies.sleep,
    baseDelayMs: dependencies.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
  };
}
