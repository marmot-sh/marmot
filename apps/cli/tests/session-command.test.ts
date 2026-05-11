import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  handleSessionCompact,
  handleSessionContext,
  handleSessionCreate,
  handleSessionCurrent,
  handleSessionDelete,
  handleSessionEnd,
  handleSessionExport,
  handleSessionFork,
  handleSessionList,
  handleSessionLog,
  handleSessionMark,
  handleSessionReset,
  handleSessionShow,
  handleSessionStats,
  handleSessionUse,
} from '../src/commands/session/index.js';
import { appendChatMessage, appendLogRecord, readChatMessages, upsertPreset } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-session-cmd-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
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

describe('session create', () => {
  it('creates a stateless session by default', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleSessionCreate('s1', {}, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.ok).toBe(true);
    expect(out.session.mode).toBe('stateless');
  });

  it('creates a chat session with a text-mode preset', async () => {
    const { env } = await fixture();
    await upsertPreset('research', { mode: 'text', provider: 'anthropic' }, {}, env);
    const cap = captureStdout();
    await handleSessionCreate(
      'r1',
      { mode: 'chat', preset: 'research', label: 'q3', recordPrompts: true },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.session.mode).toBe('chat');
    expect(out.session.preset_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.session.label).toBe('q3');
    expect(out.session.record_prompts).toBe(true);
  });

  it('rejects chat session bound to a non-text preset', async () => {
    const { env } = await fixture();
    await upsertPreset('square', { mode: 'image', provider: 'openai' }, {}, env);
    await expect(
      handleSessionCreate('r1', { mode: 'chat', preset: 'square' }, { env }),
    ).rejects.toThrowError(/only accept text-mode presets/);
  });

  it('rejects unknown mode', async () => {
    const { env } = await fixture();
    await expect(
      handleSessionCreate('s1', { mode: 'video' }, { env }),
    ).rejects.toThrowError(/Unknown session mode/);
  });

  it('rejects bad name', async () => {
    const { env } = await fixture();
    await expect(
      handleSessionCreate('Bad-Name', {}, { env }),
    ).rejects.toThrowError(/Invalid session name/);
  });
});

describe('session use + current + end', () => {
  it('round-trips: use → current → end', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });

    const useCap = captureStdout();
    await handleSessionUse('s1', { env, stdout: useCap.writer });
    expect(JSON.parse(useCap.text).action).toBe('use');

    const currentCap = captureStdout();
    await handleSessionCurrent({ env, stdout: currentCap.writer });
    expect(JSON.parse(currentCap.text).current).toBe('s1');

    const endCap = captureStdout();
    await handleSessionEnd({ env, stdout: endCap.writer });
    expect(JSON.parse(endCap.text).cleared).toBe('s1');

    const after = captureStdout();
    await handleSessionCurrent({ env, stdout: after.writer });
    expect(JSON.parse(after.text).current).toBeNull();
  });

  it('refuses to point at a missing session', async () => {
    const { env } = await fixture();
    await expect(handleSessionUse('missing', { env })).rejects.toThrowError(/not found/);
  });
});

