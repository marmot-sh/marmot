import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearAllCache,
  clearByQuery,
  clearCachedEntry,
  clearOlderThan,
  clearProviderCache,
  hashCacheKey,
  lookupCached,
  statsAll,
  statsForProvider,
  writeCached,
} from '../src/cache/responses.js';

const tempDirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-resp-cache-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((d) => rm(d, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

describe('hashCacheKey', () => {
  it('produces stable hashes for key-equivalent inputs', () => {
    const a = hashCacheKey({ verb: 'search', input: { query: 'x', limit: 5 } });
    const b = hashCacheKey({ verb: 'search', input: { limit: 5, query: 'x' } });
    expect(a).toBe(b);
  });

  it('drops fetchFn / abortSignal / apiKey / apiSecret from the hash', () => {
    const a = hashCacheKey({ verb: 'search', input: { query: 'x' } });
    const b = hashCacheKey({
      verb: 'search',
      input: {
        query: 'x',
        apiKey: 'sk1',
        apiSecret: 'ss1',
        fetchFn: () => undefined,
      },
    });
    expect(a).toBe(b);
  });

  it('different inputs produce different hashes', () => {
    const a = hashCacheKey({ verb: 'search', input: { query: 'x' } });
    const b = hashCacheKey({ verb: 'search', input: { query: 'y' } });
    expect(a).not.toBe(b);
  });

  // 0.4.7 normalization

  it('trims leading and trailing whitespace on string values', () => {
    const a = hashCacheKey({ verb: 'search', input: { query: 'acme' } });
    const b = hashCacheKey({ verb: 'search', input: { query: '  acme  ' } });
    const c = hashCacheKey({ verb: 'search', input: { query: '\tacme\n' } });
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('preserves internal whitespace and word order', () => {
    // Internal whitespace and word ordering DO change semantic meaning for
    // search engines, so they must remain distinct cache entries.
    const a = hashCacheKey({ verb: 'search', input: { query: 'John Smith and Acme' } });
    const b = hashCacheKey({ verb: 'search', input: { query: 'Acme and John Smith' } });
    const c = hashCacheKey({ verb: 'search', input: { query: 'John Smith  and Acme' } });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('preserves case differences in queries', () => {
    // "Apple" (company) and "apple" (fruit) are different search intents.
    const a = hashCacheKey({ verb: 'search', input: { query: 'Apple' } });
    const b = hashCacheKey({ verb: 'search', input: { query: 'apple' } });
    expect(a).not.toBe(b);
  });

  it('sorts includeDomains so order does not affect identity', () => {
    const a = hashCacheKey({
      verb: 'search',
      input: { query: 'q', includeDomains: ['linkedin.com', 'github.com'] },
    });
    const b = hashCacheKey({
      verb: 'search',
      input: { query: 'q', includeDomains: ['github.com', 'linkedin.com'] },
    });
    expect(a).toBe(b);
  });

  it('sorts excludeDomains, includePaths, excludePaths, and stop arrays', () => {
    const a = hashCacheKey({
      verb: 'search',
      input: {
        excludeDomains: ['b.com', 'a.com'],
        includePaths: ['/y', '/x'],
        excludePaths: ['/n', '/m'],
        stop: ['END', 'STOP'],
      },
    });
    const b = hashCacheKey({
      verb: 'search',
      input: {
        excludeDomains: ['a.com', 'b.com'],
        includePaths: ['/x', '/y'],
        excludePaths: ['/m', '/n'],
        stop: ['STOP', 'END'],
      },
    });
    expect(a).toBe(b);
  });

  it('does not sort other arrays (non-filter arrays remain order-sensitive)', () => {
    // Arbitrary array fields should preserve order — only the named filter
    // arrays sort. This catches regressions if someone broadens the rule.
    const a = hashCacheKey({ verb: 'run', input: { messages: ['hi', 'bye'] } });
    const b = hashCacheKey({ verb: 'run', input: { messages: ['bye', 'hi'] } });
    expect(a).not.toBe(b);
  });
});

describe('writeCached + lookupCached', () => {
  it('round-trips a response on hit', async () => {
    const { env } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'foo' } }, { results: [1, 2] }, 60, { env });
    const r = await lookupCached('exa', { verb: 'search', input: { q: 'foo' } }, env);
    expect(r.hit).toBe(true);
    if (r.hit) {
      expect(r.response).toEqual({ results: [1, 2] });
      expect(r.entry.provider).toBe('exa');
      expect(r.entry.verb).toBe('search');
    }
  });

  it('returns miss when no entry exists', async () => {
    const { env } = await fixture();
    const r = await lookupCached('exa', { verb: 'search', input: { q: 'nope' } }, env);
    expect(r.hit).toBe(false);
    if (!r.hit) expect(r.reason).toBe('miss');
  });

  it('returns expired when ttl has elapsed', async () => {
    const { env } = await fixture();
    const past = new Date(Date.now() - 7200_000); // 2h ago
    await writeCached(
      'exa',
      { verb: 'search', input: { q: 'foo' } },
      { results: [] },
      3600, // 1h ttl
      { env, now: () => past },
    );
    const r = await lookupCached(
      'exa',
      { verb: 'search', input: { q: 'foo' } },
      env,
    );
    expect(r.hit).toBe(false);
    if (!r.hit) expect(r.reason).toBe('expired');
  });

  it('isolates entries by provider', async () => {
    const { env } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'foo' } }, { from: 'exa' }, 60, { env });
    await writeCached('tavily', { verb: 'search', input: { q: 'foo' } }, { from: 'tavily' }, 60, { env });
    const a = await lookupCached('exa', { verb: 'search', input: { q: 'foo' } }, env);
    const b = await lookupCached('tavily', { verb: 'search', input: { q: 'foo' } }, env);
    expect(a.hit && a.response).toEqual({ from: 'exa' });
    expect(b.hit && b.response).toEqual({ from: 'tavily' });
  });

  it('records the optional query label', async () => {
    const { env } = await fixture();
    await writeCached(
      'exa',
      { verb: 'search', input: { q: 'foo' } },
      { results: [] },
      60,
      { env, query: 'recent papers on RAG' },
    );
    const r = await lookupCached(
      'exa',
      { verb: 'search', input: { q: 'foo' } },
      env,
    );
    expect(r.hit && r.entry.query).toBe('recent papers on RAG');
  });
});

