import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendLogRecord,
  clearCurrentSession,
  createSession,
  deleteSession,
  getCurrentSession,
  getSession,
  keySource,
  listSessions,
  readLogRecords,
  redactLogRecord,
  resolveActiveSession,
  setCurrentSession,
  validateSessionName,
} from '../src/lib/sessions.js';
import { upsertPreset } from '../src/lib/presets.js';
import { SESSION_NAME_REGEX } from '../src/schemas/session.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-sessions-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

describe('SESSION_NAME_REGEX + validateSessionName', () => {
  it('accepts standard slug names', () => {
    for (const name of ['foo', 'foo-bar', 'foo_bar', 'a1-b2_c3', 'market-q3']) {
      expect(SESSION_NAME_REGEX.test(name)).toBe(true);
      expect(() => validateSessionName(name)).not.toThrow();
    }
  });

  it('rejects bad slug names', () => {
    for (const name of ['Foo', 'foo--bar', '-foo', 'foo bar', '']) {
      expect(SESSION_NAME_REGEX.test(name)).toBe(false);
    }
    expect(() => validateSessionName('Bad-Name')).toThrowError(/Invalid session name/);
  });
});

describe('createSession + getSession', () => {
  it('creates a stateless session by default', async () => {
    const { env, dir } = await fixture();
    const meta = await createSession('s1', {}, env);
    expect(meta.mode).toBe('stateless');
    expect(meta.name).toBe('s1');
    expect(meta.totals.calls).toBe(0);

    const onDisk = JSON.parse(
      await readFile(join(dir, 'sessions/s1/meta.json'), 'utf8'),
    );
    expect(onDisk.mode).toBe('stateless');
    expect(onDisk.created_at).toBeDefined();
  });

  it('creates a chat session with preset + label + flags', async () => {
    const { env } = await fixture();
    // Preset must exist to be bound to a session — resolution from slug
    // happens at session-create time and fails fast for missing presets.
    await upsertPreset(
      'deep-research',
      { mode: 'text', provider: 'anthropic' },
      {},
      env,
    );
    const meta = await createSession(
      'research',
      { mode: 'chat', preset: 'deep-research', label: 'Q3 sizing', recordPrompts: true, autoCompact: true },
      env,
    );
    expect(meta.mode).toBe('chat');
    expect(meta.preset_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(meta.label).toBe('Q3 sizing');
    expect(meta.record_prompts).toBe(true);
    expect(meta.auto_compact).toBe(true);
  });

  it('refuses to create a session that already exists', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await expect(createSession('s1', {}, env)).rejects.toThrowError(/already exists/);
  });

  it('rejects bad preset slug at create time', async () => {
    const { env } = await fixture();
    await expect(
      createSession('s1', { preset: 'Bad-Preset' }, env),
    ).rejects.toThrowError(/Invalid session name/);
  });

  it('rejects unknown preset slug at create time', async () => {
    const { env } = await fixture();
    await expect(
      createSession('s1', { preset: 'unknown-preset' }, env),
    ).rejects.toThrowError(/not found/);
  });

  it('rejects bad session name', async () => {
    const { env } = await fixture();
    await expect(createSession('Bad-Name', {}, env)).rejects.toThrowError(
      /Invalid session name/,
    );
  });

  it('getSession throws on missing', async () => {
    const { env } = await fixture();
    await expect(getSession('missing', env)).rejects.toThrowError(/not found/);
  });
});

describe('listSessions', () => {
  it('returns [] when no sessions dir exists', async () => {
    const { env } = await fixture();
    expect(await listSessions(env)).toEqual([]);
  });

  it('lists sessions sorted by name', async () => {
    const { env } = await fixture();
    await createSession('zeta', {}, env);
    await createSession('alpha', { mode: 'chat' }, env);
    const all = await listSessions(env);
    expect(all.map((m) => m.name)).toEqual(['alpha', 'zeta']);
    expect(all[0]!.mode).toBe('chat');
  });

  it('skips non-slug directory names silently', async () => {
    const { env, dir } = await fixture();
    await createSession('keep', {}, env);
    // Drop a non-slug dir into the sessions folder; should be ignored.
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, 'sessions/.tmpdir'), { recursive: true });
    const all = await listSessions(env);
    expect(all.map((m) => m.name)).toEqual(['keep']);
  });
});

