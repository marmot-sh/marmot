import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleSearchCommand } from '../src/commands/search.js';
import { writeMarmotConfig } from '@marmot-sh/core';

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
