import { AICliError, isAICliError } from './errors.js';

export const DEFAULT_GENERATION_TIMEOUT_MS = 120_000;
export const DEFAULT_RETRY_BASE_DELAY_MS = 500;
export const MAX_RETRIES = 10;
const MAX_RETRY_DELAY_MS = 8_000;

/**
 * Normalize raw `--retries` / `--timeout` CLI string inputs into the numeric
 * pair every verb's retry wrapper expects. Throws `AICliError('validation')`
 * on out-of-range values. Defaults match the AI verb behavior:
 *   - retries: 0 (no retries)
 *   - timeout: DEFAULT_GENERATION_TIMEOUT_MS (120s)
 */
export function resolveRetryOptions(input: {
  retries?: string | number;
  timeout?: string | number;
}): { retries: number; timeoutMs: number } {
  const retries = parseRangedInt(input.retries, 0);
  const timeoutSeconds = parseRangedInt(
    input.timeout,
    DEFAULT_GENERATION_TIMEOUT_MS / 1_000,
  );

  if (retries === null || retries < 0 || retries > MAX_RETRIES) {
    throw new AICliError(
      'validation',
      `--retries must be an integer between 0 and ${MAX_RETRIES} (got "${input.retries}").`,
    );
  }

  if (timeoutSeconds === null || timeoutSeconds < 1 || timeoutSeconds > 86_400) {
    throw new AICliError(
      'validation',
      `--timeout must be an integer between 1 and 86400 seconds (got "${input.timeout}").`,
    );
  }

  return { retries, timeoutMs: timeoutSeconds * 1_000 };
}

/**
 * Strict numeric parse: undefined → fallback, empty/whitespace strings → null,
 * non-integer or NaN → null. Caller decides what counts as a valid range.
 */
function parseRangedInt(
  value: string | number | undefined,
  fallback: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

type RetryOptions = {
  retries: number;
  timeoutMs: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  shouldRetry?: (error: unknown) => boolean;
  /**
   * Called once per failed attempt that will be retried (not called on the
   * final failure or on success). `attempt` is 0-indexed: the first retry
   * fires `onRetry(0, ...)`. Use to surface retry status to stderr or logs.
   */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
};

export async function runWithRetries<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= options.retries) {
    try {
      return await runWithTimeout(operation, options.timeoutMs);
    } catch (error) {
      lastError = error;

      if (
        attempt >= options.retries ||
        !(options.shouldRetry ?? isRetryableProviderError)(error)
      ) {
        throw error;
      }

      const delayMs = getRetryDelay(attempt, options.baseDelayMs);
      options.onRetry?.(attempt, error, delayMs);
      await (options.sleep ?? sleep)(delayMs);
      attempt += 1;
    }
  }

  throw lastError;
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!isAICliError(error)) {
    return true;
  }

  return error.category === 'network' || error.category === 'provider';
}

async function runWithTimeout<T>(
  operation: (abortSignal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new AICliError(
        'provider',
        `Generation timed out after ${formatTimeoutSeconds(timeoutMs)} seconds.`,
      ));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      operation(controller.signal),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

function getRetryDelay(attempt: number, baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS): number {
  return Math.min(baseDelayMs * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function formatTimeoutSeconds(timeoutMs: number): string {
  const seconds = timeoutMs / 1_000;
  if (Number.isInteger(seconds)) {
    return String(seconds);
  }

  return seconds < 1 ? String(seconds) : seconds.toFixed(1);
}
