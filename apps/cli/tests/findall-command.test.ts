import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleFindallCommand } from '../src/commands/findall.js';
import { listTaskRecords } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-findall-'));
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

describe('handleFindallCommand', () => {
  it('errors on missing objective', async () => {
    const { env } = await fixture();
    await expect(handleFindallCommand([], {}, { env })).rejects.toThrowError(
      /Findall requires a query/,
    );
  });

  it('errors when --wait and --async are both set', async () => {
    const { env } = await fixture();
    await expect(
      handleFindallCommand(['x'], { wait: true, async: true }, { env }),
    ).rejects.toThrowError(/mutually exclusive/);
  });

  it('errors when --provider lacks findall capability (firecrawl)', async () => {
    const { env } = await fixture();
    await expect(
      handleFindallCommand(['x'], { provider: 'firecrawl', apiKey: 'k' }, { env }),
    ).rejects.toThrowError(/not supported by "firecrawl"/);
  });

  it('--async via parallel writes task record + emits next command', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers['parallel-beta']).toBe('findall-2025-09-15');
      return new Response(JSON.stringify({ findall_id: 'fa_1' }), { status: 200 });
    }) as unknown as typeof fetch;

    await handleFindallCommand(
      ['major', 'us', 'cloud', 'providers'],
      {
        provider: 'parallel',
        apiKey: 'k',
        async: true,
        entityType: 'cloud_provider',
        limit: '5',
      },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.taskId).toBe('fa_1');
    expect(out.next).toContain('marmot get fa_1 --provider parallel');
    const records = await listTaskRecords({}, env);
    expect(records[0]!.verb).toBe('findall');
  });

  it('--match-conditions JSON parse error surfaces clearly', async () => {
    const { env } = await fixture();
    await expect(
      handleFindallCommand(
        ['x'],
        {
          provider: 'parallel',
          apiKey: 'k',
          async: true,
          entityType: 'thing',
          matchConditions: 'not-json',
        },
        { env, stdout: new Cap(), stderr: new Cap() },
      ),
    ).rejects.toThrowError(/--match-conditions must be valid JSON/);
  });
});
