import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRunCommand } from '../src/commands/run.js';
import type { ProviderAdapter } from '../src/providers/index.js';

describe('handleRunCommand', () => {
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

  it('writes JSON output and merges prompt sources', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-run-'));
    tempDirs.push(tempDir);

    const systemFile = join(tempDir, 'system.md');
    const promptFile = join(tempDir, 'prompt.md');
    const outputFile = join(tempDir, 'result.json');
    await writeFile(systemFile, 'System from file', 'utf8');
    await writeFile(promptFile, 'Prompt from file', 'utf8');

    const writes: string[] = [];
    const generate = vi.fn(async ({ prompt, model }: { prompt: string; model: string }) => ({
      provider: 'ollama' as const,
      model,
      text: `Echo: ${prompt}`,
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
      finishReason: 'stop',
    }));

    const adapter: ProviderAdapter = {
      slug: 'ollama',
      name: 'Ollama',
      defaultModel: 'qwen3:4b',
      requiresApiKey: false,
    capabilities: { text: true, image: false, speech: false, transcription: false },
      generate,
      generateObject: vi.fn(),
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
      ['Inline prompt'],
      {
        provider: 'ollama',
        output: outputFile,
        system: 'System inline',
        systemFile,
        promptFile,
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
        now: () => new Date('2026-04-22T13:00:00.000Z'),
        resolveProvider: () => adapter,
      },
    );

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      model: 'qwen3:4b',
      system: 'System inline\n\nSystem from file',
      prompt: 'Inline prompt\n\nPrompt from file',
    }));

    const writtenFile = await readFile(outputFile, 'utf8');
    const parsed = JSON.parse(writtenFile) as { text: string; outputFile: string | null };
    expect(parsed.text).toBe('Echo: Inline prompt\n\nPrompt from file');
    expect(parsed.outputFile).toBe(outputFile);
    expect(writes.join('')).toContain('"provider": "ollama"');
    expect(outcome.result.outputFile).toBe(outputFile);
  });
});
