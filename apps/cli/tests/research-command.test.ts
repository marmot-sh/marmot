import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleResearchCommand } from '../src/commands/research.js';
import { listTaskRecords, writeMarmotConfig } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-research-'));
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

describe('handleResearchCommand', () => {
  it('errors on missing query', async () => {
    const { env } = await fixture();
    await expect(handleResearchCommand([], {}, { env })).rejects.toThrowError(/Query is required/);
  });

  it('errors when --wait and --async are both set', async () => {
    const { env } = await fixture();
    await expect(
      handleResearchCommand(['x'], { wait: true, async: true }, { env }),
    ).rejects.toThrowError(/mutually exclusive/);
  });

  it('errors on missing default provider', async () => {
    const { env } = await fixture();
    await expect(
      handleResearchCommand(['hi'], { async: true }, { env }),
    ).rejects.toThrowError(/No default provider for "research"/);
  });

  it('--async returns task id, writes record, exits without polling', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const stderr = new Cap();
    const fetchFn = (async () =>
      new Response(JSON.stringify({ id: 'task_xyz' }), { status: 200 })) as unknown as typeof fetch;

    await handleResearchCommand(
      ['study postgres'],
      { provider: 'exa', apiKey: 'k', async: true },
      { env, stdout, stderr, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.taskId).toBe('task_xyz');
    expect(out.status).toBe('queued');
    expect(out.next).toContain('marmot get task_xyz --provider exa');

    const records = await listTaskRecords({}, env);
    expect(records).toHaveLength(1);
    expect(records[0]!.taskId).toBe('task_xyz');
    expect(records[0]!.verb).toBe('research');
    expect(records[0]!.provider).toBe('exa');
  });

  it('--wait polls until terminal state, prints final result, updates record', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, defaults: { research: { provider: 'parallel' } } },
      env,
    );
    const stdout = new Cap();
    const stderr = new Cap();
    let pollCount = 0;
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/v1/tasks/runs')) {
        // submission
        return new Response(JSON.stringify({ run_id: 'run_w' }), { status: 200 });
      }
      // polling endpoint — return done immediately
      pollCount += 1;
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: { content: 'final answer' },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleResearchCommand(
      ['x'],
      { apiKey: 'k' }, // default --wait
      { env, stdout, stderr, fetchFn },
    );
    expect(pollCount).toBeGreaterThanOrEqual(1);
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.status).toBe('done');
    expect(out.taskId).toBe('run_w');

    const records = await listTaskRecords({}, env);
    expect(records[0]!.status).toBe('done');
    expect(records[0]!.completedAt).not.toBeNull();
  });

  it('--schema-file passes parsed JSON Schema to the adapter', async () => {
    const { env, dir } = await fixture();
    const schemaPath = join(dir, 'schema.json');
    await (await import('node:fs/promises')).writeFile(
      schemaPath,
      JSON.stringify({ type: 'object', properties: { name: { type: 'string' } } }),
      'utf8',
    );
    let captured: Record<string, unknown> | undefined;
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'task_s' }), { status: 200 });
    }) as unknown as typeof fetch;

    await handleResearchCommand(
      ['x'],
      { provider: 'exa', apiKey: 'k', async: true, schemaFile: schemaPath },
      { env, stdout: new Cap(), stderr: new Cap(), fetchFn },
    );
    const output = (captured as { output?: { schema?: Record<string, unknown> } } | undefined)?.output;
    expect(output?.schema).toMatchObject({ type: 'object' });
  });

  it('surfaces 401 from submission as auth error', async () => {
    const { env } = await fixture();
    const fetchFn = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(
      handleResearchCommand(
        ['x'],
        { provider: 'exa', apiKey: 'bad', async: true },
        { env, stdout: new Cap(), stderr: new Cap(), fetchFn },
      ),
    ).rejects.toThrowError(/status 401/);
  });

  it('terminal failed status surfaces ok:false but does not throw', async () => {
    const { env } = await fixture();
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/research/v0/tasks')) {
        return new Response(JSON.stringify({ id: 'task_f' }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'failed' }), { status: 200 });
    }) as unknown as typeof fetch;

    const stdout = new Cap();
    await handleResearchCommand(
      ['x'],
      { provider: 'exa', apiKey: 'k' },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(false);
    expect(out.status).toBe('failed');
  });
});
