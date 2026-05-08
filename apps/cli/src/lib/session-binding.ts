import {
  appendLogRecord,
  getSession,
  isUsageLoggingEnabled,
  recordUsage,
  resolveActiveSession,
  shouldRecordSensitive,
  type AppendLogInput,
  type LogRecord,
  type MarmotConfig,
  type RecordUsageInput,
  type SessionMeta,
  type Verb,
} from '@marmot-sh/core';
import type { ProviderSlug } from '@marmot-sh/core';

import { categorizeError } from './usage-recorder.js';

export type SessionBinding = {
  name: string;
  meta: SessionMeta;
};

/**
 * Resolve which session this call is bound to.
 * Precedence: explicit --session flag > current-session pointer > none.
 * Returns null if neither is set, in which case the call is not logged.
 *
 * Any verb may bind to any session. Chat-mode behavior (history prepend +
 * append) only fires for the text verb; other verbs just log normally.
 */
export async function resolveSessionBinding(
  options: { session?: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionBinding | null> {
  const name = await resolveActiveSession(options.session, env);
  if (!name) return null;
  const meta = await getSession(name, env);
  return { name, meta };
}

export type CallLogInput = {
  verb: Verb;
  provider: ProviderSlug;
  model?: string;
  /** Stable preset id (UUID) when a preset was applied. Slug is resolved
   *  at render time. */
  preset_id?: string;
  startedAtMs: number;
  finishedAtMs: number;
  input?: AppendLogInput['input'];
  tokens?: AppendLogInput['tokens'];
  keySource?: string;
  prompt?: string;
  system?: string;
  exit: 'ok' | 'error';
  errorCategory?: string;
  errorMessage?: string;
};

/**
 * Append a log record for the call to the bound session. Redaction is
 * enforced inside appendLogRecord based on the session's record_prompts
 * flag — callers do not need to pre-redact. No-op if no binding.
 */
export async function logCallToSession(
  binding: SessionBinding | null,
  input: CallLogInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LogRecord | null> {
  if (!binding) return null;

  const candidate: AppendLogInput = {
    verb: input.verb,
    provider: input.provider,
    model: input.model,
    preset_id: input.preset_id,
    duration_ms: Math.max(0, input.finishedAtMs - input.startedAtMs),
    input: input.input,
    tokens: input.tokens,
    key_source: input.keySource,
    prompt: input.prompt,
    system: input.system,
    exit: input.exit,
    error_category: input.errorCategory,
    error_message: input.errorMessage,
  };

  return appendLogRecord(binding.name, candidate, env);
}

/** Extra usage-record fields that the AI verbs supply alongside the
 *  CallLogInput. Privacy-safe by construction — keep it that way. */
export type UsageExtras = {
  /** Non-sensitive flag values (temperature, max-tokens, top-p, reasoning,
   *  stream, n, size, voice, format, etc.). */
  flags?: Record<string, string | number | boolean>;
  /** Boolean presence of sensitive flags (prompt, system, schema, images,
   *  files). NEVER pass values. */
  flag_presence?: Record<string, boolean>;
  /** USD cost when the provider reported it (OpenRouter `costCredits`,
   *  AI Gateway, etc.). null if not reported. */
  cost?: number | null;
  /** Stable id for joining records on the same request/task. AI verbs
   *  let this default to a fresh UUID; async verbs pass the provider's
   *  task id so submit/poll/completion records share one identifier. */
  request_id?: string;
  /** Opt-in audit payload. Persisted only when
   *  `config.logging.recordSensitive = true` (or
   *  `MARMOT_RECORD_SENSITIVE=1` is set). Caller always builds it; the
   *  recorder gates persistence. */
  sensitive?: RecordUsageInput['sensitive'];
};

/**
 * Unified call recorder for AI verbs. Always writes a privacy-safe usage
 * record to `~/.marmot/usage/<UTC-DATE>.jsonl` (subject to the global
 * disable). Additionally writes a session log record when a session is
 * bound. Replacing direct calls to logCallToSession with this keeps the
 * two log paths in lockstep and ensures the usage log captures every
 * metered call regardless of session binding.
 */
export async function recordCall(
  binding: SessionBinding | null,
  input: CallLogInput,
  extras: UsageExtras = {},
  config: MarmotConfig | null = null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  // 1. Session log (existing behavior).
  await logCallToSession(binding, input, env);

  // 2. Usage log (new in 0.5.0). Best-effort.
  if (!isUsageLoggingEnabled(config, env)) return;

  // Translate session-log token shape to the verb-aware quantity bag.
  const quantity: Record<string, number> = {};
  if (input.tokens) {
    if (typeof input.tokens.input === 'number') quantity.tokens_input = input.tokens.input;
    if (typeof input.tokens.output === 'number') quantity.tokens_output = input.tokens.output;
    if (typeof input.tokens.cache_read === 'number') quantity.tokens_cache_read = input.tokens.cache_read;
    if (typeof input.tokens.cache_write === 'number') quantity.tokens_cache_write = input.tokens.cache_write;
  }

  const sensitive = shouldRecordSensitive(config, env) ? extras.sensitive : undefined;

  await recordUsage(
    {
      request_id: extras.request_id,
      verb: input.verb,
      provider: input.provider,
      model: input.model,
      preset_id: input.preset_id,
      flags: extras.flags,
      flag_presence: extras.flag_presence,
      cached: false,
      duration_ms: Math.max(0, input.finishedAtMs - input.startedAtMs),
      cost: extras.cost ?? null,
      quantity: Object.keys(quantity).length > 0 ? quantity : undefined,
      exit: input.exit,
      error_category: input.errorCategory ?? (input.exit === 'error' ? categorizeError(undefined) : undefined),
      session: binding?.name ?? null,
      sensitive,
    },
    env,
  );
}
