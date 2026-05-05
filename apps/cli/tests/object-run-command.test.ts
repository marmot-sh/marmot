import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRunCommand } from '../src/commands/run.js';
import type { ProviderAdapter } from '../src/providers/index.js';

function makeStubAdapter(output: unknown): ProviderAdapter {
  return {
    slug: 'ollama',
    name: 'Ollama',
    defaultModel: 'qwen3:4b',
    requiresApiKey: false,
    capabilities: { text: true, image: false, speech: false, transcription: false },
    generate: vi.fn(),
    generateObject: vi.fn(async ({ model }) => ({
      provider: 'ollama' as const,
      model,
      output,
      usage: { inputTokens: 5, outputTokens: 6, totalTokens: 11 },
      finishReason: 'stop',
    })),
    stream: vi.fn(),
    refreshModels: vi.fn(async ({ now }) => ({
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
    })),
  };
}

describe('handleRunCommand object mode', () => {
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

  it('renders wrapped structured output', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-object-'));
    tempDirs.push(tempDir);

    const outputFile = join(tempDir, 'result.json');
    const writes: string[] = [];

    const adapter: ProviderAdapter = {
      slug: 'ollama',
      name: 'Ollama',
      defaultModel: 'qwen3:4b',
      requiresApiKey: false,
    capabilities: { text: true, image: false, speech: false, transcription: false },
      generate: vi.fn(),
      generateObject: vi.fn(async ({ model }) => ({
        provider: 'ollama' as const,
        model,
        output: {
          joke: 'Hello world',
        },
        usage: {
          inputTokens: 10,
          outputTokens: 12,
          totalTokens: 22,
        },
        finishReason: 'stop',
      })),
      stream: vi.fn(),
      refreshModels: vi.fn(async ({ now }) => ({
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
      })),
    };

    const outcome = await handleRunCommand(
      ['Tell me a joke'],
      {
        provider: 'ollama',
        schema: JSON.stringify({
          type: 'object',
          properties: {
            joke: { type: 'string' },
          },
          required: ['joke'],
          additionalProperties: false,
        }),
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
        now: () => new Date('2026-04-22T19:10:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    const parsed = JSON.parse(writes.join('')) as {
      output: { joke: string };
      model: string;
    };

    expect(parsed.output.joke).toBe('Hello world');
    expect(parsed.model).toBe('qwen3:4b');
    expect(outcome.text).toBe(false);
    expect(JSON.parse(await readFile(outputFile, 'utf8'))).toMatchObject({
      output: {
        joke: 'Hello world',
      },
    });
  });

  it('runs object mode with a JSON schema file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-object-file-'));
    tempDirs.push(tempDir);

    const schemaPath = join(tempDir, 'joke.schema.json');
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        properties: { joke: { type: 'string' } },
        required: ['joke'],
        additionalProperties: false,
      }),
      'utf8',
    );

    const adapter = makeStubAdapter({ joke: 'From a file' });
    const writes: string[] = [];

    await handleRunCommand(
      ['Tell me a joke'],
      {
        provider: 'ollama',
        schemaFile: schemaPath,
      },
      {
        env: { MARMOT_HOME: join(tempDir, '.marmot') },
        stdout: {
          write(chunk: string) {
            writes.push(chunk);
            return true;
          },
        },
        now: () => new Date('2026-04-28T00:00:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(adapter.generateObject).toHaveBeenCalledOnce();
    const parsed = JSON.parse(writes.join('')) as { output: { joke: string } };
    expect(parsed.output.joke).toBe('From a file');
  });

  it('runs object mode with a Zod schema module', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-object-module-'));
    tempDirs.push(tempDir);

    const modulePath = join(tempDir, 'joke.schema.ts');
    await writeFile(
      modulePath,
      [
        'import { z } from "zod";',
        'export const schema = z.object({ joke: z.string() });',
      ].join('\n'),
      'utf8',
    );

    const adapter = makeStubAdapter({ joke: 'From a Zod module' });
    const writes: string[] = [];

    await handleRunCommand(
      ['Tell me a joke'],
      {
        provider: 'ollama',
        schemaModule: modulePath,
      },
      {
        env: { MARMOT_HOME: join(tempDir, '.marmot') },
        stdout: {
          write(chunk: string) {
            writes.push(chunk);
            return true;
          },
        },
        now: () => new Date('2026-04-28T00:00:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(adapter.generateObject).toHaveBeenCalledOnce();
    const parsed = JSON.parse(writes.join('')) as { output: { joke: string } };
    expect(parsed.output.joke).toBe('From a Zod module');
  });
});
