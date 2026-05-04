import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRunCommand } from '../src/commands/run.js';
import { handleImageRunCommand } from '../src/commands/run-image.js';
import type { ProviderAdapter } from '../src/providers/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixtureWithConfig(config: unknown): Promise<{
  env: NodeJS.ProcessEnv;
  marmotHome: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-cfg-defaults-'));
  tempDirs.push(dir);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'config.json'), JSON.stringify(config));
  return { env: { MARMOT_HOME: dir }, marmotHome: dir };
}

function makeStream(isTTY: boolean) {
  const buf: string[] = [];
  return {
    isTTY,
    write(chunk: string | Buffer) {
      buf.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
      return true;
    },
    get text() {
      return buf.join('');
    },
  };
}

function textAdapter(slug: 'ollama' | 'anthropic'): ProviderAdapter {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    defaultModel: slug === 'ollama' ? 'qwen3.5:4b' : 'claude-sonnet-4-6',
    requiresApiKey: slug !== 'ollama',
    capabilities: { text: true, image: false, speech: false, transcription: false },
    generate: vi.fn(async ({ model, prompt }) => ({
      provider: slug as 'ollama' | 'anthropic',
      model,
      text: `Echo from ${slug}: ${prompt}`,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    })),
    generateObject: vi.fn(),
    stream: vi.fn(),
    refreshModels: vi.fn(async () => ({
      version: 1 as const,
      provider: slug as 'ollama' | 'anthropic',
      defaultModel: slug === 'ollama' ? 'qwen3.5:4b' : 'claude-sonnet-4-6',
      fetchedAt: new Date().toISOString(),
      models: [
        {
          id: slug === 'ollama' ? 'qwen3.5:4b' : 'claude-sonnet-4-6',
          name: 'm',
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

function imageAdapter(slug: 'openai' | 'cloudflare'): ProviderAdapter {
  const modelId = slug === 'openai' ? 'gpt-image-1' : '@cf/black-forest-labs/flux-1-schnell';
  return {
    slug,
    name: slug === 'openai' ? 'OpenAI' : 'Cloudflare Workers AI',
    defaultModel: 'gpt-4o-mini',
    defaultImageModel: modelId,
    requiresApiKey: true,
    capabilities: { text: true, image: true, speech: false, transcription: false },
    generate: vi.fn(),
    generateObject: vi.fn(),
    stream: vi.fn(),
    refreshModels: vi.fn(),
    generateImage: vi.fn(async ({ model, n }) => ({
      provider: slug,
      model,
      images: Array.from({ length: n }, () => ({
        data: new Uint8Array([0x89]),
        mimeType: 'image/png',
      })),
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      finishReason: 'stop',
    })),
  };
}

describe('handleRunCommand — config defaults', () => {
  it('uses config.defaults.text.provider when no --provider flag is passed', async () => {
    const { env, marmotHome } = await fixtureWithConfig({
      version: 1,
      defaults: { text: { provider: 'ollama' } },
    });

    const adapter = textAdapter('ollama');
    const cwd = await mkdtemp(join(tmpdir(), 'marmot-cwd-'));
    tempDirs.push(cwd);

    await handleRunCommand(
      ['hello'],
      {},
      {
        env,
        stdout: makeStream(true),
        stderr: makeStream(false),
        resolveProvider: () => adapter,
      },
    );

    expect(adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'qwen3.5:4b' }),
    );
    void marmotHome;
  });

  it('explicit --provider beats config', async () => {
    const { env } = await fixtureWithConfig({
      version: 1,
      defaults: { text: { provider: 'ollama' } },
    });

    const anthropic = textAdapter('anthropic');
    await handleRunCommand(
      ['hi'],
      { provider: 'anthropic' },
      {
        env: { ...env, ANTHROPIC_API_KEY: 'k' },
        stdout: makeStream(true),
        stderr: makeStream(false),
        resolveProvider: () => anthropic,
      },
    );

    expect(anthropic.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' }),
    );
  });

  it('honors a configured model override', async () => {
    const { env } = await fixtureWithConfig({
      version: 1,
      defaults: { text: { provider: 'ollama', model: 'llama3.2' } },
    });

    const adapter: ProviderAdapter = {
      ...textAdapter('ollama'),
      refreshModels: vi.fn(async () => ({
        version: 1 as const,
        provider: 'ollama' as const,
        defaultModel: 'qwen3.5:4b',
        fetchedAt: new Date().toISOString(),
        models: [
          {
            id: 'llama3.2',
            name: 'llama3.2',
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

    await handleRunCommand(
      ['x'],
      {},
      {
        env,
        stdout: makeStream(true),
        stderr: makeStream(false),
        resolveProvider: () => adapter,
      },
    );

    expect(adapter.generate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'llama3.2' }),
    );
  });
});

describe('handleImageRunCommand — config defaults', () => {
  it('errors with the rich "no AI providers detected" hint when no flag, no config, and no detectable keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marmot-no-cfg-'));
    tempDirs.push(dir);
    // Strip every AI key from env AND point Ollama at a dead host so
    // detection finds nothing → fallback error path fires.
    const env = { MARMOT_HOME: dir, OLLAMA_HOST: 'http://127.0.0.1:9' };
    const adapter = imageAdapter('openai');

    await expect(
      handleImageRunCommand(
        ['a marmot'],
        {},
        {
          env,
          stdout: makeStream(true),
          stderr: makeStream(false),
          resolveProvider: () => adapter,
          cwd: dir,
        },
      ),
    ).rejects.toThrowError(/No AI providers detected for "image".*marmot setup/s);
  });

  it('auto-configures the first detected provider when no flag and no config but a key is set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'marmot-auto-'));
    tempDirs.push(dir);
    const env = {
      MARMOT_HOME: dir,
      OLLAMA_HOST: 'http://127.0.0.1:9',
      OPENAI_API_KEY: 'sk-test',
    };
    const adapter = imageAdapter('openai');

    // Should NOT throw — auto-config picks openai (only ready provider).
    // The actual provider call may still error (mock adapter), but the
    // resolution step itself must succeed.
    await handleImageRunCommand(
      ['a marmot'],
      {},
      {
        env,
        stdout: makeStream(true),
        stderr: makeStream(false),
        resolveProvider: () => adapter,
        cwd: dir,
      },
    );
  });

  it('uses config.defaults.image.provider when no --provider flag', async () => {
    const { env, marmotHome } = await fixtureWithConfig({
      version: 1,
      defaults: { image: { provider: 'cloudflare' } },
    });

    const adapter = imageAdapter('cloudflare');
    await handleImageRunCommand(
      ['a marmot'],
      {},
      {
        env: {
          ...env,
          CLOUDFLARE_API_TOKEN: 't',
          CLOUDFLARE_ACCOUNT_ID: 'a',
        },
        stdout: makeStream(true),
        stderr: makeStream(false),
        resolveProvider: () => adapter,
        cwd: marmotHome,
      },
    );

    expect(adapter.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ model: '@cf/black-forest-labs/flux-1-schnell' }),
    );
  });

  it('explicit --provider beats config', async () => {
    const { env, marmotHome } = await fixtureWithConfig({
      version: 1,
      defaults: { image: { provider: 'cloudflare' } },
    });

    const openai = imageAdapter('openai');
    await handleImageRunCommand(
      ['x'],
      { provider: 'openai' },
      {
        env: { ...env, OPENAI_API_KEY: 'sk-test' },
        stdout: makeStream(true),
        stderr: makeStream(false),
        resolveProvider: () => openai,
        cwd: marmotHome,
      },
    );

    expect(openai.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1' }),
    );
  });
});
