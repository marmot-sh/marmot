import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleCrawlCommand } from '../src/commands/crawl.js';
import { listTaskRecords } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-crawl-'));
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

describe('handleCrawlCommand', () => {
  it('errors on missing url', async () => {
    const { env } = await fixture();
    await expect(handleCrawlCommand(undefined, {}, { env })).rejects.toThrowError(/URL is required/);
  });

  it('errors when --wait and --async are both set', async () => {
    const { env } = await fixture();
    await expect(
      handleCrawlCommand('https://x', { wait: true, async: true }, { env }),
    ).rejects.toThrowError(/mutually exclusive/);
  });

  it('errors when --provider lacks crawl capability (exa)', async () => {
    const { env } = await fixture();
    await expect(
      handleCrawlCommand('https://x', { provider: 'exa', apiKey: 'k' }, { env }),
    ).rejects.toThrowError(/not supported by "exa"/);
  });

  it('tavily sync — returns full result inline, no task record', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          base_url: 'https://docs.example.com',
          results: [
            { url: 'https://docs.example.com/a', raw_content: 'A' },
            { url: 'https://docs.example.com/b', raw_content: 'B' },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await handleCrawlCommand(
      'https://docs.example.com',
      { provider: 'tavily', apiKey: 'tvly', maxPages: '50' },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.provider).toBe('tavily');
    expect(out.data.pages).toHaveLength(2);
    expect(out.taskId).toBeUndefined();
    expect(await listTaskRecords({}, env)).toEqual([]);
  });

  it('firecrawl --async — submits, writes record, emits next', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(JSON.stringify({ id: 'crawl_1' }), { status: 200 })) as unknown as typeof fetch;

    await handleCrawlCommand(
      'https://example.com',
      { provider: 'firecrawl', apiKey: 'k', async: true, maxPages: '5' },
      { env, stdout, stderr: new Cap(), fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.taskId).toBe('crawl_1');
    expect(out.status).toBe('queued');
    expect(out.next).toContain('marmot get crawl_1 --provider firecrawl');
    const records = await listTaskRecords({}, env);
    expect(records[0]!.verb).toBe('crawl');
    expect(records[0]!.provider).toBe('firecrawl');
  });
});
