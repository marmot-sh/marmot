import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleGetCommand } from '../src/commands/get.js';
import { appendTaskRecord, getTaskRecord, readUsageRecords } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-get-'));
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

describe('handleGetCommand', () => {
  it('errors on missing task id', async () => {
    const { env } = await fixture();
    await expect(handleGetCommand(undefined, {}, { env })).rejects.toThrowError(
      /task id is required/,
    );
  });

  it('errors when --provider is not specified and the task is not in the local index', async () => {
    const { env } = await fixture();
    // task_x was never recorded → can't be inferred → user must pass --provider
    await expect(
      handleGetCommand('task_x', {}, { env }),
    ).rejects.toThrowError(/could not infer the provider.*--provider/s);
  });

  it('infers --provider from the local task index when the task was recorded', async () => {
    const { env } = await fixture();
    await appendTaskRecord(
      { taskId: 't_inferred', provider: 'parallel', verb: 'research' },
      env,
    );
    const stdout = new Cap();
    const fetchFn = (async () => new Response(
      JSON.stringify({ status: 'completed', output: { content: 'ok' } }),
      { status: 200 },
    )) as unknown as typeof fetch;

    // No --provider passed; should be inferred from the index → no throw.
    await handleGetCommand(
      't_inferred',
      { apiKey: 'fake' },
      { env, stdout, fetchFn },
    );
  });

  it('infers verb from local task index when present', async () => {
    const { env } = await fixture();
    await appendTaskRecord(
      { taskId: 't1', provider: 'parallel', verb: 'research' },
      env,
    );
    const stdout = new Cap();
    const fetchFn = (async (url: string | URL | Request) => {
      expect(String(url)).toContain('/v1/tasks/runs/t1');
      return new Response(
        JSON.stringify({ status: 'completed', output: { content: 'done' } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleGetCommand(
      't1',
      { provider: 'parallel', apiKey: 'k' },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.status).toBe('done');
    expect(out.verb).toBe('research');

    const updated = await getTaskRecord('t1', env);
    expect(updated!.status).toBe('done');
    expect(updated!.lastCheckedAt).not.toBeNull();
  });

  it('errors when verb cannot be inferred and not passed', async () => {
    const { env } = await fixture();
    await expect(
      handleGetCommand(
        'unknown_id',
        { provider: 'parallel', apiKey: 'k' },
        { env, stdout: new Cap(), stderr: new Cap() },
      ),
    ).rejects.toThrowError(/Could not infer the task verb/);
  });

  it('accepts explicit --verb when no local record', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(JSON.stringify({ status: 'completed', output: { content: 'ok' } }), {
        status: 200,
      })) as unknown as typeof fetch;
    await handleGetCommand(
      'task_external',
      { provider: 'parallel', verb: 'research', apiKey: 'k' },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.status).toBe('done');
  });

  it('logs a usage record on terminal transition and marks usageLogged', async () => {
    const { env } = await fixture();
    await appendTaskRecord(
      { taskId: 't_completion', provider: 'parallel', verb: 'research' },
      env,
    );
    const fetchFn = (async () =>
      new Response(JSON.stringify({ status: 'completed', output: { content: 'done' } }), {
        status: 200,
      })) as unknown as typeof fetch;
    await handleGetCommand(
      't_completion',
      { provider: 'parallel', apiKey: 'k' },
      { env, stdout: new Cap(), stderr: new Cap(), fetchFn },
    );

    const records = await readUsageRecords({}, env);
    expect(records).toHaveLength(1);
    expect(records[0]!.verb).toBe('research');
    expect(records[0]!.provider).toBe('parallel');
    expect(records[0]!.exit).toBe('ok');
    expect(records[0]!.call_id).toBe('t_completion');

    const updated = await getTaskRecord('t_completion', env);
    expect(updated!.usageLogged).toBe(true);

    // Re-running should not double-log.
    await handleGetCommand(
      't_completion',
      { provider: 'parallel', apiKey: 'k' },
      { env, stdout: new Cap(), stderr: new Cap(), fetchFn },
    );
    const after = await readUsageRecords({}, env);
    expect(after).toHaveLength(1);
  });

  it('returns in-flight status without polling when --wait is not set', async () => {
    const { env } = await fixture();
    await appendTaskRecord(
      { taskId: 't_inflight', provider: 'parallel', verb: 'research' },
      env,
    );
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ status: 'pending' }), { status: 200 });
    }) as unknown as typeof fetch;
    const stdout = new Cap();
    await handleGetCommand(
      't_inflight',
      { provider: 'parallel', apiKey: 'k' },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    expect(calls).toBe(1);
    const out = JSON.parse(stdout.text());
    expect(out.status).toBe('queued');
  });
});
