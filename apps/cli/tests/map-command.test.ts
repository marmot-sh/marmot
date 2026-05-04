import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleMapCommand } from '../src/commands/map.js';
import { writeMarmotConfig } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-map-'));
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

describe('handleMapCommand', () => {
  it('errors on missing url', async () => {
    const { env } = await fixture();
    await expect(handleMapCommand(undefined, {}, { env })).rejects.toThrowError(
      /URL is required/,
    );
  });

  it('errors on missing default provider', async () => {
    const { env } = await fixture();
    await expect(
      handleMapCommand('https://x', {}, { env }),
    ).rejects.toThrowError(/No default provider for "map"/);
  });

  it('errors when --provider lacks map capability (exa)', async () => {
    const { env } = await fixture();
    await expect(
      handleMapCommand('https://x', { provider: 'exa', apiKey: 'k' }, { env }),
    ).rejects.toThrowError(/not supported by "exa"/);
  });

  it('routes through firecrawl with rich entries', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          success: true,
          links: [
            { url: 'https://a', title: 'A', description: 'd' },
            { url: 'https://b', title: 'B', description: 'd' },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await handleMapCommand(
      'https://docs.example.com',
      { provider: 'firecrawl', apiKey: 'k' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.provider).toBe('firecrawl');
    expect(out.verb).toBe('map');
    expect(out.data.urls).toHaveLength(2);
    expect(out.data.urls[0].title).toBe('A');
  });

  it('routes through tavily with bare URLs', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, defaults: { map: { provider: 'tavily' } } },
      env,
    );
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ results: ['https://a', 'https://b'] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await handleMapCommand(
      'https://docs.example.com',
      { apiKey: 'tvly' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data.urls).toHaveLength(2);
    expect(out.data.urls[0].title).toBeNull();
  });
});
