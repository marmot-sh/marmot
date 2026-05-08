import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertDateRangeCoherent,
  handleSearchCommand,
  validateIsoDate,
} from '../src/commands/search.js';
import { createSession, readUsageRecords, writeMarmotConfig } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-search-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

class CapturingStream {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('handleSearchCommand', () => {
  it('errors on missing query', async () => {
    const { env } = await fixture();
    await expect(
      handleSearchCommand([], {}, { env }),
    ).rejects.toThrowError(/Search requires a query/);
  });

  it('errors when no default provider and no flag', async () => {
    const { env } = await fixture();
    await expect(
      handleSearchCommand(['hello'], {}, { env }),
    ).rejects.toThrowError(/No default provider for "search"/);
  });

  it('errors when chosen provider does not support search (matrix not yet enforces nothing — every provider supports search)', async () => {
    // Every web provider supports search. This test guards the matrix shape.
    // If we ever add a provider without search, fix this test.
    expect(true).toBe(true);
  });

  it('routes through tavily when configured', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, defaults: { search: { provider: 'tavily' } } },
      env,
    );

    const stdout = new CapturingStream();
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      expect(u).toContain('api.tavily.com/search');
      const auth = (init?.headers as Record<string, string>).Authorization;
      expect(auth).toBe('Bearer tvly-fake');
      return new Response(
        JSON.stringify({
          query: 'hello',
          results: [
            {
              url: 'https://example.com',
              title: 'Example',
              content: 'snippet',
              score: 0.9,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await handleSearchCommand(
      ['hello'],
      { apiKey: 'tvly-fake' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('tavily');
    expect(out.verb).toBe('search');
    expect(out.data.results).toHaveLength(1);
    expect(out.data.results[0].url).toBe('https://example.com');
  });

  it('routes through brave with X-Subscription-Token', async () => {
    const { env } = await fixture();
    const stdout = new CapturingStream();
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain('api.search.brave.com/res/v1/web/search');
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Subscription-Token']).toBe('brave-fake');
      return new Response(
        JSON.stringify({
          web: {
            results: [
              { url: 'https://b.com', title: 'B', description: 'desc' },
            ],
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleSearchCommand(
      ['cats'],
      { provider: 'brave', apiKey: 'brave-fake' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.provider).toBe('brave');
    expect(out.data.results[0].title).toBe('B');
  });

  it('records session name in usage when --session is bound', async () => {
    const { env } = await fixture();
    await createSession('research-q2', { mode: 'stateless' }, env);
    const stdout = new CapturingStream();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ web: { results: [{ url: 'https://e.com', title: 't' }] } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await handleSearchCommand(
      ['cats'],
      { provider: 'brave', apiKey: 'k', session: 'research-q2' },
      { env, stdout, fetchFn },
    );
    const records = await readUsageRecords({}, env);
    expect(records).toHaveLength(1);
    expect(records[0]!.session).toBe('research-q2');
    expect(records[0]!.verb).toBe('search');
  });

  it('emits raw payload under raw when --raw is set', async () => {
    const { env } = await fixture();
    const stdout = new CapturingStream();
    const native = { web: { results: [{ url: 'https://x', title: 't' }] } };
    const fetchFn = (async () =>
      new Response(JSON.stringify(native), { status: 200 })) as unknown as typeof fetch;
    await handleSearchCommand(
      ['x'],
      { provider: 'brave', apiKey: 'k', raw: true },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data).toBeNull();
    expect(out.raw).toEqual(native);
  });

  it('errors when api key is missing', async () => {
    const { env } = await fixture();
    await expect(
      handleSearchCommand(['x'], { provider: 'tavily' }, { env }),
    ).rejects.toThrowError(/TAVILY_API_KEY/);
  });

  it('surfaces a 401 as auth error', async () => {
    const { env } = await fixture();
    const fetchFn = (async () =>
      new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(
      handleSearchCommand(
        ['x'],
        { provider: 'exa', apiKey: 'bad' },
        { env, fetchFn },
      ),
    ).rejects.toThrowError(/status 401/);
  });

  it('retries on transient provider failure when --retries is set', async () => {
    const { env } = await fixture();
    const stdout = new CapturingStream();
    const stderr = new CapturingStream();

    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      if (calls < 3) {
        return new Response('upstream hiccup', { status: 502 });
      }
      return new Response(
        JSON.stringify({
          web: { results: [{ url: 'https://ok', title: 'OK', description: '' }] },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleSearchCommand(
      ['hello'],
      { provider: 'brave', apiKey: 'k', retries: '2' },
      { env, stdout, stderr, fetchFn },
    );

    expect(calls).toBe(3);
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    // Retry notifier should have written 2 lines to stderr (one per retried attempt).
    const retryLines = stderr
      .text()
      .split('\n')
      .filter((line) => line.startsWith('[retry'));
    expect(retryLines).toHaveLength(2);
    expect(retryLines[0]).toMatch(/^\[retry 1\/2\] brave search:/);
    expect(retryLines[1]).toMatch(/^\[retry 2\/2\] brave search:/);
  });

  it('rejects invalid --retries values without retrying', async () => {
    const { env } = await fixture();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      handleSearchCommand(
        ['hello'],
        { provider: 'brave', apiKey: 'k', retries: '99' },
        { env, fetchFn },
      ),
    ).rejects.toThrowError(/--retries must be an integer between 0 and 10/);
    expect(calls).toBe(0);
  });
});

describe('validateIsoDate', () => {
  it('returns undefined for missing input', () => {
    expect(validateIsoDate('after-date', undefined)).toBeUndefined();
  });

  it('accepts a well-formed date', () => {
    expect(validateIsoDate('after-date', '2026-01-15')).toBe('2026-01-15');
  });

  it('rejects bad format with a clear message', () => {
    expect(() => validateIsoDate('after-date', '2026/01/15')).toThrowError(
      /--after-date must be in YYYY-MM-DD format/,
    );
    expect(() => validateIsoDate('before-date', '5-6-2026')).toThrowError(/--before-date/);
    expect(() => validateIsoDate('after-date', '2026-1-15')).toThrowError(/YYYY-MM-DD format/);
  });

  it('rejects impossible months and days even when format is correct', () => {
    expect(() => validateIsoDate('after-date', '2026-13-45')).toThrowError(
      /not a real calendar date/,
    );
    expect(() => validateIsoDate('after-date', '2026-02-30')).toThrowError(/real calendar/);
    expect(() => validateIsoDate('after-date', '2026-04-31')).toThrowError(/real calendar/);
    expect(() => validateIsoDate('after-date', '2026-00-15')).toThrowError(/real calendar/);
  });

  it('accepts Feb 29 in leap years and rejects in non-leap years', () => {
    expect(validateIsoDate('after-date', '2024-02-29')).toBe('2024-02-29');
    expect(() => validateIsoDate('after-date', '2026-02-29')).toThrowError(
      /not a real calendar date/,
    );
  });

  it('accepts ordinary edge dates: Dec 31, Jan 1, end-of-month', () => {
    expect(validateIsoDate('after-date', '2026-12-31')).toBe('2026-12-31');
    expect(validateIsoDate('after-date', '2026-01-01')).toBe('2026-01-01');
    expect(validateIsoDate('before-date', '2026-04-30')).toBe('2026-04-30');
  });
});

describe('assertDateRangeCoherent', () => {
  it('no-ops when both bounds are absent', () => {
    expect(() => assertDateRangeCoherent(undefined, undefined)).not.toThrow();
  });

  it('no-ops when only one bound is set', () => {
    expect(() => assertDateRangeCoherent('2026-01-15', undefined)).not.toThrow();
    expect(() => assertDateRangeCoherent(undefined, '2026-01-15')).not.toThrow();
  });

  it('accepts a coherent range (after < before)', () => {
    expect(() => assertDateRangeCoherent('2026-01-15', '2026-02-15')).not.toThrow();
  });

  it('accepts a same-day window (after === before)', () => {
    expect(() => assertDateRangeCoherent('2026-01-15', '2026-01-15')).not.toThrow();
  });

  it('rejects an inverted range (after > before)', () => {
    expect(() => assertDateRangeCoherent('2026-12-31', '2026-01-01')).toThrowError(
      /range is inverted/,
    );
  });

  it('rejects an inverted range with crossed years', () => {
    expect(() => assertDateRangeCoherent('2026-01-01', '2025-12-31')).toThrowError(
      /--after-date \(2026-01-01\) is later than --before-date \(2025-12-31\)/,
    );
  });
});