describe('deleteSession', () => {
  it('removes the entire session directory by default', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', {}, env);
    expect(await deleteSession('s1', {}, env)).toBe(true);
    await expect(getSession('s1', env)).rejects.toThrowError(/not found/);
    const { access } = await import('node:fs/promises');
    await expect(access(join(dir, 'sessions/s1'))).rejects.toThrow();
  });

  it('preserves log.jsonl when --keep-log is set', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', {}, env);
    await appendLogRecord(
      's1',
      { verb: 'run', provider: 'anthropic', exit: 'ok' },
      env,
    );
    expect(await deleteSession('s1', { keepLog: true }, env)).toBe(true);

    const { access } = await import('node:fs/promises');
    await expect(access(join(dir, 'sessions/s1/log.jsonl'))).resolves.toBeUndefined();
    await expect(access(join(dir, 'sessions/s1/meta.json'))).rejects.toThrow();
  });

  it('returns false for missing sessions', async () => {
    const { env } = await fixture();
    expect(await deleteSession('missing', {}, env)).toBe(false);
  });

  it('clears the pointer if it was pointing at the deleted session', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await setCurrentSession('s1', env);
    await deleteSession('s1', {}, env);
    expect(await getCurrentSession(env)).toBeNull();
  });
});

describe('current-session pointer', () => {
  it('returns null when no pointer exists', async () => {
    const { env } = await fixture();
    expect(await getCurrentSession(env)).toBeNull();
  });

  it('round-trips via setCurrentSession + getCurrentSession', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await setCurrentSession('s1', env);
    expect(await getCurrentSession(env)).toBe('s1');
  });

  it('refuses to point at a session that does not exist', async () => {
    const { env } = await fixture();
    await expect(setCurrentSession('s1', env)).rejects.toThrowError(/not found/);
  });

  it('clearCurrentSession is idempotent', async () => {
    const { env } = await fixture();
    await clearCurrentSession(env);
    await clearCurrentSession(env);
    expect(await getCurrentSession(env)).toBeNull();
  });

  it('treats a corrupt pointer file as empty', async () => {
    const { env, dir } = await fixture();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'current-session'), 'NOT VALID SLUG\n', 'utf8');
    expect(await getCurrentSession(env)).toBeNull();
  });
});

describe('resolveActiveSession', () => {
  it('returns explicit flag when provided, ignoring pointer', async () => {
    const { env } = await fixture();
    await createSession('pointed', {}, env);
    await setCurrentSession('pointed', env);
    expect(await resolveActiveSession('explicit', env)).toBe('explicit');
  });

  it('falls back to pointer when no explicit flag', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await setCurrentSession('s1', env);
    expect(await resolveActiveSession(undefined, env)).toBe('s1');
  });

  it('returns null when neither flag nor pointer is set', async () => {
    const { env } = await fixture();
    expect(await resolveActiveSession(undefined, env)).toBeNull();
  });

  it('validates the explicit name', async () => {
    const { env } = await fixture();
    await expect(resolveActiveSession('Bad-Name', env)).rejects.toThrowError(
      /Invalid session name/,
    );
  });
});

