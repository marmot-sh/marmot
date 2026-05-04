import { describe, expect, it } from 'vitest';

import { openAIAdapter } from '../src/index.js';

describe('openAIAdapter.refreshModels', () => {
  it('parses the models endpoint payload into cache entries', async () => {
    const payload = {
      object: 'list',
      data: [
        {
          id: 'gpt-4o-mini',
          object: 'model',
          created: 1_715_368_132,
          owned_by: 'openai',
        },
        {
          id: 'gpt-4o',
          object: 'model',
          created: 1_715_367_000,
          owned_by: 'openai',
        },
      ],
    };

    const result = await openAIAdapter.refreshModels({
      apiKey: 'test-key',
      fetchFn: async (url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(url).toMatch(/api\.openai\.com\/v1\/models$/);
        expect(headers.Authorization).toBe('Bearer test-key');
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      now: () => new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(result.provider).toBe('openai');
    expect(result.defaultModel).toBe('gpt-4o-mini');
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: 'gpt-4o-mini',
      name: 'gpt-4o-mini',
      inputModalities: ['text'],
      outputModalities: ['text'],
    });
    expect(result.models[0]?.metadata).toMatchObject({ ownedBy: 'openai' });
  });

  it('throws an auth error when no api key is provided', async () => {
    await expect(
      openAIAdapter.refreshModels({
        fetchFn: async () => new Response('{}', { status: 200 }),
      }),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('throws an auth error when the api returns 401', async () => {
    await expect(
      openAIAdapter.refreshModels({
        apiKey: 'bad-key',
        fetchFn: async () => new Response('{"error":"unauth"}', { status: 401 }),
      }),
    ).rejects.toThrowError(/status 401/);
  });
});
