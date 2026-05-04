import { describe, expect, it, vi } from 'vitest';

import { cloudflareAdapter } from '../src/index.js';

const baseRefreshInput = {
  apiKey: 'cf_test_token',
  cloudflareAccountId: 'acct_test_123',
};

describe('cloudflareAdapter.refreshModels', () => {
  it('throws an auth error when no api token is provided', async () => {
    await expect(
      cloudflareAdapter.refreshModels({
        cloudflareAccountId: 'acct_test_123',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });

  it('throws an auth error when no account id is provided', async () => {
    await expect(
      cloudflareAdapter.refreshModels({
        apiKey: 'cf_test_token',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('hits the Workers AI search endpoint with bearer auth', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toContain('/accounts/acct_test_123/ai/models/search');
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer cf_test_token');
      return new Response(
        JSON.stringify({
          success: true,
          errors: [],
          messages: [],
          result: [
            {
              id: 'a-uuid-1',
              name: '@cf/meta/llama-3.1-8b-instruct',
              description: 'Llama 3.1 8B Instruct',
              task: { id: 'task-1', name: 'Text Generation' },
              created_at: '2025-04-01T00:00:00Z',
              tags: ['chat'],
            },
            {
              id: 'a-uuid-2',
              name: '@cf/baai/bge-large-en-v1.5',
              description: 'Embeddings model — should be filtered out',
              task: { id: 'task-2', name: 'Text Embeddings' },
            },
            {
              id: 'a-uuid-3',
              name: '@cf/google/gemma-7b-it',
              description: 'Gemma 7B',
              task: { id: 'task-1', name: 'Text Generation' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await cloudflareAdapter.refreshModels({
      ...baseRefreshInput,
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.provider).toBe('cloudflare');
    expect(result.defaultModel).toBe('@cf/meta/llama-3.1-8b-instruct');
    expect(result.fetchedAt).toBe('2026-04-29T12:00:00.000Z');
    expect(result.models).toHaveLength(2);
    expect(result.models.map((m) => m.id)).toEqual([
      '@cf/meta/llama-3.1-8b-instruct',
      '@cf/google/gemma-7b-it',
    ]);
    expect(result.models[0]?.metadata).toMatchObject({
      task: 'Text Generation',
    });
  });

  it('raises an auth-categorized error on 401', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ success: false }), { status: 401 }),
    );

    await expect(
      cloudflareAdapter.refreshModels({
        ...baseRefreshInput,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/status 401/);
  });

  it('raises a cache error on malformed JSON', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      cloudflareAdapter.refreshModels({
        ...baseRefreshInput,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/invalid JSON/);
  });

  it('raises a cache error on schema mismatch', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ unexpected: 'shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      cloudflareAdapter.refreshModels({
        ...baseRefreshInput,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/expected schema/);
  });
});

describe('cloudflareAdapter.generate', () => {
  it('rejects without an api key', async () => {
    await expect(
      cloudflareAdapter.generate({
        model: '@cf/meta/llama-3.1-8b-instruct',
        prompt: 'hello',
        cloudflareAccountId: 'acct_test_123',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });

  it('rejects without an account id', async () => {
    await expect(
      cloudflareAdapter.generate({
        model: '@cf/meta/llama-3.1-8b-instruct',
        prompt: 'hello',
        apiKey: 'cf_test_token',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_ACCOUNT_ID/);
  });
});

describe('cloudflareAdapter.generateObject', () => {
  it('rejects without credentials', async () => {
    await expect(
      cloudflareAdapter.generateObject({
        model: '@cf/meta/llama-3.1-8b-instruct',
        prompt: 'hello',
        schema: { type: 'object', properties: {} } as never,
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });
});

describe('cloudflareAdapter.stream', () => {
  it('rejects without credentials', async () => {
    await expect(
      cloudflareAdapter.stream({
        model: '@cf/meta/llama-3.1-8b-instruct',
        prompt: 'hello',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });
});

describe('cloudflareAdapter metadata', () => {
  it('reports the right slug and default model', () => {
    expect(cloudflareAdapter.slug).toBe('cloudflare');
    expect(cloudflareAdapter.name).toBe('Cloudflare Workers AI');
    expect(cloudflareAdapter.defaultModel).toBe(
      '@cf/meta/llama-3.1-8b-instruct',
    );
    expect(cloudflareAdapter.requiresApiKey).toBe(true);
  });
});
