import { describe, expect, it, vi } from 'vitest';

import { vercelAdapter } from '../src/index.js';

describe('vercelAdapter image capabilities', () => {
  it('declares image capability and a default image model', () => {
    expect(vercelAdapter.capabilities.image).toBe(true);
    expect(vercelAdapter.defaultImageModel).toBe('openai/dall-e-3');
  });

  it('exposes generateImage and refreshImageModels', () => {
    expect(typeof vercelAdapter.generateImage).toBe('function');
    expect(typeof vercelAdapter.refreshImageModels).toBe('function');
  });
});

describe('vercelAdapter.refreshImageModels', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      vercelAdapter.refreshImageModels!({}),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });

  it('filters the gateway model list to image models only', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              id: 'anthropic/claude-sonnet-4.6',
              name: 'Sonnet',
              specification: {
                specificationVersion: 'v3',
                provider: 'anthropic',
                modelId: 'claude-sonnet-4.6',
              },
              modelType: 'language',
            },
            {
              id: 'openai/dall-e-3',
              name: 'DALL-E 3',
              specification: {
                specificationVersion: 'v3',
                provider: 'openai',
                modelId: 'dall-e-3',
              },
              modelType: 'image',
            },
            {
              id: 'black-forest-labs/flux-pro',
              name: 'Flux Pro',
              specification: {
                specificationVersion: 'v3',
                provider: 'black-forest-labs',
                modelId: 'flux-pro',
              },
              modelType: 'image',
            },
            {
              id: 'openai/text-embedding-3-large',
              name: 'OpenAI Embedding',
              specification: {
                specificationVersion: 'v3',
                provider: 'openai',
                modelId: 'text-embedding-3-large',
              },
              modelType: 'embedding',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await vercelAdapter.refreshImageModels!({
      apiKey: 'gw_test',
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
    });

    expect(result.provider).toBe('vercel');
    expect(result.defaultModel).toBe('openai/dall-e-3');
    expect(result.models.map((m) => m.id)).toEqual([
      'openai/dall-e-3',
      'black-forest-labs/flux-pro',
    ]);
  });
});

describe('vercelAdapter.refreshModels (text) excludes non-language models', () => {
  it('drops image and embedding entries from the text cache', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          models: [
            {
              id: 'anthropic/claude-sonnet-4.6',
              name: 'Sonnet',
              specification: {
                specificationVersion: 'v3',
                provider: 'anthropic',
                modelId: 'claude-sonnet-4.6',
              },
              modelType: 'language',
            },
            {
              id: 'openai/dall-e-3',
              name: 'DALL-E 3',
              specification: {
                specificationVersion: 'v3',
                provider: 'openai',
                modelId: 'dall-e-3',
              },
              modelType: 'image',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await vercelAdapter.refreshModels({
      apiKey: 'gw_test',
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date('2026-04-29T00:00:00.000Z'),
    });

    expect(result.models.map((m) => m.id)).toEqual([
      'anthropic/claude-sonnet-4.6',
    ]);
  });
});

describe('vercelAdapter.generateImage', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      vercelAdapter.generateImage!({
        model: 'openai/dall-e-3',
        prompt: 'a marmot',
        n: 1,
      }),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});