describe('appendLogRecord + readLogRecords', () => {
  it('appends a record and updates totals', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await appendLogRecord(
      's1',
      {
        verb: 'run',
        provider: 'anthropic',
        model: 'claude-opus-4-7',
        duration_ms: 1234,
        tokens: { input: 100, output: 200, cache_read: 80, cache_write: 0 },
        exit: 'ok',
      },
      env,
    );

    const records = await readLogRecords('s1', {}, env);
    expect(records).toHaveLength(1);
    expect(records[0]!.session).toBe('s1');
    expect(records[0]!.tokens?.input).toBe(100);

    const meta = await getSession('s1', env);
    expect(meta.totals.calls).toBe(1);
    expect(meta.totals.input_tokens).toBe(100);
    expect(meta.totals.output_tokens).toBe(200);
    expect(meta.totals.cache_read_tokens).toBe(80);
    expect(meta.last_used_at).toBeDefined();
  });

  it('accumulates totals across multiple appends', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    for (let i = 0; i < 3; i++) {
      await appendLogRecord(
        's1',
        { verb: 'run', provider: 'openai', tokens: { input: 10, output: 5 }, exit: 'ok' },
        env,
      );
    }
    const meta = await getSession('s1', env);
    expect(meta.totals.calls).toBe(3);
    expect(meta.totals.input_tokens).toBe(30);
    expect(meta.totals.output_tokens).toBe(15);
  });

  it('readLogRecords returns [] when log file does not exist', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    expect(await readLogRecords('s1', {}, env)).toEqual([]);
  });

  it('honors --since filter', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await appendLogRecord(
      's1',
      { verb: 'run', provider: 'openai', exit: 'ok', ts: '2026-01-01T00:00:00.000Z' },
      env,
    );
    await appendLogRecord(
      's1',
      { verb: 'run', provider: 'openai', exit: 'ok', ts: '2026-06-01T00:00:00.000Z' },
      env,
    );
    const records = await readLogRecords('s1', { since: '2026-03-01T00:00:00.000Z' }, env);
    expect(records).toHaveLength(1);
    expect(records[0]!.ts).toBe('2026-06-01T00:00:00.000Z');
  });

  it('honors --limit by keeping the most recent records', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    for (let i = 0; i < 5; i++) {
      await appendLogRecord(
        's1',
        { verb: 'run', provider: 'openai', exit: 'ok', ts: `2026-01-0${i + 1}T00:00:00.000Z` },
        env,
      );
    }
    const records = await readLogRecords('s1', { limit: 2 }, env);
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.ts)).toEqual([
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
    ]);
  });

  it('skips malformed lines silently', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', {}, env);
    await appendLogRecord('s1', { verb: 'run', provider: 'openai', exit: 'ok' }, env);
    // Corrupt the file with a bad line in the middle.
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(dir, 'sessions/s1/log.jsonl'), 'not-json\n', 'utf8');
    await appendLogRecord('s1', { verb: 'run', provider: 'openai', exit: 'ok' }, env);

    const records = await readLogRecords('s1', {}, env);
    expect(records).toHaveLength(2);
  });

  it('strips prompt + system when the session has record_prompts: false (default)', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await appendLogRecord(
      's1',
      {
        verb: 'run',
        provider: 'openai',
        exit: 'ok',
        prompt: 'sensitive customer data',
        system: 'secret system prompt',
      },
      env,
    );
    const records = await readLogRecords('s1', {}, env);
    expect(records).toHaveLength(1);
    expect(records[0]!.prompt).toBeUndefined();
    expect(records[0]!.system).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')(
    'creates log.jsonl with 0o600 mode',
    async () => {
      const { env, dir } = await fixture();
      await createSession('s1', {}, env);
      await appendLogRecord(
        's1',
        { verb: 'run', provider: 'openai', exit: 'ok' },
        env,
      );
      const st = await stat(join(dir, 'sessions/s1/log.jsonl'));
      // Mask off file-type bits; only permission bits matter.
      expect(st.mode & 0o777).toBe(0o600);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'creates meta.json with 0o600 mode',
    async () => {
      const { env, dir } = await fixture();
      await createSession('s1', {}, env);
      const st = await stat(join(dir, 'sessions/s1/meta.json'));
      expect(st.mode & 0o777).toBe(0o600);
    },
  );

  it('preserves prompt + system when record_prompts: true', async () => {
    const { env } = await fixture();
    await createSession('s1', { recordPrompts: true }, env);
    await appendLogRecord(
      's1',
      {
        verb: 'run',
        provider: 'openai',
        exit: 'ok',
        prompt: 'kept on purpose',
        system: 'kept too',
      },
      env,
    );
    const records = await readLogRecords('s1', {}, env);
    expect(records[0]!.prompt).toBe('kept on purpose');
    expect(records[0]!.system).toBe('kept too');
  });
});

describe('redactLogRecord', () => {
  it('strips prompt + system bodies by default', () => {
    const record = redactLogRecord(
      {
        verb: 'run',
        provider: 'anthropic',
        exit: 'ok',
        prompt: 'sensitive customer data',
        system: 'secret system prompt',
      },
      { recordPrompts: false },
    );
    expect(record).not.toHaveProperty('prompt');
    expect(record).not.toHaveProperty('system');
  });

  it('keeps prompt + system when recordPrompts is true', () => {
    const record = redactLogRecord(
      {
        verb: 'run',
        provider: 'anthropic',
        exit: 'ok',
        prompt: 'kept',
        system: 'also kept',
      },
      { recordPrompts: true },
    );
    expect(record.prompt).toBe('kept');
    expect(record.system).toBe('also kept');
  });
});

describe('keySource', () => {
  it('returns the env var name when the key matches an env entry', () => {
    expect(keySource('sk-test', ['ANTHROPIC_API_KEY'], { ANTHROPIC_API_KEY: 'sk-test' }))
      .toBe('ANTHROPIC_API_KEY');
  });

  it('returns "flag-override" when the key does not match any env entry', () => {
    expect(keySource('sk-flag', ['ANTHROPIC_API_KEY'], { ANTHROPIC_API_KEY: 'sk-other' }))
      .toBe('flag-override');
  });

  it('returns undefined when no key was used', () => {
    expect(keySource(undefined, ['ANTHROPIC_API_KEY'], {})).toBeUndefined();
  });

  it('checks multiple env var names in order', () => {
    expect(
      keySource('sk-x', ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'], {
        OPENAI_API_KEY: 'sk-x',
      }),
    ).toBe('OPENAI_API_KEY');
  });
});
