import { writeLine, type OutputWriter } from '@marmot-sh/core';

/** Permissive stdout shape — matches both `process.stdout` and the
 *  reduced `{ write(s: string): boolean | void }` writer used by the
 *  data/web verbs. We only ever pass strings into `write`, and we
 *  ignore the return value, so the precise signature doesn't matter. */
type DryRunStdout = OutputWriter | { write(s: string): boolean | void };

/** Returns true when `--dry-run` was on the command line for this
 *  invocation. The flag is stripped from argv in cli.ts and surfaced
 *  via MARMOT_DRY_RUN=1 so every verb can check it without per-verb
 *  commander wiring. */
export function isDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MARMOT_DRY_RUN === '1';
}

export type DryRunPayload = {
  verb: string;
  provider: string;
  model?: string | null;
  /** Privacy-safe summary of the request body that would be sent.
   *  Verbs include the user-meaningful flags (query, urls, prompt
   *  presence, sampling controls). Don't include API keys or fetchFn
   *  references. */
  request: Record<string, unknown>;
  retries?: number;
  timeoutMs?: number;
  /** USD cost when the locally-cached model catalog reports a price
   *  for this model (OpenRouter today). null otherwise — no static
   *  pricing tables, no scraping. */
  cost?: number | null;
};

/** Print the resolved invocation plan as a JSON envelope and return.
 *  Verbs call this after option resolution + auth + adapter lookup,
 *  before the actual provider call. */
export function emitDryRun(
  payload: DryRunPayload,
  stdout: DryRunStdout,
): void {
  const envelope = {
    ok: true as const,
    dry_run: true as const,
    verb: payload.verb,
    provider: payload.provider,
    model: payload.model ?? null,
    request: payload.request,
    retries: payload.retries ?? 0,
    timeout_ms: payload.timeoutMs ?? null,
    cost: payload.cost ?? null,
  };
  writeLine(stdout as OutputWriter, JSON.stringify(envelope, null, 2));
}
