import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleScrapeCommand } from '../src/commands/scrape.js';
import { writeMarmotConfig } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-scrape-'));
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

describe('handleScrapeCommand', () => {
  it('errors on missing urls', async () => {
    const { env } = await fixture();
    await expect(handleScrapeCommand([], {}, { env })).rejects.toThrowError(
      /At least one URL/,
    );
  });

  it('errors on missing default provider', async () => {
    const { env } = await fixture();
    await expect(
      handleScrapeCommand(['https://example.com'], {}, { env }),
    ).rejects.toThrowError(/No default provider for "scrape"/);
  });

  it('errors when --provider is not capable of scrape (brave)', async () => {
    const { env } = await fixture();
    await expect(
      handleScrapeCommand(
        ['https://example.com'],
        { provider: 'brave', apiKey: 'k' },
        { env },
      ),
    ).rejects.toThrowError(/not supported by "brave"/);
  });

  it('routes through firecrawl, single URL', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async (url: string | URL | Request) => {
      expect(String(url)).toContain('api.firecrawl.dev/v2/scrape');
      return new Response(
        JSON.stringify({
          data: { markdown: '# hello', metadata: { title: 'Hello' } },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleScrapeCommand(
      ['https://example.com'],
      { provider: 'firecrawl', apiKey: 'fc' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('firecrawl');
    expect(out.verb).toBe('scrape');
    expect(out.data.pages).toHaveLength(1);
    expect(out.data.pages[0].content).toBe('# hello');
  });

  it('routes through tavily, multi URL', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, defaults: { scrape: { provider: 'tavily' } } },
      env,
    );
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { url: 'https://a', raw_content: 'a' },
            { url: 'https://b', raw_content: 'b' },
          ],
          failed_results: [],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await handleScrapeCommand(
      ['https://a', 'https://b'],
      { apiKey: 'tvly' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data.pages).toHaveLength(2);
  });

  it('honors --raw flag', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const native = { data: { markdown: 'x' } };
    const fetchFn = (async () =>
      new Response(JSON.stringify(native), { status: 200 })) as unknown as typeof fetch;
    await handleScrapeCommand(
      ['https://x'],
      { provider: 'firecrawl', apiKey: 'k', raw: true },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data).toBeNull();
    expect(out.raw).toBeTruthy();
  });

  it('surfaces 401 as auth error', async () => {
    const { env } = await fixture();
    const fetchFn = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(
      handleScrapeCommand(
        ['https://x'],
        { provider: 'exa', apiKey: 'bad' },
        { env, fetchFn },
      ),
    ).rejects.toThrowError(/status 401/);
  });
});
