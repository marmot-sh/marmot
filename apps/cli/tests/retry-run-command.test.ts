import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRunCommand } from '../src/commands/run.js';
import { AICliError } from '@marmot-sh/core';
import type { ProviderAdapter } from '../src/providers/index.js';
import type { ProviderGenerateInput } from '@marmot-sh/core';

describe('handleRunCommand retries', () => {
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

  it('retries failed generation attempts and passes an abort signal', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-retry-'));
    tempDirs.push(tempDir);

    const writes: string[] = [];
    const sleep = vi.fn(async () => {});
    const generate = vi.fn(async ({ model, abortSignal }: ProviderGenerateInput) => {
      expect(abortSignal).toBeInstanceOf(AbortSignal);

      if (generate.mock.calls.length < 3) {
        throw new AICliError('provider', 'Temporary provider failure.');
      }

      return {
        provider: 'ollama' as const,
        model,
        text: 'Recovered',
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
        },
        finishReason: 'stop',
      };
    });

    const adapter: ProviderAdapter = {
      slug: 'ollama',
      name: 'Ollama',
      defaultModel: 'qwen3.5:4b',
      requiresApiKey: false,
    capabilities: { text: true, image: false, speech: false, transcription: false },
      generate,
      generateObject: vi.fn(),
      stream: vi.fn(),
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

    const outcome = await handleRunCommand(
      ['Tell me a joke'],
      {
        provider: 'ollama',
        retries: '2',
        timeout: '5',
        json: true,
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
        now: () => new Date('2026-04-22T20:10:00.000Z'),
        resolveProvider: () => adapter,
        retryBaseDelayMs: 10,
        sleep,
      },
    );

    expect(generate).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
    expect('text' in outcome.result ? outcome.result.text : null).toBe('Recovered');
    expect(writes.join('')).toContain('"text": "Recovered"');
  });
});
