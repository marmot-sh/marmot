import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildTasksCommand } from '../src/commands/tasks/index.js';
import { appendTaskRecord, getTaskRecord, listTaskRecords } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-tasks-cmd-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

class Cap {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

async function runTasks(args: string[], env: NodeJS.ProcessEnv, stdout: Cap): Promise<void> {
  const cmd = buildTasksCommand({ env, stdout });
  await cmd.parseAsync(args, { from: 'user' });
}

describe('marmot tasks command group', () => {
  it('list returns empty when no records', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    await runTasks(['list'], env, stdout);
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.data.tasks).toEqual([]);
    expect(out.data.count).toBe(0);
  });

  it('list returns recorded tasks (newest first)', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'a', provider: 'exa', verb: 'research' }, env);
    await new Promise((r) => setTimeout(r, 10));
    await appendTaskRecord({ taskId: 'b', provider: 'parallel', verb: 'findall' }, env);
    const stdout = new Cap();
    await runTasks(['list'], env, stdout);
    const out = JSON.parse(stdout.text());
    expect(out.data.count).toBe(2);
    expect(out.data.tasks[0].taskId).toBe('b');
  });

  it('list filters by --provider, --verb, --status', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'a', provider: 'exa', verb: 'research' }, env);
    await appendTaskRecord({ taskId: 'b', provider: 'parallel', verb: 'research' }, env);
    await appendTaskRecord({ taskId: 'c', provider: 'firecrawl', verb: 'crawl' }, env);
    const stdout = new Cap();
    await runTasks(['list', '--provider', 'parallel'], env, stdout);
    const out = JSON.parse(stdout.text());
    expect(out.data.tasks.map((t: { taskId: string }) => t.taskId)).toEqual(['b']);
  });

  it('show returns one record', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'show_me', provider: 'exa', verb: 'findall' }, env);
    const stdout = new Cap();
    await runTasks(['show', 'show_me'], env, stdout);
    const out = JSON.parse(stdout.text());
    expect(out.data.taskId).toBe('show_me');
  });

  it('show errors on unknown id', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    await expect(runTasks(['show', 'nope'], env, stdout)).rejects.toThrowError(
      /No local task record for "nope"/,
    );
  });

  it('remove drops a record', async () => {
    const { env } = await fixture();
    await appendTaskRecord({ taskId: 'gone', provider: 'exa', verb: 'research' }, env);
    const stdout = new Cap();
    await runTasks(['remove', 'gone'], env, stdout);
    expect(await getTaskRecord('gone', env)).toBeNull();
  });

  it('remove errors on unknown id', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    await expect(runTasks(['remove', 'nope'], env, stdout)).rejects.toThrowError(
      /No local task record for "nope"/,
    );
  });

  it('prune removes terminal records older than the cutoff', async () => {
    const { env } = await fixture();
    // Append a finished task and force its completedAt into the past via direct file write.
    await appendTaskRecord({ taskId: 'old', provider: 'exa', verb: 'research' }, env);
    const { updateTaskRecord } = await import('@marmot-sh/core');
    await updateTaskRecord(
      {
        taskId: 'old',
        provider: 'exa',
        status: 'done',
        completedAt: '2020-01-01T00:00:00.000Z',
      },
      env,
    );
    await appendTaskRecord({ taskId: 'fresh', provider: 'exa', verb: 'research' }, env);
    const stdout = new Cap();
    await runTasks(['prune', '--older-than', '30'], env, stdout);
    const out = JSON.parse(stdout.text());
    expect(out.data.removed).toBe(1);
    const remaining = await listTaskRecords({}, env);
    expect(remaining.map((t) => t.taskId)).toEqual(['fresh']);
  });
});
