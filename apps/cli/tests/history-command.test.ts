import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { recordUsage, upsertPreset } from '@marmot-sh/core';

import { handleHistoryCommand } from '../src/commands/history.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-history-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir } as NodeJS.ProcessEnv, dir };
}

function captureStdout() {
  const chunks: string[] = [];
  return {
    writer: {
      write(c: string | Buffer) {
        chunks.push(typeof c === 'string' ? c : c.toString('utf8'));
        return true;
      },
    },
    get text() {
      return chunks.join('');
    },
  };
}

async function seedRecords(
  env: NodeJS.ProcessEnv,
  count: number,
  template: Partial<Parameters<typeof recordUsage>[0]> = {},
): Promise<void> {
  const base = Date.now();
  for (let i = 0; i < count; i += 1) {
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        cached: false,
        duration_ms: 100 + i,
        exit: 'ok',
        ts: new Date(base - i * 60_000).toISOString(),
        ...template,
      } as Parameters<typeof recordUsage>[0],
      env,
    );
  }
}

describe('marmot history', () => {
  it('returns the most recent 10 records by default, newest first', async () => {
    const { env } = await fixture();
    await seedRecords(env, 20);
    const cap = captureStdout();
    await handleHistoryCommand({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.records).toHaveLength(10);
    const tsValues = (out.records as Array<{ ts: string }>).map((r) => r.ts);
    const sorted = [...tsValues].sort((a, b) => Date.parse(b) - Date.parse(a));
    expect(tsValues).toEqual(sorted);
  });

  it('honors --limit', async () => {
    const { env } = await fixture();
    await seedRecords(env, 5);
    const cap = captureStdout();
    await handleHistoryCommand({ json: true, limit: '3' }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.records).toHaveLength(3);
    expect(out.limit).toBe(3);
  });

  it('filters by --provider, --verb, --failed-only', async () => {
    const { env } = await fixture();
    const past = new Date(Date.now() - 60_000).toISOString();
    await recordUsage(
      { verb: 'search', provider: 'parallel', cached: false, duration_ms: 1, exit: 'ok', ts: past },
      env,
    );
    await recordUsage(
      { verb: 'run', provider: 'openrouter', cached: false, duration_ms: 1, exit: 'ok', ts: past },
      env,
    );
    await recordUsage(
      { verb: 'run', provider: 'openrouter', cached: false, duration_ms: 1, exit: 'error', error_category: 'provider', ts: past },
      env,
    );
    const cap = captureStdout();
    await handleHistoryCommand(
      { json: true, provider: 'openrouter', verb: 'run', failedOnly: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.records).toHaveLength(1);
    expect(out.records[0].exit).toBe('error');
  });

  it('resolves preset_id to the current slug at render time', async () => {
    const { env } = await fixture();
    const merged = await upsertPreset(
      'my-search',
      { mode: 'search', provider: 'parallel' },
      {},
      env,
    );
    const presetId = merged.presets!['my-search']!.preset_id!;
    expect(presetId).toBeDefined();
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        cached: false,
        duration_ms: 50,
        exit: 'ok',
        preset_id: presetId,
        ts: new Date(Date.now() - 60_000).toISOString(),
      },
      env,
    );
    const cap = captureStdout();
    await handleHistoryCommand({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.records[0].preset_slug).toBe('my-search');
  });

  it('rejects --limit values outside [1, 1000]', async () => {
    const { env } = await fixture();
    await expect(
      handleHistoryCommand({ limit: '0' }, { env }),
    ).rejects.toThrowError(/positive integer/);
    await expect(
      handleHistoryCommand({ limit: '1001' }, { env }),
    ).rejects.toThrowError(/exceeds the per-call cap/);
  });

  it('reports an empty window with a friendly message in human mode', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleHistoryCommand({}, { env, stdout: cap.writer });
    expect(cap.text).toContain('No usage records');
  });
});
