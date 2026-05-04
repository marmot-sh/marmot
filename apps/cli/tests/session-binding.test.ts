import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSession,
  setCurrentSession,
} from '@marmot-sh/core';
import { logCallToSession, resolveSessionBinding } from '../src/lib/session-binding.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-session-bind-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

describe('resolveSessionBinding', () => {
  it('returns null when no flag and no pointer', async () => {
    const { env } = await fixture();
    expect(await resolveSessionBinding({}, env)).toBeNull();
  });

  it('uses the explicit --session flag, ignoring the pointer', async () => {
    const { env } = await fixture();
    await createSession('flagged', {}, env);
    await createSession('pointed', {}, env);
    await setCurrentSession('pointed', env);
    const binding = await resolveSessionBinding({ session: 'flagged' }, env);
    expect(binding?.name).toBe('flagged');
  });

  it('falls back to the pointer', async () => {
    const { env } = await fixture();
    await createSession('pointed', { mode: 'chat' }, env);
    await setCurrentSession('pointed', env);
    const binding = await resolveSessionBinding({}, env);
    expect(binding?.name).toBe('pointed');
    expect(binding?.meta.mode).toBe('chat');
  });
});

describe('logCallToSession', () => {
  it('is a no-op when binding is null', async () => {
    const { env } = await fixture();
    const result = await logCallToSession(
      null,
      {
        verb: 'run',
        provider: 'anthropic',
        startedAtMs: 1000,
        finishedAtMs: 2000,
        exit: 'ok',
      },
      env,
    );
    expect(result).toBeNull();
  });

  it('writes a log record and computes duration', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', {}, env);
    const binding = await resolveSessionBinding({ session: 's1' }, env);
    const record = await logCallToSession(
      binding,
      {
        verb: 'run',
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        startedAtMs: 1000,
        finishedAtMs: 1500,
        tokens: { input: 100, output: 50 },
        prompt: 'sensitive',
        system: 'sys',
        exit: 'ok',
      },
      env,
    );
    expect(record?.duration_ms).toBe(500);

    const lines = (await readFile(join(dir, 'sessions/s1/log.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    // Default redaction strips prompt + system.
    expect(parsed).not.toHaveProperty('prompt');
    expect(parsed).not.toHaveProperty('system');
    expect(parsed.tokens.input).toBe(100);
  });

  it('preserves prompt + system when session has record_prompts', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', { recordPrompts: true }, env);
    const binding = await resolveSessionBinding({ session: 's1' }, env);
    await logCallToSession(
      binding,
      {
        verb: 'run',
        provider: 'anthropic',
        startedAtMs: 0,
        finishedAtMs: 100,
        prompt: 'kept',
        system: 'also kept',
        exit: 'ok',
      },
      env,
    );
    const line = (await readFile(join(dir, 'sessions/s1/log.jsonl'), 'utf8')).trim();
    const parsed = JSON.parse(line);
    expect(parsed.prompt).toBe('kept');
    expect(parsed.system).toBe('also kept');
  });

  it('clamps negative durations to 0', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    const binding = await resolveSessionBinding({ session: 's1' }, env);
    const record = await logCallToSession(
      binding,
      {
        verb: 'run',
        provider: 'anthropic',
        startedAtMs: 5000,
        finishedAtMs: 4000, // clock drift
        exit: 'ok',
      },
      env,
    );
    expect(record?.duration_ms).toBe(0);
  });
});