describe('session list + get', () => {
  it('lists sessions with summary fields', async () => {
    const { env } = await fixture();
    await handleSessionCreate('alpha', { mode: 'chat' }, { env });
    await handleSessionCreate('zeta', { mode: 'stateless', label: 'misc' }, { env });

    const cap = captureStdout();
    await handleSessionList({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.sessions.map((s: { name: string }) => s.name)).toEqual(['alpha', 'zeta']);
    expect(out.sessions[0].mode).toBe('chat');
    expect(out.sessions[1].label).toBe('misc');
  });

  it('shows full metadata for one session', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    const cap = captureStdout();
    await handleSessionShow('s1', { json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.session.name).toBe('s1');
    expect(out.session.totals.calls).toBe(0);
  });

  it('session list --markdown emits a markdown table with the expected headers', async () => {
    const { env } = await fixture();
    await handleSessionCreate('alpha', { mode: 'chat' }, { env });
    await handleSessionCreate('zeta', { mode: 'stateless', label: 'misc' }, { env });
    const cap = captureStdout();
    await handleSessionList({ markdown: true }, { env, stdout: cap.writer });
    const out = cap.text;
    expect(out).toMatch(/^\| NAME \| MODE \| PRESET \| CALLS \| LAST USED \|/m);
    expect(out).toMatch(/\| alpha \| chat \|/);
    expect(out).toMatch(/\| zeta \| stateless \|/);
  });

  it('session list rejects --json + --markdown together', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await expect(
      handleSessionList({ json: true, markdown: true }, { env, stdout: cap.writer }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  it('session get --markdown emits ## title and section ### headings', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', { mode: 'stateless', label: 'demo' }, { env });
    const cap = captureStdout();
    await handleSessionShow('s1', { markdown: true }, { env, stdout: cap.writer });
    const out = cap.text;
    expect(out).toMatch(/## Session "s1"/);
    expect(out).toMatch(/### Identity/);
    expect(out).toMatch(/### Totals/);
  });
});

describe('session delete', () => {
  it('deletes a session and clears the pointer', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await handleSessionUse('s1', { env });

    const cap = captureStdout();
    await handleSessionDelete('s1', {}, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).removed).toBe(true);

    const after = captureStdout();
    await handleSessionCurrent({ env, stdout: after.writer });
    expect(JSON.parse(after.text).current).toBeNull();
  });

  it('preserves log when --keep-log is set', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await appendLogRecord('s1', { verb: 'run', provider: 'openai', exit: 'ok' }, env);
    const cap = captureStdout();
    await handleSessionDelete('s1', { keepLog: true }, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).kept_log).toBe(true);
  });

  it('reports removed=false for missing sessions', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleSessionDelete('missing', {}, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).removed).toBe(false);
  });
});

describe('session log', () => {
  it('returns empty records when no log exists', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    const cap = captureStdout();
    await handleSessionLog('s1', {}, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).records).toEqual([]);
  });

  it('renders json by default', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await appendLogRecord(
      's1',
      { verb: 'run', provider: 'anthropic', model: 'claude-opus-4-7', tokens: { input: 50, output: 25 }, exit: 'ok' },
      env,
    );
    const cap = captureStdout();
    await handleSessionLog('s1', {}, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.records).toHaveLength(1);
    expect(out.records[0].verb).toBe('run');
  });

  it('renders a table with --table', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await appendLogRecord(
      's1',
      { verb: 'run', provider: 'openai', tokens: { input: 1, output: 2 }, exit: 'ok' },
      env,
    );
    const cap = captureStdout();
    await handleSessionLog('s1', { table: true }, { env, stdout: cap.writer });
    expect(cap.text).toContain('verb');
    expect(cap.text).toContain('run');
  });

  it('honors --limit', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    for (let i = 0; i < 5; i++) {
      await appendLogRecord('s1', { verb: 'run', provider: 'openai', exit: 'ok' }, env);
    }
    const cap = captureStdout();
    await handleSessionLog('s1', { limit: '2' }, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).records).toHaveLength(2);
  });

  it('rejects non-numeric --limit', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await expect(
      handleSessionLog('s1', { limit: 'abc' }, { env }),
    ).rejects.toThrowError(/--limit must be/);
  });
});

describe('session context', () => {
  it('rejects on stateless session', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await expect(handleSessionContext('s1', {}, { env })).rejects.toThrowError(/not "chat"/);
  });

  it('renders messages as JSON when --json is set', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'a' }, env);
    const cap = captureStdout();
    await handleSessionContext('c1', { json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.messages).toHaveLength(1);
  });

  it('renders human-readable text by default', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'hello' }, env);
    await appendChatMessage('c1', { role: 'assistant', content: 'hi' }, env);
    const cap = captureStdout();
    await handleSessionContext('c1', {}, { env, stdout: cap.writer });
    expect(cap.text).toContain('[user] hello');
    expect(cap.text).toContain('[assistant] hi');
  });
});

describe('session reset', () => {
  it('clears messages but keeps log + meta', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'x' }, env);
    await appendLogRecord('c1', { verb: 'run', provider: 'openai', exit: 'ok' }, env);

    await handleSessionReset('c1', { env });
    expect(await readChatMessages('c1', env)).toEqual([]);
  });

  it('refuses on stateless sessions', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await expect(handleSessionReset('s1', { env })).rejects.toThrowError(/not "chat"/);
  });
});

