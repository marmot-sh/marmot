import { describe, expect, it, vi } from 'vitest';

import { vercelAdapter } from '../src/index.js';

describe('vercelAdapter.refreshModels', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      vercelAdapter.refreshModels({}),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });

  it('parses gateway models into cache entries', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toContain('ai-gateway.vercel.sh');
      return new Response(
        JSON.stringify({
          models: [
            {
              id: 'anthropic/claude-sonnet-4.6',
              name: 'Claude Sonnet 4.6',
              description: 'Anthropic Sonnet via Vercel.',
              pricing: { input: '0.000003', output: '0.000015' },
              specification: {
                specificationVersion: 'v3',
                provider: 'anthropic',
                modelId: 'claude-sonnet-4.6',
              },
              modelType: 'language',
            },
            {
              id: 'openai/gpt-5.4',
              name: 'GPT 5.4',
              description: 'OpenAI flagship.',
              specification: {
                specificationVersion: 'v3',
                provider: 'openai',
                modelId: 'gpt-5.4',
              },
              modelType: 'language',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await vercelAdapter.refreshModels({
      apiKey: 'gw_test_key',
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date('2026-04-29T00:00:00.000Z'),
    });

    expect(result.provider).toBe('vercel');
    expect(result.defaultModel).toBe('anthropic/claude-sonnet-4.6');
    expect(result.fetchedAt).toBe('2026-04-29T00:00:00.000Z');
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: 'anthropic/claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      inputModalities: ['text'],
      outputModalities: ['text'],
    });
    expect(result.models[0]?.metadata).toMatchObject({
      description: 'Anthropic Sonnet via Vercel.',
    });
    expect(fetchFn).toHaveBeenCalled();
  });

  it('surfaces upstream gateway errors as AICliError', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );

    await expect(
      vercelAdapter.refreshModels({
        apiKey: 'bad-key',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/Vercel AI Gateway/);
  });
});

describe('vercelAdapter.generate', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      vercelAdapter.generate({
        model: 'anthropic/claude-sonnet-4.6',
        prompt: 'hello',
      }),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});

describe('vercelAdapter.generateObject', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      vercelAdapter.generateObject({
        model: 'anthropic/claude-sonnet-4.6',
        prompt: 'hello',
        schema: { type: 'object', properties: {} } as never,
      }),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});

describe('vercelAdapter.stream', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      vercelAdapter.stream({
        model: 'anthropic/claude-sonnet-4.6',
        prompt: 'hello',
      }),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});

describe('vercelAdapter metadata', () => {
  it('reports the right slug and default model', () => {
    expect(vercelAdapter.slug).toBe('vercel');
    expect(vercelAdapter.name).toBe('Vercel AI Gateway');
    expect(vercelAdapter.defaultModel).toBe('anthropic/claude-sonnet-4.6');
    expect(vercelAdapter.requiresApiKey).toBe(true);
  });
});
