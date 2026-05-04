import {
  appendLogRecord,
  getSession,
  resolveActiveSession,
  type AppendLogInput,
  type LogRecord,
  type SessionMeta,
  type Verb,
} from '@marmot-sh/core';
import type { ProviderSlug } from '@marmot-sh/core';

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
  preset?: string;
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
    preset: input.preset,
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
