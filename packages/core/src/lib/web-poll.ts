import { AICliError } from './errors.js';

export type PollOutcome<T> = { done: true; value: T } | { done: false };

export type RunWithPollingOptions<T> = {
  /** Called once per tick. Return {done: true, value} to finish. */
  poll: () => Promise<PollOutcome<T>>;
  /** Cap total wall time. Default 15 minutes. */
  maxWaitMs?: number;
  /**
   * Cadence in ms. Each tick uses the next entry, then the last one repeats
   * for the rest. Default: [2000, 5000, 10000, 15000].
   */
  schedule?: number[];
  /** Fraction of jitter to add. 0.2 = ±20%. Default 0.2. */
  jitter?: number;
  abortSignal?: AbortSignal;
  /** Optional callback fired before each delay (for spinner updates). */
  onTick?: (info: { attempt: number; delayMs: number }) => void;
};

const DEFAULT_SCHEDULE = [2_000, 5_000, 10_000, 15_000];
const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000;

/**
 * Generic polling helper used by --wait on async verbs (research/crawl/findall).
 * Calls `poll` on a backoff schedule until it returns {done: true} or wall-time
 * exceeds maxWaitMs. Honors AbortSignal between ticks.
 *
 * Throws AICliError('network', 'timed out') after maxWaitMs.
 * Throws AICliError('network', 'cancelled') if the abort signal fires.
 */
export async function runWithPolling<T>(
  options: RunWithPollingOptions<T>,
): Promise<T> {
  const schedule = options.schedule ?? DEFAULT_SCHEDULE;
  const maxWait = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const jitter = options.jitter ?? 0.2;
  const start = Date.now();

  let attempt = 0;
  while (true) {
    if (options.abortSignal?.aborted) {
      throw new AICliError('network', 'Polling cancelled before first tick.');
    }

    // First call is immediate; subsequent calls wait per schedule.
    if (attempt > 0) {
      const baseDelay = schedule[Math.min(attempt - 1, schedule.length - 1)]!;
      const j = baseDelay * jitter * (Math.random() * 2 - 1);
      const delay = Math.max(0, Math.round(baseDelay + j));
      options.onTick?.({ attempt, delayMs: delay });

      const elapsed = Date.now() - start;
      if (elapsed + delay > maxWait) {
        throw new AICliError(
          'network',
          `Polling exceeded ${Math.round(maxWait / 1000)}s without completion.`,
        );
      }

      await sleepWithAbort(delay, options.abortSignal);
    }

    // Errors from poll() bubble up — caller decides retry policy.
    const outcome: PollOutcome<T> = await options.poll();
    if (outcome.done) return outcome.value;

    attempt += 1;
    if (Date.now() - start > maxWait) {
      throw new AICliError(
        'network',
        `Polling exceeded ${Math.round(maxWait / 1000)}s without completion.`,
      );
    }
  }
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AICliError('network', 'Polling cancelled.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AICliError('network', 'Polling cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