describe('session fork', () => {
  it('creates a new session that mirrors the source', async () => {
    const { env } = await fixture();
    await handleSessionCreate('src', { mode: 'chat', label: 'orig' }, { env });
    await appendChatMessage('src', { role: 'user', content: 'a' }, env);
    const cap = captureStdout();
    await handleSessionFork('src', 'dest', { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.session.name).toBe('dest');
    expect(out.session.label).toBe('orig');
    expect(await readChatMessages('dest', env)).toHaveLength(1);
  });
});

describe('session export', () => {
  it('defaults to jsonl', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'a' }, env);
    const cap = captureStdout();
    await handleSessionExport('c1', {}, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text.trim()).content).toBe('a');
  });

  it('renders markdown with --format md', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'hello' }, env);
    const cap = captureStdout();
    await handleSessionExport('c1', { format: 'md' }, { env, stdout: cap.writer });
    expect(cap.text).toContain('# Session: c1');
    expect(cap.text).toContain('hello');
  });

  it('rejects unknown formats', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await expect(
      handleSessionExport('c1', { format: 'pdf' }, { env }),
    ).rejects.toThrowError(/Unknown --format/);
  });
});

describe('session mark', () => {
  it('records a watermark on a chat session', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'a' }, env);
    const cap = captureStdout();
    await handleSessionMark('c1', 'pivot', { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.mark.mark).toBe('pivot');
    expect(out.mark.content).toBe('');
  });

  it('rejects empty labels', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await expect(handleSessionMark('c1', '   ', { env })).rejects.toThrowError(/cannot be empty/);
  });

  it('rejects on stateless sessions', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await expect(handleSessionMark('s1', 'x', { env })).rejects.toThrowError(/not "chat"/);
  });
});

describe('session get window stats', () => {
  it('returns null window for stateless sessions', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    const cap = captureStdout();
    await handleSessionShow('s1', { json: true }, { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).window).toBeNull();
  });

  it('reports tokens_in_window for chat sessions', async () => {
    const { env } = await fixture();
    await upsertPreset('p1', { mode: 'text', provider: 'anthropic', model: 'claude-opus-4-7' }, {}, env);
    await handleSessionCreate('c1', { mode: 'chat', preset: 'p1' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'a'.repeat(40) }, env);
    const cap = captureStdout();
    await handleSessionShow('c1', { json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.window.tokens_in_window).toBeGreaterThan(0);
    expect(out.window.model).toBe('claude-opus-4-7');
    expect(out.window.model_max_tokens).toBe(200_000);
    expect(out.window.percent_used).toBeLessThan(1);
  });
});

describe('session compact validation', () => {
  it('rejects on stateless sessions', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await expect(handleSessionCompact('s1', {}, { env })).rejects.toThrowError(/not "chat"/);
  });

  it('rejects when there are no messages to compact', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await expect(handleSessionCompact('c1', {}, { env })).rejects.toThrowError(/no messages/);
  });

  it('rejects when --keep-last protects everything', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'a' }, env);
    await appendChatMessage('c1', { role: 'assistant', content: 'b' }, env);
    await expect(
      handleSessionCompact('c1', { keepLast: '10' }, { env }),
    ).rejects.toThrowError(/all 2 messages are protected/);
  });

  it('rejects non-numeric --keep-last', async () => {
    const { env } = await fixture();
    await handleSessionCreate('c1', { mode: 'chat' }, { env });
    await appendChatMessage('c1', { role: 'user', content: 'a' }, env);
    await expect(
      handleSessionCompact('c1', { keepLast: 'abc' }, { env }),
    ).rejects.toThrowError(/--keep-last must be/);
  });
});

describe('session stats', () => {
  it('reports totals and cache hit rate', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    await appendLogRecord(
      's1',
      { verb: 'run', provider: 'anthropic', tokens: { input: 100, output: 50, cache_read: 80 }, exit: 'ok' },
      env,
    );
    const cap = captureStdout();
    await handleSessionStats('s1', { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.calls).toBe(1);
    expect(out.tokens.input).toBe(100);
    expect(out.tokens.cache_read).toBe(80);
    expect(out.cache_hit_rate).toBe(0.8);
  });

  it('reports zero cache hit rate when no input tokens', async () => {
    const { env } = await fixture();
    await handleSessionCreate('s1', {}, { env });
    const cap = captureStdout();
    await handleSessionStats('s1', { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).cache_hit_rate).toBe(0);
  });
});
