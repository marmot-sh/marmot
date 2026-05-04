import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleImageRunCommand } from '../src/commands/run-image.js';
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

function textOnlyAdapter(slug: 'anthropic' | 'ollama' | 'openrouter'): ProviderAdapter {
  return {
    slug,
    name: slug.charAt(0).toUpperCase() + slug.slice(1),
    defaultModel: 'whatever',
    requiresApiKey: slug !== 'ollama',
    capabilities: { text: true, image: false, speech: false, transcription: false },
    generate: vi.fn(),
    generateObject: vi.fn(),
    stream: vi.fn(),
    refreshModels: vi.fn(),
  };
}

function imageCapableAdapter(): ProviderAdapter {
  return {
    slug: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultImageModel: 'gpt-image-1',
    requiresApiKey: true,
    capabilities: { text: true, image: true, speech: false, transcription: false },
    generate: vi.fn(),
    generateObject: vi.fn(),
    stream: vi.fn(),
    refreshModels: vi.fn(),
    generateImage: vi.fn(async ({ model, prompt, n }) => ({
      provider: 'openai' as const,
      model,
      images: Array.from({ length: n }, () => ({
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // PNG header bytes
        mimeType: 'image/png',
      })),
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      finishReason: 'stop',
    })),
  };
}

describe('handleImageRunCommand', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function fixture() {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-image-cmd-'));
    tempDirs.push(tempDir);
    return { env: { MARMOT_HOME: join(tempDir, '.marmot') } };
  }

  it('rejects with a clear error when the provider lacks image capability', async () => {
    const { env } = await fixture();
    const adapter = textOnlyAdapter('anthropic');
    await expect(
      handleImageRunCommand(
        ['a marmot'],
        { provider: 'anthropic' },
        {
          env: { ...env, ANTHROPIC_API_KEY: 'k' },
          stdout: makeStream(true),
          stderr: makeStream(false),
          cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
        },
      ),
    ).rejects.toThrowError(/Anthropic does not support image generation/);
  });

  it('rejects ollama with the same clear error', async () => {
    const { env } = await fixture();
    const adapter = textOnlyAdapter('ollama');
    await expect(
      handleImageRunCommand(
        ['a marmot'],
        { provider: 'ollama' },
        {
          env,
          stdout: makeStream(true),
          stderr: makeStream(false),
          cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
        },
      ),
    ).rejects.toThrowError(/Ollama does not support image generation/);
  });

  it('rejects openrouter as not image-capable for v1', async () => {
    const { env } = await fixture();
    const adapter = textOnlyAdapter('openrouter');
    await expect(
      handleImageRunCommand(
        ['a marmot'],
        { provider: 'openrouter' },
        {
          env: { ...env, OPENROUTER_API_KEY: 'k' },
          stdout: makeStream(true),
          stderr: makeStream(false),
          cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
        },
      ),
    ).rejects.toThrowError(/Openrouter does not support image generation/);
  });

  it('errors when openai is selected without OPENAI_API_KEY', async () => {
    const { env } = await fixture();
    const adapter = imageCapableAdapter();
    await expect(
      handleImageRunCommand(
        ['a marmot'],
        { provider: 'openai' },
        {
          env,
          stdout: makeStream(true),
          stderr: makeStream(false),
          cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
        },
      ),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('errors when cloudflare is selected without CLOUDFLARE_ACCOUNT_ID', async () => {
    const { env } = await fixture();
    const adapter: ProviderAdapter = {
      ...imageCapableAdapter(),
      slug: 'cloudflare',
      name: 'Cloudflare Workers AI',
      defaultImageModel: '@cf/x/y',
    };
    await expect(
      handleImageRunCommand(
        ['a marmot'],
        { provider: 'cloudflare' },
        {
          env: { ...env, CLOUDFLARE_API_TOKEN: 'token' },
          stdout: makeStream(true),
          stderr: makeStream(false),
          cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
        },
      ),
    ).rejects.toThrowError(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('returns the result + adapter + input on the happy path', async () => {
    const { env } = await fixture();
    const adapter = imageCapableAdapter();
    const outcome = await handleImageRunCommand(
      ['a marmot'],
      { provider: 'openai' },
      {
        env: { ...env, OPENAI_API_KEY: 'sk-test' },
        stdout: makeStream(true),
        stderr: makeStream(false),
        cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
        now: () => new Date('2026-04-29T12:00:00.000Z'),
      },
    );

    expect(outcome.input.prompt).toBe('a marmot');
    expect(outcome.adapter.slug).toBe('openai');
    expect(outcome.result.images).toHaveLength(1);
    expect(outcome.result.model).toBe('gpt-image-1');
    expect(adapter.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'a marmot',
        model: 'gpt-image-1',
        n: 1,
      }),
    );
  });

  it('honors --n and passes it through to the adapter', async () => {
    const { env } = await fixture();
    const adapter = imageCapableAdapter();
    const outcome = await handleImageRunCommand(
      ['four marmots'],
      { provider: 'openai', n: 4 },
      {
        env: { ...env, OPENAI_API_KEY: 'sk-test' },
        stdout: makeStream(true),
        stderr: makeStream(false),
        cwd: env.MARMOT_HOME,
        resolveProvider: () => adapter,
      },
    );

    expect(outcome.result.images).toHaveLength(4);
  });
});
