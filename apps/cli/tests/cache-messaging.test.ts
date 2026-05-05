import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRunCommand } from '../src/commands/run.js';
import type { ProviderAdapter } from '../src/providers/index.js';
import type { ProviderCacheFile } from '@marmot-sh/core';

function makeOllamaAdapter(
  refreshOverride?: () => Promise<ProviderCacheFile> | ProviderCacheFile,
): ProviderAdapter {
  return {
    slug: 'ollama',
    name: 'Ollama',
    defaultModel: 'qwen3:4b',
    requiresApiKey: false,
    capabilities: { text: true, image: false, speech: false, transcription: false },
    async generate({ model, prompt }) {
      return {
        provider: 'ollama' as const,
        model,
        text: `Echo: ${prompt}`,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      };
    },
    generateObject: vi.fn(),
    stream: vi.fn(),
    refreshModels: vi.fn(async ({ now }) => {
      if (refreshOverride) {
        return refreshOverride();
      }
      return {
        version: 1 as const,
        provider: 'ollama' as const,
        defaultModel: 'qwen3:4b',
        fetchedAt: (now?.() ?? new Date()).toISOString(),
        models: [
          {
            id: 'qwen3:4b',
            name: 'qwen3:4b',
            contextLength: null,
            pricing: null,
            inputModalities: ['text'],
            outputModalities: ['text'],
            updatedAt: null,
            metadata: {},
          },
        ],
      };
    }),
  };
}

function makeStream(isTTY: boolean) {
  const buffer: string[] = [];
  return {
    isTTY,
    write(chunk: string | Buffer) {
      buffer.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    },
    get text() {
      return buffer.join('');
    },
  };
}

describe('cache messaging', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function fixture() {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-cache-msg-'));
    tempDirs.push(tempDir);
    return {
      env: { MARMOT_HOME: join(tempDir, '.marmot') },
    };
  }

  it('emits a Cached message on first use of a provider', async () => {
    const stdout = makeStream(true);
    const stderr = makeStream(true);
    const adapter = makeOllamaAdapter();
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      { provider: 'ollama', json: true },
      {
        env,
        stdout,
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(stderr.text).toMatch(/Cached \d+ Ollama models/);
    expect(stdout.text).toContain('"text"');
    expect(stdout.text).not.toMatch(/Cached/);
  });

  it('writes nothing to stderr when the cache is fresh', async () => {
    const adapter = makeOllamaAdapter();
    const { env } = await fixture();
    const fixedTime = new Date('2026-04-29T12:00:00.000Z');

    // Prime the cache
    await handleRunCommand(
      ['warm up'],
      { provider: 'ollama' },
      {
        env,
        stdout: makeStream(true),
        stderr: makeStream(true),
        now: () => fixedTime,
        resolveProvider: () => adapter,
      },
    );

    // Second call — should hit cache, no stderr output
    const stderr = makeStream(true);
    await handleRunCommand(
      ['second call'],
      { provider: 'ollama' },
      {
        env,
        stdout: makeStream(true),
        stderr,
        now: () => fixedTime, // fresh
        resolveProvider: () => adapter,
      },
    );

    expect(stderr.text).not.toMatch(/Cached/);
    expect(stderr.text).not.toMatch(/Refreshing/);
    expect(stderr.text).not.toMatch(/stale/);
  });

  it('emits "Using stale cache" when refresh fails but stale cache exists', async () => {
    const { env } = await fixture();
    const fixedTime = new Date('2026-04-29T12:00:00.000Z');
    let fail = false;
    const adapter = makeOllamaAdapter(async () => {
      if (fail) {
        throw new Error('network down');
      }
      return {
        version: 1,
        provider: 'ollama',
        defaultModel: 'qwen3:4b',
        fetchedAt: fixedTime.toISOString(),
        models: [
          {
            id: 'qwen3:4b',
            name: 'qwen3:4b',
            contextLength: null,
            pricing: null,
            inputModalities: ['text'],
            outputModalities: ['text'],
            updatedAt: null,
            metadata: {},
          },
        ],
      };
    });

    // Prime cache
    await handleRunCommand(
      ['prime'],
      { provider: 'ollama' },
      {
        env,
        stdout: makeStream(true),
        stderr: makeStream(true),
        now: () => fixedTime,
        resolveProvider: () => adapter,
      },
    );

    // Force refresh by jumping past the 24h TTL, AND make refresh fail
    fail = true;
    const stderr = makeStream(true);
    await handleRunCommand(
      ['second call'],
      { provider: 'ollama' },
      {
        env,
        stdout: makeStream(true),
        stderr,
        now: () => new Date('2026-05-01T00:00:00.000Z'), // > 24h later
        resolveProvider: () => adapter,
      },
    );

    expect(stderr.text).toMatch(/stale Ollama cache/);
  });

  it('suppresses all cache messaging when stderr is not a TTY', async () => {
    const stderr = makeStream(false);
    const adapter = makeOllamaAdapter();
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      { provider: 'ollama' },
      {
        env,
        stdout: makeStream(true),
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(stderr.text).toBe('');
  });

  it('suppresses cache messaging when CI is set', async () => {
    const stderr = makeStream(true);
    const adapter = makeOllamaAdapter();
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      { provider: 'ollama' },
      {
        env: { ...env, CI: 'true' },
        stdout: makeStream(true),
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(stderr.text).toBe('');
  });
});
