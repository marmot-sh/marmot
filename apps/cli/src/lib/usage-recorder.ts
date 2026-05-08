import {
  isUsageLoggingEnabled,
  recordUsage,
  shouldRecordSensitive,
  type AICliError,
  type MarmotConfig,
  type RecordUsageInput,
} from '@marmot-sh/core';

/** Timing helper: capture start, return a function that records the call
 *  with elapsed duration. Caller passes the rest of the record (verb,
 *  provider, exit, etc.) at the end of the call. */
export function startCallTimer(): { startedAtMs: number } {
  return { startedAtMs: Date.now() };
}

export type FinishCallInput = Omit<RecordUsageInput, 'ts' | 'duration_ms' | 'exit'> & {
  startedAtMs: number;
  exit?: 'ok' | 'error';
};

/** Finalize a recording from a timer + outcome fields. Best-effort:
 *  recordUsage swallows errors so a logging failure never poisons the
 *  caller's response. No-op when logging is disabled (config or
 *  MARMOT_NO_LOG=1). */
export async function finishCall(
  config: MarmotConfig | null,
  input: FinishCallInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (!isUsageLoggingEnabled(config, env)) return;
  const { startedAtMs, exit, ...rest } = input;
  await recordUsage(
    {
      ...rest,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      exit: exit ?? 'ok',
    },
    env,
  );
}

/** Categorize an error for the `error_category` field. Mirrors the
 *  AICliError category set with a fallback for native errors. */
export function categorizeError(error: unknown): string {
  if (error && typeof error === 'object' && 'category' in error) {
    const category = (error as AICliError).category;
    if (typeof category === 'string') return category;
  }
  return 'io';
}

export type UsageMetadata = Pick<
  RecordUsageInput,
  'verb' | 'provider' | 'model' | 'preset_id' | 'flags' | 'flag_presence' | 'session' | 'call_id'
> & {
  /** Opt-in audit payload. Caller passes the actual prompt/query/URLs/
   *  identifier values; the recorder includes them only when
   *  `config.logging.recordSensitive = true` (or
   *  `MARMOT_RECORD_SENSITIVE=1` is set). Default-off; never written
   *  unless explicitly opted in. */
  sensitive?: RecordUsageInput['sensitive'];
};

export type UsageBodyResult<T> = {
  result: T;
  cached: boolean;
  quantity?: Record<string, number>;
  cost?: number | null;
};

/** Wrap a verb's metered call body with usage logging. On success records
 *  duration + cached + quantity + cost. On failure records exit='error'
 *  with categorized error. Re-throws so callers handle errors normally.
 *
 *  Use this AFTER provider resolution and validation — pre-call validation
 *  errors should not log a "failed call" entry. */
export async function withUsageLogging<T>(
  config: MarmotConfig | null,
  meta: UsageMetadata,
  body: () => Promise<UsageBodyResult<T>>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ result: T; cached: boolean }> {
  const startedAtMs = Date.now();
  // Strip sensitive payload unless the user opted in. The caller always
  // builds it (cheap), but it's only persisted when audit mode is on.
  const sensitive = shouldRecordSensitive(config, env) ? meta.sensitive : undefined;
  const persistedMeta = { ...meta, sensitive };
  try {
    const out = await body();
    await finishCall(
      config,
      {
        ...persistedMeta,
        startedAtMs,
        cached: out.cached,
        quantity: out.quantity,
        cost: out.cost ?? null,
      },
      env,
    );
    return { result: out.result, cached: out.cached };
  } catch (error) {
    await finishCall(
      config,
      {
        ...persistedMeta,
        startedAtMs,
        cached: false,
        exit: 'error',
        error_category: categorizeError(error),
      },
      env,
    );
    throw error;
  }
}
