import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleRunCommand,
  handleStreamRunCommand,
} from '../src/commands/run.js';
import type { ProviderAdapter } from '../src/providers/index.js';

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

const ollamaCache = (now?: () => Date) => ({
  version: 1 as const,
  provider: 'ollama' as const,
  defaultModel: 'qwen3.5:4b',
  fetchedAt: (now?.() ?? new Date()).toISOString(),
  models: [
    {
      id: 'qwen3.5:4b',
      name: 'qwen3.5:4b',
      contextLength: null,
      pricing: null,
      inputModalities: ['text'],
      outputModalities: ['text'],
      updatedAt: null,
      metadata: {},
    },
  ],
});

function makeAdapter(): ProviderAdapter {
  return {
    slug: 'ollama',
    name: 'Ollama',
    defaultModel: 'qwen3.5:4b',
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
    async generateObject({ model }) {
      return {
        provider: 'ollama' as const,
        model,
        output: { ok: true },
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        finishReason: 'stop',
      };
    },
    async stream({ model, prompt }) {
      async function* iter() {
        yield 'Hello ';
        yield 'world';
      }
      const completed = (async () => ({
        provider: 'ollama' as const,
        model,
        text: 'Hello world',
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        finishReason: 'stop',
      }))();
      return {
        textStream: iter(),
        complete: completed,
      };
    },
    refreshModels: vi.fn(async ({ now }) => ollamaCache(now)),
  };
}

describe('generation spinner — non-stream', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function fixture() {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-spinner-'));
    tempDirs.push(tempDir);
    return { env: { MARMOT_HOME: join(tempDir, '.marmot') } };
  }

  it('writes a Generating status to stderr when stderr is a TTY', async () => {
    const stdout = makeStream(true);
    const stderr = makeStream(true);
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      { provider: 'ollama', json: true },
      {
        env,
        stdout,
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => makeAdapter(),
      },
    );

    expect(stderr.text).toMatch(/Generating Ollama response/);
    // stdout must remain pure JSON envelope, no spinner artifacts
    expect(stdout.text).not.toMatch(/Generating/);
    expect(stdout.text).toContain('"provider": "ollama"');
  });

  it('writes nothing spinner-related when stderr is not a TTY', async () => {
    const stderr = makeStream(false);
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      { provider: 'ollama' },
      {
        env,
        stdout: makeStream(true),
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => makeAdapter(),
      },
    );

    expect(stderr.text).toBe('');
  });

  it('writes a Generating status for object mode (--schema-file)', async () => {
    const stderr = makeStream(true);
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      {
        provider: 'ollama',
        schema: '{"type":"object","properties":{}}',
      },
      {
        env,
        stdout: makeStream(true),
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => makeAdapter(),
      },
    );

    expect(stderr.text).toMatch(/Generating Ollama response/);
  });

  it('suppresses the spinner when CI=true', async () => {
    const stderr = makeStream(true);
    const { env } = await fixture();

    await handleRunCommand(
      ['hello'],
      { provider: 'ollama' },
      {
        env: { ...env, CI: 'true' },
        stdout: makeStream(true),
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => makeAdapter(),
      },
    );

    expect(stderr.text).toBe('');
  });
});

describe('generation spinner — stream mode (no spinner)', () => {
  const tempDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function fixture() {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-stream-spin-'));
    tempDirs.push(tempDir);
    return { env: { MARMOT_HOME: join(tempDir, '.marmot') } };
  }

  it('does not emit a Generating status for streaming runs', async () => {
    const stdout = makeStream(true);
    const stderr = makeStream(true);
    const { env } = await fixture();

    await handleStreamRunCommand(
      ['hello'],
      { provider: 'ollama', stream: true },
      {
        env,
        stdout,
        stderr,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
        resolveProvider: () => makeAdapter(),
      },
    );

    expect(stderr.text).not.toMatch(/Generating/);
    // stdout receives the streamed tokens cleanly
    expect(stdout.text).toContain('Hello world');
  });
});
