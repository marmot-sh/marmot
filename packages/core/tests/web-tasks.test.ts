import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  appendTaskRecord,
  getTaskRecord,
  listTaskRecords,
  pruneTaskRecords,
  removeTaskRecord,
  updateTaskRecord,
} from '../src/lib/web-tasks.js';
import { resolveWebVerbDefaults } from '../src/lib/config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-tasks-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

describe('web-tasks', () => {
  it('appends a task and returns it from list', async () => {
    const { env } = await fixture();
    const record = await appendTaskRecord(
      {
        taskId: 'task_abc',
        provider: 'parallel',
        verb: 'research',
        label: 'Find pricing for postgres hosts',
      },
      env,
    );
    expect(record).toMatchObject({
      taskId: 'task_abc',
      provider: 'parallel',
      verb: 'research',
      status: 'queued',
      lastCheckedAt: null,
      completedAt: null,
    });

    const list = await listTaskRecords({}, env);
    expect(list).toHaveLength(1);
    expect(list[0]!.taskId).toBe('task_abc');
  });

  it('replaces existing record on duplicate (provider, taskId)', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'task_x', provider: 'exa', verb: 'research' }, env);
    await appendTaskRecord(
      { taskId: 'task_x', provider: 'exa', verb: 'research', status: 'running' },
      env,
    );
    const list = await listTaskRecords({}, env);
    expect(list).toHaveLength(1);
    expect(list[0]!.status).toBe('running');
  });

  it('updates a record and stamps completedAt on terminal transition', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 't1', provider: 'firecrawl', verb: 'crawl' }, env);
    const updated = await updateTaskRecord(
      { taskId: 't1', provider: 'firecrawl', status: 'done' },
      env,
    );
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('done');
    expect(updated!.completedAt).not.toBeNull();
    expect(updated!.lastCheckedAt).not.toBeNull();
  });

  it('returns null when updating a non-existent record', async () => {
    const { env } = await fixture();
    const result = await updateTaskRecord(
      { taskId: 'nope', provider: 'parallel', status: 'done' },
      env,
    );
    expect(result).toBeNull();
  });

  it('filters by provider, verb, status', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'a', provider: 'parallel', verb: 'research' }, env);
    await appendTaskRecord({ taskId: 'b', provider: 'exa', verb: 'research' }, env);
    await appendTaskRecord({ taskId: 'c', provider: 'firecrawl', verb: 'crawl' }, env);

    expect((await listTaskRecords({ provider: 'exa' }, env)).map((t) => t.taskId)).toEqual(['b']);
    expect((await listTaskRecords({ verb: 'crawl' }, env)).map((t) => t.taskId)).toEqual(['c']);
    expect((await listTaskRecords({ status: 'queued' }, env)).map((t) => t.taskId).sort()).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('removes a record by taskId', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'gone', provider: 'tavily', verb: 'research' }, env);
    const ok = await removeTaskRecord('gone', env);
    expect(ok).toBe(true);
    expect(await getTaskRecord('gone', env)).toBeNull();
  });

  it('removeTaskRecord returns false for unknown id', async () => {
    const { env } = await fixture();
    const ok = await removeTaskRecord('never-existed', env);
    expect(ok).toBe(false);
  });

  it('prunes terminal records older than the cutoff', async () => {
    const { env } = await fixture();
    // Insert a "done" record dated yesterday by writing it directly.
    await appendTaskRecord({ taskId: 'old', provider: 'parallel', verb: 'research' }, env);
    await updateTaskRecord(
      { taskId: 'old', provider: 'parallel', status: 'done', completedAt: '2020-01-01T00:00:00.000Z' },
      env,
    );
    await appendTaskRecord({ taskId: 'fresh', provider: 'parallel', verb: 'research' }, env);

    const removed = await pruneTaskRecords({ olderThanDays: 30 }, env);
    expect(removed).toBe(1);
    const remaining = await listTaskRecords({}, env);
    expect(remaining.map((t) => t.taskId)).toEqual(['fresh']);
  });

  it('does not prune in-flight records regardless of age', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'running', provider: 'parallel', verb: 'research' }, env);
    // No status update — stays 'queued'.
    const removed = await pruneTaskRecords({ olderThanDays: 0 }, env);
    expect(removed).toBe(0);
    expect((await listTaskRecords({}, env))).toHaveLength(1);
  });

  it.skipIf(process.platform === 'win32')(
    'creates tasks.json with 0o600 mode',
    async () => {
      const { env, dir } = await fixture();
      await appendTaskRecord({ taskId: 't', provider: 'parallel', verb: 'research' }, env);
      const st = await stat(join(dir, 'tasks.json'));
      expect(st.mode & 0o777).toBe(0o600);
    },
  );
});

describe('resolveWebVerbDefaults', () => {
  it('uses the override flag when provided', () => {
    const result = resolveWebVerbDefaults('search', null, { provider: 'tavily' });
    expect(result.provider).toBe('tavily');
  });

  it('falls back to the configured default', () => {
    const config = {
      version: 1 as const,
      defaults: { search: { provider: 'exa' as const } },
    };
    const result = resolveWebVerbDefaults('search', config);
    expect(result.provider).toBe('exa');
  });

  it('throws with an actionable message when neither is set', () => {
    expect(() => resolveWebVerbDefaults('search', null)).toThrowError(
      /No default provider for "search"/,
    );
  });

  it('handles all 7 web verbs', () => {
    const config = {
      version: 1 as const,
      defaults: {
        search: { provider: 'tavily' as const },
        scrape: { provider: 'firecrawl' as const },
        research: { provider: 'parallel' as const },
        answer: { provider: 'exa' as const },
        crawl: { provider: 'firecrawl' as const },
        map: { provider: 'tavily' as const },
        findall: { provider: 'parallel' as const },
      },
    };
    expect(resolveWebVerbDefaults('search', config).provider).toBe('tavily');
    expect(resolveWebVerbDefaults('scrape', config).provider).toBe('firecrawl');
    expect(resolveWebVerbDefaults('research', config).provider).toBe('parallel');
    expect(resolveWebVerbDefaults('answer', config).provider).toBe('exa');
    expect(resolveWebVerbDefaults('crawl', config).provider).toBe('firecrawl');
    expect(resolveWebVerbDefaults('map', config).provider).toBe('tavily');
    expect(resolveWebVerbDefaults('findall', config).provider).toBe('parallel');
  });
});
