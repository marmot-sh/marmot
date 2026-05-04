import { describe, expect, it, vi } from 'vitest';

import { AICliError } from '../src/lib/errors.js';
import { runWithRetries } from '../src/lib/retry.js';

describe('runWithRetries', () => {
  it('retries retryable failures with exponential backoff', async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      if (operation.mock.calls.length < 3) {
        throw new AICliError('provider', 'Temporary provider failure.');
      }

      return 'ok';
    });

    await expect(runWithRetries(operation, {
      retries: 2,
      timeoutMs: 1_000,
      baseDelayMs: 10,
      sleep,
    })).resolves.toBe('ok');

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('does not retry validation errors', async () => {
    const sleep = vi.fn(async () => {});
    const operation = vi.fn(async () => {
      throw new AICliError('validation', 'bad input');
    });

    await expect(runWithRetries(operation, {
      retries: 3,
      timeoutMs: 1_000,
      sleep,
    })).rejects.toMatchObject({ category: 'validation' });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fires onRetry once per retried attempt with attempt index, error, and delay', async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const operation = vi.fn(async () => {
      if (operation.mock.calls.length < 3) {
        throw new AICliError('provider', 'flaky');
      }
      return 'ok';
    });

    await runWithRetries(operation, {
      retries: 2,
      timeoutMs: 1_000,
      baseDelayMs: 10,
      sleep,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 0, expect.any(AICliError), 10);
    expect(onRetry).toHaveBeenNthCalledWith(2, 1, expect.any(AICliError), 20);
  });

  it('does not fire onRetry on success', async () => {
    const onRetry = vi.fn();
    const operation = vi.fn(async () => 'ok');

    await runWithRetries(operation, {
      retries: 3,
      timeoutMs: 1_000,
      onRetry,
    });

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('does not fire onRetry on the final failure (only retried attempts)', async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const operation = vi.fn(async () => {
      throw new AICliError('provider', 'always fails');
    });

    await expect(runWithRetries(operation, {
      retries: 2,
      timeoutMs: 1_000,
      baseDelayMs: 10,
      sleep,
      onRetry,
    })).rejects.toMatchObject({ category: 'provider' });

    // 3 attempts total (initial + 2 retries), but onRetry fires only on the
    // first 2 (the ones followed by another attempt). The final failure
    // throws without notifying.
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('aborts the active attempt when it times out', async () => {
    let sawAbort = false;

    await expect(runWithRetries((abortSignal) => new Promise((_resolve) => {
      abortSignal.addEventListener('abort', () => {
        sawAbort = true;
      });
    }), {
      retries: 0,
      timeoutMs: 1,
    })).rejects.toMatchObject({
      category: 'provider',
      message: 'Generation timed out after 0.001 seconds.',
    });

    expect(sawAbort).toBe(true);
  });
});