describe('clearCachedEntry', () => {
  it('removes a specific entry', async () => {
    const { env } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'foo' } }, {}, 60, { env });
    const removed = await clearCachedEntry('exa', { verb: 'search', input: { q: 'foo' } }, env);
    expect(removed).toBe(true);
    const r = await lookupCached('exa', { verb: 'search', input: { q: 'foo' } }, env);
    expect(r.hit).toBe(false);
  });

  it('returns false when entry does not exist', async () => {
    const { env } = await fixture();
    const removed = await clearCachedEntry('exa', { verb: 'search', input: { q: 'never' } }, env);
    expect(removed).toBe(false);
  });
});

describe('clearProviderCache', () => {
  it('clears all entries for one provider only', async () => {
    const { env, dir } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'a' } }, {}, 60, { env });
    await writeCached('exa', { verb: 'search', input: { q: 'b' } }, {}, 60, { env });
    await writeCached('tavily', { verb: 'search', input: { q: 'a' } }, {}, 60, { env });
    const removed = await clearProviderCache('exa', env);
    expect(removed).toBe(2);
    // tavily entry untouched
    const tavilyDir = await readdir(join(dir, 'cache', 'responses', 'tavily'));
    expect(tavilyDir).toHaveLength(1);
  });

  it('returns 0 when provider has no entries', async () => {
    const { env } = await fixture();
    expect(await clearProviderCache('exa', env)).toBe(0);
  });
});

describe('clearAllCache', () => {
  it('clears every provider', async () => {
    const { env } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'a' } }, {}, 60, { env });
    await writeCached('tavily', { verb: 'search', input: { q: 'b' } }, {}, 60, { env });
    expect(await clearAllCache(env)).toBe(2);
  });
});

describe('clearByQuery', () => {
  it('removes entries whose query label contains the substring', async () => {
    const { env } = await fixture();
    await writeCached(
      'exa',
      { verb: 'search', input: { q: 'a' } },
      {},
      60,
      { env, query: 'recent papers on RAG' },
    );
    await writeCached(
      'exa',
      { verb: 'search', input: { q: 'b' } },
      {},
      60,
      { env, query: 'something else entirely' },
    );
    const removed = await clearByQuery('exa', 'rag', env);
    expect(removed).toBe(1);
    expect(
      (await lookupCached('exa', { verb: 'search', input: { q: 'a' } }, env)).hit,
    ).toBe(false);
    expect(
      (await lookupCached('exa', { verb: 'search', input: { q: 'b' } }, env)).hit,
    ).toBe(true);
  });
});

describe('clearOlderThan', () => {
  it('removes entries older than N days', async () => {
    const { env } = await fixture();
    const old = new Date(Date.now() - 10 * 86400_000);
    await writeCached(
      'exa',
      { verb: 'search', input: { q: 'old' } },
      {},
      365 * 86400, // long ttl so it's not expired-by-ttl
      { env, now: () => old },
    );
    await writeCached('exa', { verb: 'search', input: { q: 'new' } }, {}, 60, { env });
    const removed = await clearOlderThan('exa', 7, env);
    expect(removed).toBe(1);
    expect(
      (await lookupCached('exa', { verb: 'search', input: { q: 'old' } }, env)).hit,
    ).toBe(false);
    expect(
      (await lookupCached('exa', { verb: 'search', input: { q: 'new' } }, env)).hit,
    ).toBe(true);
  });

  it('handles all-providers mode (provider=null)', async () => {
    const { env } = await fixture();
    const old = new Date(Date.now() - 10 * 86400_000);
    await writeCached('exa', { verb: 'search', input: {} }, {}, 365 * 86400, { env, now: () => old });
    await writeCached('tavily', { verb: 'search', input: {} }, {}, 365 * 86400, { env, now: () => old });
    expect(await clearOlderThan(null, 7, env)).toBe(2);
  });
});

describe('statsForProvider / statsAll', () => {
  it('reports entry count and bytes', async () => {
    const { env } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'a' } }, { results: [1] }, 60, { env });
    await writeCached('exa', { verb: 'search', input: { q: 'b' } }, { results: [2] }, 60, { env });
    const stats = await statsForProvider('exa', env);
    expect(stats.entries).toBe(2);
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.provider).toBe('exa');
  });

  it('returns 0/0 when provider has no cache dir', async () => {
    const { env } = await fixture();
    const stats = await statsForProvider('exa', env);
    expect(stats.entries).toBe(0);
    expect(stats.bytes).toBe(0);
  });

  it('statsAll lists every provider with cache entries', async () => {
    const { env } = await fixture();
    await writeCached('exa', { verb: 'search', input: { q: 'a' } }, {}, 60, { env });
    await writeCached('tavily', { verb: 'search', input: { q: 'b' } }, {}, 60, { env });
    const all = await statsAll(env);
    expect(all.map((s) => s.provider).sort()).toEqual(['exa', 'tavily']);
  });
});
