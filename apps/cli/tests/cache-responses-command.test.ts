import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeCached } from '@marmot-sh/core';

import {
  handleCacheClearCommand,
  handleCacheStatsCommand,
} from '../src/commands/cache-responses.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-cache-cmd-'));
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

async function seed(env: NodeJS.ProcessEnv) {
  await writeCached('exa', { verb: 'search', input: { q: 'a' } }, {}, 60, { env, query: 'first query' });
  await writeCached('exa', { verb: 'search', input: { q: 'b' } }, {}, 60, { env, query: 'second' });
  await writeCached('tavily', { verb: 'search', input: { q: 'c' } }, {}, 60, { env, query: 'third' });
}

describe('handleCacheClearCommand', () => {
  it('errors when neither --provider nor --all is given', async () => {
    const { env } = await fixture();
    await expect(handleCacheClearCommand({}, { env })).rejects.toThrow(/--provider|--all/);
  });

  it('errors when --query is used without --provider', async () => {
    const { env } = await fixture();
    await expect(
      handleCacheClearCommand({ query: 'foo', all: true }, { env }),
    ).rejects.toThrow(/--query requires --provider/);
  });

  it('--provider scope removes only that provider', async () => {
    const { env } = await fixture();
    await seed(env);
    const stdout = new Cap();
    await handleCacheClearCommand({ provider: 'exa' }, { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.removed).toBe(2);
    // Tavily entry survives
    const stdout2 = new Cap();
    await handleCacheStatsCommand({}, { env, stdout: stdout2 });
    const stats = JSON.parse(stdout2.text());
    expect(stats.providers.find((p: { provider: string }) => p.provider === 'tavily').entries).toBe(1);
  });

  it('--all wipes every provider', async () => {
    const { env } = await fixture();
    await seed(env);
    const stdout = new Cap();
    await handleCacheClearCommand({ all: true }, { env, stdout });
    expect(JSON.parse(stdout.text()).removed).toBe(3);
  });

  it('--provider + --query removes only matching entries', async () => {
    const { env } = await fixture();
    await seed(env);
    const stdout = new Cap();
    await handleCacheClearCommand(
      { provider: 'exa', query: 'first' },
      { env, stdout },
    );
    expect(JSON.parse(stdout.text()).removed).toBe(1);
  });

  it('--older-than 0 days clears every recent entry', async () => {
    const { env } = await fixture();
    await seed(env);
    const stdout = new Cap();
    await handleCacheClearCommand({ all: true, olderThan: '0' }, { env, stdout });
    expect(JSON.parse(stdout.text()).removed).toBe(3);
  });
});

describe('handleCacheStatsCommand', () => {
  it('reports per-provider entry counts and bytes', async () => {
    const { env } = await fixture();
    await seed(env);
    const stdout = new Cap();
    await handleCacheStatsCommand({}, { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.totals.entries).toBe(3);
    expect(out.providers).toHaveLength(2);
    expect(out.providers.find((p: { provider: string }) => p.provider === 'exa').entries).toBe(2);
  });

  it('--provider filters to one provider only', async () => {
    const { env } = await fixture();
    await seed(env);
    const stdout = new Cap();
    await handleCacheStatsCommand({ provider: 'tavily' }, { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.providers).toHaveLength(1);
    expect(out.providers[0].provider).toBe('tavily');
    expect(out.providers[0].entries).toBe(1);
  });

  it('reports zeros when nothing is cached', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    await handleCacheStatsCommand({}, { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.totals.entries).toBe(0);
    expect(out.providers).toHaveLength(0);
  });
});
