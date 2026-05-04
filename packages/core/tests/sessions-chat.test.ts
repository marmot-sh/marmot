import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendChatMessage,
  appendLogRecord,
  chatMessagesToHistory,
  clearChatMessages,
  createSession,
  exportSession,
  forkSession,
  getSession,
  lastMarkIndex,
  markChatMessage,
  readChatMessages,
  rewriteChatMessages,
} from '../src/lib/sessions.js';
import { buildUserMessages } from '../src/lib/messages.js';
import { approximateTokens, lookupContextWindow } from '../src/lib/constants.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-chat-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

describe('appendChatMessage + readChatMessages', () => {
  it('appends and reads back', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'hello' }, env);
    await appendChatMessage('s1', { role: 'assistant', content: 'hi' }, env);

    const messages = await readChatMessages('s1', env);
    expect(messages.map((m) => `${m.role}:${m.content}`)).toEqual([
      'user:hello',
      'assistant:hi',
    ]);

    const onDisk = await readFile(join(dir, 'sessions/s1/messages.jsonl'), 'utf8');
    expect(onDisk.trim().split('\n')).toHaveLength(2);
  });

  it('refuses to append to a stateless session', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'stateless' }, env);
    await expect(
      appendChatMessage('s1', { role: 'user', content: 'hi' }, env),
    ).rejects.toThrowError(/not "chat"/);
  });

  it('readChatMessages returns [] when no messages.jsonl exists', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    expect(await readChatMessages('s1', env)).toEqual([]);
  });

  it('skips malformed lines silently', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'a' }, env);
    const { appendFile } = await import('node:fs/promises');
    await appendFile(join(dir, 'sessions/s1/messages.jsonl'), 'not-json\n', 'utf8');
    await appendChatMessage('s1', { role: 'assistant', content: 'b' }, env);

    expect(await readChatMessages('s1', env)).toHaveLength(2);
  });
});

describe('chatMessagesToHistory', () => {
  it('drops mark sentinels and maps summary→assistant', () => {
    const result = chatMessagesToHistory([
      { role: 'user', content: 'a', ts: 't1' },
      { role: 'assistant', content: 'b', ts: 't2' },
      { role: 'summary', content: 'so far we discussed X', ts: 't3' },
      { role: 'user', content: 'c', ts: 't4', mark: 'pivot' },
      { role: 'user', content: 'd', ts: 't5' },
    ]);
    expect(result).toEqual([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'assistant', content: 'so far we discussed X' },
      { role: 'user', content: 'd' },
    ]);
  });

  it('returns [] for empty input', () => {
    expect(chatMessagesToHistory([])).toEqual([]);
  });
});

describe('clearChatMessages', () => {
  it('removes the messages.jsonl file but keeps log + meta', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'x' }, env);
    await appendLogRecord('s1', { verb: 'run', provider: 'openai', exit: 'ok' }, env);

    await clearChatMessages('s1', env);
    expect(await readChatMessages('s1', env)).toEqual([]);
    const meta = await getSession('s1', env);
    expect(meta.totals.calls).toBe(1);
  });

  it('is idempotent on missing files', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await clearChatMessages('s1', env);
    await clearChatMessages('s1', env);
    expect(await readChatMessages('s1', env)).toEqual([]);
  });
});

describe('forkSession', () => {
  it('copies meta + log + messages into a new session', async () => {
    const { env, dir } = await fixture();
    await createSession('src', { mode: 'chat', label: 'original' }, env);
    await appendChatMessage('src', { role: 'user', content: 'a' }, env);
    await appendLogRecord('src', { verb: 'run', provider: 'openai', exit: 'ok' }, env);

    const destMeta = await forkSession('src', 'dest', env);
    expect(destMeta.name).toBe('dest');
    expect(destMeta.mode).toBe('chat');
    expect(destMeta.label).toBe('original');

    expect(await readChatMessages('dest', env)).toHaveLength(1);
    const { access } = await import('node:fs/promises');
    await expect(access(join(dir, 'sessions/dest/log.jsonl'))).resolves.toBeUndefined();
  });

  it('refuses to fork into an existing session', async () => {
    const { env } = await fixture();
    await createSession('a', {}, env);
    await createSession('b', {}, env);
    await expect(forkSession('a', 'b', env)).rejects.toThrowError(/already exists/);
  });

  it('forks even when the source has no log/messages files', async () => {
    const { env } = await fixture();
    await createSession('src', { mode: 'chat' }, env);
    const destMeta = await forkSession('src', 'dest', env);
    expect(destMeta.name).toBe('dest');
    expect(await readChatMessages('dest', env)).toEqual([]);
  });
});

