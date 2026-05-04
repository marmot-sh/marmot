import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeMarmotConfig } from '@marmot-sh/core';

import { handleSearchCommand } from '../src/commands/search.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-cache-wrap-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

class Cap {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

const tavilyResponse = {
  results: [{ url: 'https://example.com', title: 'A', content: 's' }],
  answer: null,
};

describe('search command — cache integration', () => {
  it('caching disabled by default → every call goes through to the adapter', async () => {
    const { env } = await fixture();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify(tavilyResponse), { status: 200 });
    }) as unknown as typeof fetch;

    await handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: new Cap(),
      fetchFn,
    });
    await handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: new Cap(),
      fetchFn,
    });
    expect(calls).toBe(2);
  });

  it('caching enabled → second identical call hits cache, no network', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      {
        version: 1,
        providers: { tavily: { cache: { enabled: true } } },
      },
      env,
    );
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify(tavilyResponse), { status: 200 });
    }) as unknown as typeof fetch;

    const out1 = new Cap();
    await handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: out1,
      fetchFn,
    });
    const out2 = new Cap();
    await handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: out2,
      fetchFn,
    });

    expect(calls).toBe(1);
    expect(JSON.parse(out1.text()).cached).toBe(false);
    expect(JSON.parse(out2.text()).cached).toBe(true);
    // Both envelopes should report the same data.
    expect(JSON.parse(out1.text()).data).toEqual(JSON.parse(out2.text()).data);
  });

  it('--no-cache bypasses cache read and write', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      {
        version: 1,
        providers: { tavily: { cache: { enabled: true } } },
      },
      env,
    );
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify(tavilyResponse), { status: 200 });
    }) as unknown as typeof fetch;

    await handleSearchCommand(
      ['hello'],
      { provider: 'tavily', apiKey: 'k', cache: false },
      { env, stdout: new Cap(), fetchFn },
    );
    await handleSearchCommand(
      ['hello'],
      { provider: 'tavily', apiKey: 'k', cache: false },
      { env, stdout: new Cap(), fetchFn },
    );
    expect(calls).toBe(2);
  });

  it('--refresh skips cache read but writes the fresh response', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      {
        version: 1,
        providers: { tavily: { cache: { enabled: true } } },
      },
      env,
    );
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify(tavilyResponse), { status: 200 });
    }) as unknown as typeof fetch;

    // First call seeds the cache.
    await handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: new Cap(),
      fetchFn,
    });
    // Refresh forces a fresh call.
    await handleSearchCommand(
      ['hello'],
      { provider: 'tavily', apiKey: 'k', refresh: true },
      { env, stdout: new Cap(), fetchFn },
    );
    // Third call should now hit the freshly-written cache.
    const out3 = new Cap();
    await handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: out3,
      fetchFn,
    });
    expect(calls).toBe(2);
    expect(JSON.parse(out3.text()).cached).toBe(true);
  });

  it('different queries produce different cache entries', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      {
        version: 1,
        providers: { tavily: { cache: { enabled: true } } },
      },
      env,
    );
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify(tavilyResponse), { status: 200 });
    }) as unknown as typeof fetch;

    await handleSearchCommand(['foo'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: new Cap(),
      fetchFn,
    });
    await handleSearchCommand(['bar'], { provider: 'tavily', apiKey: 'k' }, {
      env,
      stdout: new Cap(),
      fetchFn,
    });
    expect(calls).toBe(2);
  });

  it('disabled provider blocks the call entirely', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, providers: { tavily: { enabled: false } } },
      env,
    );
    await expect(
      handleSearchCommand(['hello'], { provider: 'tavily', apiKey: 'k' }, {
        env,
        stdout: new Cap(),
        fetchFn: (async () => new Response('{}')) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/disabled/);
  });

  it('custom apiKeyEnvVar resolves to a non-default env var', async () => {
    const { env: baseEnv } = await fixture();
    const env = { ...baseEnv, MY_TAVILY: 'live-key' };
    await writeMarmotConfig(
      { version: 1, providers: { tavily: { apiKeyEnvVar: 'MY_TAVILY' } } },
      env,
    );
    let receivedAuth: string | undefined;
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      receivedAuth = headers.Authorization;
      return new Response(JSON.stringify(tavilyResponse), { status: 200 });
    }) as unknown as typeof fetch;
    await handleSearchCommand(['hi'], { provider: 'tavily' }, {
      env,
      stdout: new Cap(),
      fetchFn,
    });
    expect(receivedAuth).toBe('Bearer live-key');
  });
});
