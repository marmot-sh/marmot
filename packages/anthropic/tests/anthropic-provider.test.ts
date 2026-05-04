import { describe, expect, it } from 'vitest';

import { anthropicAdapter } from '../src/index.js';

describe('anthropicAdapter.refreshModels', () => {
  it('parses the models endpoint payload into cache entries', async () => {
    const payload = {
      data: [
        {
          id: 'claude-sonnet-4-6',
          display_name: 'Claude Sonnet 4.6',
          type: 'model',
          created_at: '2026-02-01T00:00:00Z',
        },
        {
          id: 'claude-haiku-4-5-20251001',
          display_name: 'Claude Haiku 4.5',
          type: 'model',
          created_at: '2025-10-01T00:00:00Z',
        },
      ],
      has_more: false,
      first_id: 'claude-sonnet-4-6',
      last_id: 'claude-haiku-4-5-20251001',
    };

    const result = await anthropicAdapter.refreshModels({
      apiKey: 'test-key',
      fetchFn: async (url, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(url).toMatch(/api\.anthropic\.com\/v1\/models$/);
        expect(headers['x-api-key']).toBe('test-key');
        expect(headers['anthropic-version']).toBe('2023-06-01');
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      now: () => new Date('2026-04-28T00:00:00.000Z'),
    });

    expect(result.provider).toBe('anthropic');
    expect(result.defaultModel).toBe('claude-sonnet-4-6');
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      inputModalities: ['text', 'image'],
    });
  });

  it('throws an auth error when no api key is provided', async () => {
    await expect(
      anthropicAdapter.refreshModels({
        fetchFn: async () => new Response('{}', { status: 200 }),
      }),
    ).rejects.toThrowError(/ANTHROPIC_API_KEY/);
  });

  it('throws an auth error when the api returns 401', async () => {
    await expect(
      anthropicAdapter.refreshModels({
        apiKey: 'bad-key',
        fetchFn: async () => new Response('{"error":"unauth"}', { status: 401 }),
      }),
    ).rejects.toThrowError(/status 401/);
  });
});