describe('exportSession', () => {
  it('renders jsonl as raw newline-separated records', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'a' }, env);
    await appendChatMessage('s1', { role: 'assistant', content: 'b' }, env);

    const out = await exportSession('s1', 'jsonl', env);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).content).toBe('a');
  });

  it('renders md with role headings and metadata', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat', preset: 'deep-research' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'hello' }, env);
    await appendChatMessage('s1', { role: 'assistant', content: 'hi' }, env);

    const out = await exportSession('s1', 'md', env);
    expect(out).toContain('# Session: s1');
    expect(out).toContain('Mode: chat');
    expect(out).toContain('Preset: deep-research');
    expect(out).toContain('## User');
    expect(out).toContain('hello');
    expect(out).toContain('## Assistant');
    expect(out).toContain('hi');
  });

  it('renders mark sentinels distinctly in md', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'a' }, env);
    await appendChatMessage('s1', { role: 'user', content: '', mark: 'pivot' }, env);

    const out = await exportSession('s1', 'md', env);
    expect(out).toContain('**[mark]** pivot');
  });
});

describe('markChatMessage + lastMarkIndex', () => {
  it('appends a watermark sentinel and finds it', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'a' }, env);
    await markChatMessage('s1', 'pivot', env);
    await appendChatMessage('s1', { role: 'user', content: 'b' }, env);

    const messages = await readChatMessages('s1', env);
    expect(messages).toHaveLength(3);
    expect(messages[1]!.mark).toBe('pivot');
    expect(messages[1]!.content).toBe('');
    expect(lastMarkIndex(messages)).toBe(1);
  });

  it('returns -1 when no marks present', () => {
    expect(lastMarkIndex([])).toBe(-1);
    expect(
      lastMarkIndex([
        { role: 'user', content: 'a', ts: 't1' },
        { role: 'assistant', content: 'b', ts: 't2' },
      ]),
    ).toBe(-1);
  });

  it('rejects empty mark labels', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await expect(markChatMessage('s1', '   ', env)).rejects.toThrowError(/cannot be empty/);
  });

  it('rejects mark on stateless sessions', async () => {
    const { env } = await fixture();
    await createSession('s1', {}, env);
    await expect(markChatMessage('s1', 'pivot', env)).rejects.toThrowError(/not "chat"/);
  });
});

describe('rewriteChatMessages', () => {
  it('replaces messages.jsonl and rotates the previous file', async () => {
    const { env, dir } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await appendChatMessage('s1', { role: 'user', content: 'a' }, env);
    await appendChatMessage('s1', { role: 'assistant', content: 'b' }, env);

    const { rotatedTo } = await rewriteChatMessages(
      's1',
      [{ role: 'summary', content: 'compacted', ts: 't1' }],
      env,
    );
    expect(rotatedTo).not.toBeNull();

    const after = await readChatMessages('s1', env);
    expect(after).toHaveLength(1);
    expect(after[0]!.role).toBe('summary');

    const { access, readFile } = await import('node:fs/promises');
    await expect(access(rotatedTo!)).resolves.toBeUndefined();
    const rotated = await readFile(rotatedTo!, 'utf8');
    expect(rotated.split('\n').filter((l) => l.trim())).toHaveLength(2);
    void dir;
  });

  it('handles empty messages array', async () => {
    const { env } = await fixture();
    await createSession('s1', { mode: 'chat' }, env);
    await rewriteChatMessages('s1', [], env);
    expect(await readChatMessages('s1', env)).toEqual([]);
  });
});

describe('approximateTokens + lookupContextWindow', () => {
  it('approximates tokens as ceil(chars/4)', () => {
    expect(approximateTokens('')).toBe(0);
    expect(approximateTokens('1234')).toBe(1);
    expect(approximateTokens('12345')).toBe(2);
  });

  it('matches model name substrings', () => {
    expect(lookupContextWindow('claude-opus-4-7')).toBe(200_000);
    expect(lookupContextWindow('gpt-4o')).toBe(128_000);
    expect(lookupContextWindow('gemini-1.5-pro')).toBe(2_000_000);
  });

  it('returns null for unknown models', () => {
    expect(lookupContextWindow('some-future-model-xyz')).toBeNull();
  });
});

describe('buildUserMessages with history', () => {
  it('returns undefined when no history, no images, no files', () => {
    expect(buildUserMessages({ prompt: 'hi' })).toBeUndefined();
  });

  it('prepends history then appends current user prompt', () => {
    const result = buildUserMessages({
      prompt: 'now what',
      history: [
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'first reply' },
      ],
    });
    expect(result).toHaveLength(3);
    expect(result![0]!.role).toBe('user');
    expect(result![1]!.role).toBe('assistant');
    expect(result![2]!.role).toBe('user');
    expect(result![2]!.content[0]).toEqual({ type: 'text', text: 'now what' });
  });

  it('combines history with the current image attachment', () => {
    const result = buildUserMessages({
      prompt: 'describe',
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
      history: [{ role: 'user', content: 'context' }],
    });
    expect(result).toHaveLength(2);
    expect(result![1]!.content).toHaveLength(2);
    expect(result![1]!.content[1]!.type).toBe('image');
  });
});
