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

describe('withPreset merge rules for text mode', () => {
  it('concatenates preset and runtime system prompts with double newline', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'helpful-base',
      { mode: 'text', system: 'You are a helpful assistant.' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'helpful-base', system: 'Be terse.' } as {
        preset?: string;
        system?: string;
      },
      'text',
    );
    expect(merged.system).toBe('You are a helpful assistant.\n\nBe terse.');
  });

  it('appends preset file list before runtime --file paths', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'with-standards',
      { mode: 'text', file: ['./standards.md'] },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'with-standards', file: ['./code.ts'] } as {
        preset?: string;
        file?: string[];
      },
      'text',
    );
    expect(merged.file).toEqual(['./standards.md', './code.ts']);
  });

  it('appends preset stop sequences before runtime ones', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'with-stops',
      { mode: 'text', stop: ['```'] },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'with-stops', stop: ['###'] } as {
        preset?: string;
        stop?: string[];
      },
      'text',
    );
    expect(merged.stop).toEqual(['```', '###']);
  });

  it('runtime --no-stream (stream: false) overrides preset stream: true', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'streaming',
      { mode: 'text', stream: true },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'streaming', stream: false } as {
        preset?: string;
        stream?: boolean;
      },
      'text',
    );
    expect(merged.stream).toBe(false);
  });

  it('preset prompt fills options.prompt for handler-side concat with positional', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'translator',
      { mode: 'text', prompt: 'Translate to French:' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'translator' } as { preset?: string; prompt?: string },
      'text',
    );
    expect(merged.prompt).toBe('Translate to French:');
  });

  it('rejects preset with apiKey field (security exclusion via .strict())', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await expect(
      upsertPreset(
        'badpreset',
        { mode: 'text', apiKey: 'sk-leaked' } as never,
        {},
        env,
      ),
    ).rejects.toThrow();
  });
});
