import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { upsertPreset } from '@marmot-sh/core';
import { withPreset } from '../src/lib/with-preset.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-with-preset-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir } };
}

describe('withPreset for web/data verbs', () => {
  it('merges saved search preset fields into options when --preset is passed', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'linkedin-people',
      {
        mode: 'search',
        provider: 'parallel',
        limit: 25,
        includeDomains: 'linkedin.com',
        afterDate: '2026-01-01',
      },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'linkedin-people' } as { preset?: string; provider?: string },
      'search',
    );
    expect(merged).toMatchObject({
      provider: 'parallel',
      limit: 25,
      includeDomains: 'linkedin.com',
      afterDate: '2026-01-01',
    });
    // Mode discriminator should not leak into verb options.
    expect(merged).not.toHaveProperty('mode');
  });

  it('explicit flags win over preset values', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'p1',
      { mode: 'search', provider: 'parallel', limit: 25 },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'p1', provider: 'tavily', limit: 5 } as {
        preset?: string;
        provider?: string;
        limit?: number;
      },
      'search',
    );
    expect(merged.provider).toBe('tavily');
    expect(merged.limit).toBe(5);
  });

  it('rejects when preset mode does not match verb', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'aiprompt',
      { mode: 'text', provider: 'anthropic' },
      {},
      env,
    );

    await expect(
      withPreset({ preset: 'aiprompt' } as { preset?: string }, 'search'),
    ).rejects.toThrowError(/mode "text".*requires "search"/);
  });

  it('returns options unchanged when no preset is passed', async () => {
    const opts = { provider: 'parallel', limit: 10 };
    const merged = await withPreset(opts as { preset?: string; provider?: string }, 'search');
    expect(merged).toEqual(opts);
  });

  it('merges enrich preset for data verb', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'enrich-pdl',
      {
        mode: 'enrich',
        provider: 'pdl',
        type: 'person',
        minLikelihood: 8,
        require: 'email',
      },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'enrich-pdl' } as { preset?: string },
      'enrich',
    );
    expect(merged).toMatchObject({
      provider: 'pdl',
      type: 'person',
      minLikelihood: 8,
      require: 'email',
    });
  });
});
