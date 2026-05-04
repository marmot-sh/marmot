import { describe, expect, it } from 'vitest';

import { runWithPolling } from '../src/lib/web-poll.js';

describe('runWithPolling', () => {
  it('returns immediately when poll returns done on first tick', async () => {
    let calls = 0;
    const result = await runWithPolling<number>({
      poll: async () => {
        calls += 1;
        return { done: true, value: 42 };
      },
    });
    expect(result).toBe(42);
    expect(calls).toBe(1);
  });

  it('keeps polling until done', async () => {
    let calls = 0;
    const result = await runWithPolling<string>({
      poll: async () => {
        calls += 1;
        if (calls < 3) return { done: false };
        return { done: true, value: 'finished' };
      },
      schedule: [10, 10, 10],
      jitter: 0,
    });
    expect(result).toBe('finished');
    expect(calls).toBe(3);
  });

  it('throws on max wait elapsed', async () => {
    await expect(
      runWithPolling<string>({
        poll: async () => ({ done: false }),
        schedule: [50, 50, 50],
        jitter: 0,
        maxWaitMs: 80,
      }),
    ).rejects.toThrowError(/Polling exceeded/);
  });

  it('honors AbortSignal between ticks', async () => {
    const controller = new AbortController();
    let calls = 0;
    const promise = runWithPolling<string>({
      poll: async () => {
        calls += 1;
        if (calls === 1) {
          // Abort after the first poll, before the next delay.
          setTimeout(() => controller.abort(), 5);
        }
        return { done: false };
      },
      schedule: [50, 50],
      jitter: 0,
      abortSignal: controller.signal,
    });
    await expect(promise).rejects.toThrowError(/cancelled/i);
  });

  it('propagates errors from the poll function', async () => {
    await expect(
      runWithPolling<string>({
        poll: async () => {
          throw new Error('upstream went boom');
        },
      }),
    ).rejects.toThrowError(/upstream went boom/);
  });

  it('invokes onTick before each delay (not before first call)', async () => {
    const ticks: Array<{ attempt: number; delayMs: number }> = [];
    let calls = 0;
    await runWithPolling<number>({
      poll: async () => {
        calls += 1;
        if (calls < 3) return { done: false };
        return { done: true, value: 1 };
      },
      schedule: [5, 5],
      jitter: 0,
      onTick: (info) => ticks.push(info),
    });
    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.attempt).toBe(1);
    expect(ticks[1]!.attempt).toBe(2);
  });
});
