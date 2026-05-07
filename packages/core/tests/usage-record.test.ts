import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  isUsageLoggingEnabled,
  listUsageFiles,
  newCallId,
  parseDuration,
  parseIsoDate,
  pruneUsageOlderThan,
  readUsageRecords,
  recordUsage,
  usageRecordSchema,
} from '../src/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-usage-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir } };
}

describe('parseDuration', () => {
  it.each([
    ['1h', 3_600_000],
    ['24h', 86_400_000],
    ['1d', 86_400_000],
    ['7d', 7 * 86_400_000],
    ['4w', 28 * 86_400_000],
    [' 5d ', 5 * 86_400_000],
    ['1H', 3_600_000],
    ['1 d', 86_400_000],
  ])('parses "%s" → %d ms', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'foo', '5m', '5', '0d', '-1h', '1.5d', '1d12h'])('rejects invalid "%s"', (input) => {
    expect(() => parseDuration(input)).toThrow();
  });
});

describe('parseIsoDate', () => {
  it('accepts a real ISO date', () => {
    expect(parseIsoDate('from', '2026-05-06')).toBe(Date.parse('2026-05-06T00:00:00.000Z'));
  });

  it('rejects malformed format', () => {
    expect(() => parseIsoDate('from', '05/06/2026')).toThrow(/YYYY-MM-DD/);
  });

  it('rejects invalid calendar dates (Feb 30)', () => {
    expect(() => parseIsoDate('from', '2026-02-30')).toThrow(/not a real calendar date/);
  });
});

describe('isUsageLoggingEnabled', () => {
  it('defaults to true when no config and no env override', () => {
    expect(isUsageLoggingEnabled(null, {})).toBe(true);
  });

  it('honors MARMOT_NO_LOG=1 (env wins over config)', () => {
    expect(isUsageLoggingEnabled({ version: 1, logging: { enabled: true } }, { MARMOT_NO_LOG: '1' })).toBe(false);
  });

  it('honors logging.enabled=false', () => {
    expect(isUsageLoggingEnabled({ version: 1, logging: { enabled: false } }, {})).toBe(false);
  });

  it('treats missing logging field as enabled', () => {
    expect(isUsageLoggingEnabled({ version: 1 }, {})).toBe(true);
  });
});

describe('newCallId', () => {
  it('produces UUIDs that differ between calls', () => {
    const a = newCallId();
    const b = newCallId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('recordUsage + readUsageRecords round-trip', () => {
  it('writes a record and reads it back through the schema', async () => {
    const { env } = await fixture();
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        flags: { limit: 25 },
        flag_presence: { includeDomains: true },
        cached: false,
        duration_ms: 1234,
        cost: null,
        quantity: { results: 25 },
        exit: 'ok',
      },
      env,
    );

    const records = await readUsageRecords({}, env);
    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.verb).toBe('search');
    expect(r.provider).toBe('parallel');
    expect(r.quantity).toEqual({ results: 25 });
    expect(r.exit).toBe('ok');
    expect(r.call_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('appends multiple records to the same day file', async () => {
    const { env } = await fixture();
    for (let i = 0; i < 5; i++) {
      await recordUsage(
        { verb: 'search', provider: 'parallel', cached: false, duration_ms: i * 100, exit: 'ok' },
        env,
      );
    }
    const records = await readUsageRecords({}, env);
    expect(records).toHaveLength(5);
    const files = await listUsageFiles(env);
    expect(files).toHaveLength(1);
  });

  it('respects MARMOT_NO_LOG=1 and writes nothing', async () => {
    const { env } = await fixture();
    const noLogEnv = { ...env, MARMOT_NO_LOG: '1' };
    await recordUsage(
      { verb: 'search', provider: 'parallel', cached: false, duration_ms: 100, exit: 'ok' },
      noLogEnv,
    );
    const records = await readUsageRecords({}, env);
    expect(records).toHaveLength(0);
  });

  it('filters by ISO timestamp window', async () => {
    const { env } = await fixture();
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        cached: false,
        duration_ms: 1,
        exit: 'ok',
        ts: '2026-04-01T12:00:00.000Z',
      },
      env,
    );
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        cached: false,
        duration_ms: 2,
        exit: 'ok',
        ts: '2026-05-15T12:00:00.000Z',
      },
      env,
    );

    const all = await readUsageRecords({}, env);
    expect(all).toHaveLength(2);

    const aprilOnly = await readUsageRecords(
      { fromIso: '2026-04-01T00:00:00.000Z', toIso: '2026-04-30T23:59:59.000Z' },
      env,
    );
    expect(aprilOnly).toHaveLength(1);
    expect(aprilOnly[0]!.ts).toBe('2026-04-01T12:00:00.000Z');
  });

  it('on-disk record is privacy-safe (no prompt/query bodies leak)', async () => {
    const { env } = await fixture();
    await recordUsage(
      {
        verb: 'search',
        provider: 'parallel',
        flags: { limit: 5 },
        flag_presence: { includeDomains: true },
        cached: false,
        duration_ms: 100,
        exit: 'ok',
        quantity: { results: 5 },
      },
      env,
    );
    const files = await listUsageFiles(env);
    const raw = await readFile(files[0]!.path, 'utf8');
    expect(raw).toContain('"verb":"search"');
    expect(raw).toContain('"provider":"parallel"');
    expect(raw).toContain('"limit":5');
    expect(raw).not.toMatch(/prompt/);
    expect(raw).not.toMatch(/query/);
    expect(raw).not.toMatch(/email/);
    expect(raw).not.toMatch(/system/);
  });
});

describe('pruneUsageOlderThan', () => {
  it('deletes day files older than the cutoff and reports counts', async () => {
    const { env } = await fixture();
    for (const ts of [
      '2026-04-01T12:00:00.000Z',
      '2026-04-15T12:00:00.000Z',
      '2026-05-01T12:00:00.000Z',
      '2026-05-06T12:00:00.000Z',
    ]) {
      await recordUsage(
        { verb: 'search', provider: 'parallel', cached: false, duration_ms: 1, exit: 'ok', ts },
        env,
      );
    }
    expect((await listUsageFiles(env)).length).toBe(4);

    const result = await pruneUsageOlderThan('2026-05-01T00:00:00.000Z', env);
    expect(result.filesDeleted).toBe(2);
    expect(result.bytesFreed).toBeGreaterThan(0);

    const remaining = await listUsageFiles(env);
    expect(remaining.map((f) => f.date)).toEqual(['2026-05-01', '2026-05-06']);
  });
});

describe('usageRecordSchema', () => {
  it('rejects records without required fields', () => {
    const r = usageRecordSchema.safeParse({ verb: 'search' });
    expect(r.success).toBe(false);
  });

  it('rejects negative duration', () => {
    const r = usageRecordSchema.safeParse({
      call_id: 'x',
      ts: '2026-05-06T12:00:00.000Z',
      verb: 'search',
      provider: 'parallel',
      cached: false,
      duration_ms: -5,
      exit: 'ok',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a fully-populated record', () => {
    const r = usageRecordSchema.safeParse({
      call_id: '11111111-2222-3333-4444-555555555555',
      ts: '2026-05-06T12:00:00.000Z',
      verb: 'run',
      provider: 'openrouter',
      model: 'anthropic/claude-opus-4-7',
      preset: 'deep',
      flags: { temperature: 0.7 },
      flag_presence: { system: true },
      cached: false,
      duration_ms: 1024,
      cost: 0.0123,
      quantity: { tokens_input: 532, tokens_output: 1024 },
      exit: 'ok',
      session: 'summer-research',
    });
    expect(r.success).toBe(true);
  });
});
