import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { recordUsage } from '@marmot-sh/core';
import { handleUsageCommand, handleUsagePruneCommand } from '../src/commands/usage.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-usage-cmd-'));
  tempDirs.push(dir);
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

async function seed(env: { MARMOT_HOME: string }) {
  // Two providers, two verbs, mixed exit states, mixed cost reporting.
  await recordUsage(
    {
      verb: 'search',
      provider: 'parallel',
      cached: false,
      duration_ms: 1000,
      cost: null,
      quantity: { results: 25 },
      exit: 'ok',
      ts: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    },
    env,
  );
  await recordUsage(
    {
      verb: 'search',
      provider: 'parallel',
      cached: true,
      duration_ms: 50,
      cost: null,
      quantity: { results: 10 },
      exit: 'ok',
      ts: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    },
    env,
  );
  await recordUsage(
    {
      verb: 'run',
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4-7',
      cached: false,
      duration_ms: 2000,
      cost: 0.05,
      quantity: { tokens_input: 500, tokens_output: 1000 },
      exit: 'ok',
      ts: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    },
    env,
  );
  await recordUsage(
    {
      verb: 'run',
      provider: 'openrouter',
      model: 'anthropic/claude-haiku-4-5',
      cached: false,
      duration_ms: 800,
      cost: 0.01,
      quantity: { tokens_input: 200, tokens_output: 300 },
      exit: 'error',
      error_category: 'provider',
      ts: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    },
    env,
  );
}

describe('marmot usage', () => {
  it('aggregates totals across providers in JSON envelope', async () => {
    const { env } = await fixture();
    await seed(env);
    const cap = captureStdout();
    await handleUsageCommand({ since: '7d', json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.totals.calls).toBe(4);
    expect(out.totals.errors).toBe(1);
    expect(out.totals.errorRate).toBeCloseTo(0.25);
    expect(out.totals.costTotal).toBeCloseTo(0.06);
    expect(out.totals.callsWithCost).toBe(2);
    expect(out.totals.callsWithoutCost).toBe(2);
    expect(out.totals.quantityTotals.results).toBe(35);
    expect(out.totals.quantityTotals.tokens_input).toBe(700);
    expect(out.totals.quantityTotals.tokens_output).toBe(1300);
    expect(out.by_provider.map((r: { key: string }) => r.key).sort()).toEqual(['openrouter', 'parallel']);
  });

  it('groups by verb when --by verb', async () => {
    const { env } = await fixture();
    await seed(env);
    const cap = captureStdout();
    await handleUsageCommand({ since: '7d', by: 'verb', json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.by_verb.map((r: { key: string }) => r.key).sort()).toEqual(['run', 'search']);
    const search = out.by_verb.find((r: { key: string }) => r.key === 'search')!;
    expect(search.calls).toBe(2);
    expect(search.cached).toBe(1);
    expect(search.quantityTotals.results).toBe(35);
  });

  it('filters by --provider', async () => {
    const { env } = await fixture();
    await seed(env);
    const cap = captureStdout();
    await handleUsageCommand(
      { since: '7d', provider: 'openrouter', json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.totals.calls).toBe(2);
    expect(out.by_provider).toHaveLength(1);
    expect(out.by_provider[0].key).toBe('openrouter');
  });

  it('--failed-only returns only error rows', async () => {
    const { env } = await fixture();
    await seed(env);
    const cap = captureStdout();
    await handleUsageCommand(
      { since: '7d', failedOnly: true, json: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.totals.calls).toBe(1);
    expect(out.totals.errors).toBe(1);
  });

  it('handles empty window with a friendly message', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleUsageCommand({ since: '7d' }, { env, stdout: cap.writer });
    expect(cap.text).toContain('No usage records');
  });

  it('rejects --from later than --to', async () => {
    const { env } = await fixture();
    await expect(
      handleUsageCommand(
        { from: '2026-12-01', to: '2026-01-01' },
        { env },
      ),
    ).rejects.toThrow(/range is empty/);
  });
});

describe('marmot usage prune', () => {
  it('deletes files older than the cutoff', async () => {
    const { env } = await fixture();
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        cached: false,
        duration_ms: 1,
        exit: 'ok',
        ts: new Date(Date.now() - 100 * 86_400_000).toISOString(),
      },
      env,
    );
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        cached: false,
        duration_ms: 1,
        exit: 'ok',
        ts: new Date().toISOString(),
      },
      env,
    );
    const cap = captureStdout();
    await handleUsagePruneCommand({ olderThan: '90d' }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.files_deleted).toBe(1);
    expect(out.bytes_freed).toBeGreaterThan(0);
  });
});
