import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleStreamRunCommand } from '../src/commands/run.js';
import type { ProviderAdapter } from '../src/providers/index.js';

async function* createTextStream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('handleStreamRunCommand', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(async (dir) => {
      await rm(dir, {
        recursive: true,
        force: true,
      });
    }));
    tempDirs.length = 0;
  });

  it('streams text to stdout and output file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-stream-'));
    tempDirs.push(tempDir);

    const outputFile = join(tempDir, 'stream.txt');
    const writes: string[] = [];

    const adapter: ProviderAdapter = {
      slug: 'ollama',
      name: 'Ollama',
      defaultModel: 'qwen3.5:4b',
      requiresApiKey: false,
    capabilities: { text: true, image: false, speech: false, transcription: false },
      generate: vi.fn(),
      generateObject: vi.fn(),
      stream: vi.fn(async ({ model }) => ({
        textStream: createTextStream(['Hello', ' world']),
        complete: Promise.resolve({
          provider: 'ollama' as const,
          model,
          text: 'Hello world',
          usage: {
            inputTokens: 1,
            outputTokens: 2,
            totalTokens: 3,
          },
          finishReason: 'stop',
        }),
      })),
      refreshModels: vi.fn(async ({ now }) => ({
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
      })),
    };

    const outcome = await handleStreamRunCommand(
      ['Tell me something'],
      {
        provider: 'ollama',
        output: outputFile,
      },
      {
        env: {
          MARMOT_HOME: join(tempDir, '.marmot'),
        },
        stdout: {
          write(chunk: string) {
            writes.push(chunk);
            return true;
          },
        },
        now: () => new Date('2026-04-22T18:50:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(writes.join('')).toBe('Hello world\n');
    expect(outcome.text).toBe(true);
    expect(outcome.result.model).toBe('qwen3.5:4b');
    expect('text' in outcome.result ? outcome.result.text : null).toBe('Hello world');
    expect(await readFile(outputFile, 'utf8')).toBe('Hello world');
  });
});
