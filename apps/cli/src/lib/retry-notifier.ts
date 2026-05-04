import { isAICliError, type OutputWriter } from '@marmot-sh/core';

/**
 * Build an `onRetry` callback that prints a one-line stderr notice when a
 * retry fires. Use this on every verb that wraps a paid provider call so the
 * cost trade-off (silently double-billing on flake) stays visible to the
 * user.
 *
 * Output shape: `[retry 1/3] tavily search: HTTP 429 — backing off 800ms`
 */
export function makeRetryNotifier(
  stderr: OutputWriter,
  provider: string,
  verb: string,
  retries: number,
): (attempt: number, error: unknown, delayMs: number) => void {
  return (attempt, error, delayMs) => {
    const raw = isAICliError(error) ? error.message : String(error);
    const truncated = raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
    stderr.write(
      `[retry ${attempt + 1}/${retries}] ${provider} ${verb}: ${truncated}, backing off ${delayMs}ms\n`,
    );
  };
}
