import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeProviderCache } from '@marmot-sh/core';
import { handleModelsCommand } from '../src/commands/models.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

function modelEntry(id: string, name: string) {
  return {
    id,
    name,
    contextLength: null,
    pricing: null,
    inputModalities: ['text'],
    outputModalities: ['text'],
    updatedAt: null,
    metadata: {},
  };
}

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-models-search-'));
  tempDirs.push(dir);

  // Seed two providers' text caches with overlapping naming patterns so the
  // tests can prove the filter actually narrows results.
  await writeProviderCache(
    {
      version: 1,
      provider: 'openai',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      defaultModel: 'gpt-4o',
      models: [
        modelEntry('gpt-4o', 'GPT-4o'),
        modelEntry('gpt-4o-mini', 'GPT-4o mini'),
        modelEntry('o1-preview', 'o1 preview'),
        modelEntry('sora-2', 'Sora 2 video'),
      ],
    },
    { MARMOT_HOME: dir },
  );
  await writeProviderCache(
    {
      version: 1,
      provider: 'anthropic',
      fetchedAt: '2026-05-01T00:00:00.000Z',
      defaultModel: 'claude-opus-4-7',
      models: [
        modelEntry('claude-opus-4-7', 'Claude Opus 4.7'),
        modelEntry('claude-sonnet-4-6', 'Claude Sonnet 4.6'),
        modelEntry('claude-haiku-4-5', 'Claude Haiku 4.5'),
      ],
    },
    { MARMOT_HOME: dir },
  );

  return { env: { MARMOT_HOME: dir } };
}

function captureStdout() {
  const chunks: string[] = [];
  return {
    writer: {
      write(chunk: string | Buffer) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
      },
    },
    get text() {
      return chunks.join('');
    },
  };
}

describe('marmot models --search', () => {
  it('filters models by case-insensitive substring on id', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleModelsCommand(
      { search: 'GPT', provider: 'openai', mode: 'text', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    const ids = out.buckets.flatMap((b: { models: { id: string }[] }) => b.models.map((m) => m.id));
    expect(ids).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(out.search).toBe('GPT');
    expect(out.totalMatches).toBe(2);
  });

  it('filters by display name when id does not match', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleModelsCommand(
      { search: 'sonnet', mode: 'text', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    const ids = out.buckets.flatMap((b: { models: { id: string }[] }) => b.models.map((m) => m.id));
    expect(ids).toEqual(['claude-sonnet-4-6']);
  });

  it('default --limit caps total matches at 10', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    // "claude" matches 3 anthropic models; "gpt" matches 2 openai. Search for
    // a needle that hits all 7 models in the fixture (e.g. lowercase letter
    // "e" is in every id), then verify limit bites.
    await handleModelsCommand(
      { search: 'e', mode: 'text', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.totalMatches).toBeLessThanOrEqual(10);
  });

  it('--limit 5 truncates total matches across providers', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleModelsCommand(
      { search: 'e', mode: 'text', limit: '5', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.totalMatches).toBe(5);
  });

  it('--limit 0 returns all matches', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleModelsCommand(
      { search: 'claude', mode: 'text', limit: '0', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.totalMatches).toBe(3);
  });

  it('rejects negative --limit values', async () => {
    const { env } = await fixture();
    await expect(
      handleModelsCommand({ search: 'gpt', limit: '-1' }, { env }),
    ).rejects.toThrow(/--limit must be a non-negative integer/);
  });

  it('returns empty match list when no model matches needle', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleModelsCommand(
      { search: 'gemini', mode: 'text', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.totalMatches).toBe(0);
  });

  it('omits search/totalMatches keys when --search is not set', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleModelsCommand(
      { mode: 'text', provider: 'openai', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.search).toBeUndefined();
    expect(out.totalMatches).toBeUndefined();
    // Full openai text cache is returned (no filtering).
    const ids = out.buckets[0].models.map((m: { id: string }) => m.id);
    expect(ids).toContain('gpt-4o');
    expect(ids).toContain('o1-preview');
    expect(ids).toContain('sora-2');
  });
});
