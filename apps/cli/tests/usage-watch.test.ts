import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { recordUsage } from '@marmot-sh/core';

import { handleUsageWatchCommand } from '../src/commands/usage.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-watch-'));
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

function captureStderr() {
  const chunks: string[] = [];
  return {
    writer: {
      write(s: string) {
        chunks.push(s);
        return true;
      },
    },
    get text() {
      return chunks.join('');
    },
  };
}

describe('marmot usage --watch', () => {
  it('skips pre-existing records and prints only new ones', async () => {
    const { env } = await fixture();

    // Prime the file with one record before --watch starts.
    await recordUsage(
      { verb: 'search', provider: 'parallel', cached: false, duration_ms: 1, exit: 'ok' },
      env,
    );

    const stdout = captureStdout();
    const stderr = captureStderr();

    // Drive the watch loop: tick 1 = pre-existing seen as offset, no new
    // record yet → emit nothing. Then we append a new record and tick 2
    // picks it up. shouldStop() returns true after the third call so we
    // exit cleanly.
    let tick = 0;
    let appended = false;
    const shouldStop = () => {
      tick += 1;
      return tick >= 3;
    };
    const sleep = async () => {
      if (!appended) {
        await recordUsage(
          {
            verb: 'run',
            provider: 'openrouter',
            cached: false,
            duration_ms: 1234,
            exit: 'ok',
            quantity: { tokens_input: 100, tokens_output: 50 },
          },
          env,
        );
        appended = true;
      }
    };

    await handleUsageWatchCommand(
      { json: true },
      { env, stdout: stdout.writer, stderr: stderr.writer, shouldStop, sleep, intervalMs: 0 },
    );

    const lines = stdout.text.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]!);
    expect(record.verb).toBe('run');
    expect(record.provider).toBe('openrouter');
  });

  it('honors --provider and --verb filters', async () => {
    const { env } = await fixture();
    const stdout = captureStdout();
    const stderr = captureStderr();

    let tick = 0;
    let appended = false;
    const shouldStop = () => {
      tick += 1;
      return tick >= 3;
    };
    const sleep = async () => {
      if (!appended) {
        await recordUsage(
          { verb: 'search', provider: 'parallel', cached: false, duration_ms: 1, exit: 'ok' },
          env,
        );
        await recordUsage(
          { verb: 'run', provider: 'openrouter', cached: false, duration_ms: 1, exit: 'ok' },
          env,
        );
        appended = true;
      }
    };

    await handleUsageWatchCommand(
      { json: true, provider: 'openrouter' },
      { env, stdout: stdout.writer, stderr: stderr.writer, shouldStop, sleep, intervalMs: 0 },
    );
    const lines = stdout.text.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).provider).toBe('openrouter');
  });

  it('rolls over to the next UTC day when the clock crosses midnight', async () => {
    const { env } = await fixture();
    const stdout = captureStdout();
    const stderr = captureStderr();

    // Start the loop on day A; on the second iteration return a clock
    // that's one day later, which should reopen the path.
    let tick = 0;
    const dayA = new Date('2026-05-08T23:59:30.000Z');
    const dayB = new Date('2026-05-09T00:00:30.000Z');
    const now = () => (tick === 0 ? dayA : dayB);

    const shouldStop = () => {
      tick += 1;
      return tick >= 2;
    };
    const sleep = async () => {
      // No file activity needed; we're only verifying the stderr rollover note.
    };

    await handleUsageWatchCommand(
      {},
      { env, stdout: stdout.writer, stderr: stderr.writer, shouldStop, sleep, now, intervalMs: 0 },
    );

    expect(stderr.text).toContain('rolled over to');
    expect(stderr.text).toContain('2026-05-09.jsonl');
  });
});
