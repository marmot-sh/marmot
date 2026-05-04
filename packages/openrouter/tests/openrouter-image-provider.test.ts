import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

import { openRouterAdapter } from '../src/index.js';

const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_HEADER).toString('base64')}`;

describe('openRouterAdapter image capabilities', () => {
  it('declares image capability and a default image model', () => {
    expect(openRouterAdapter.capabilities.image).toBe(true);
    expect(openRouterAdapter.defaultImageModel).toBe(
      'google/gemini-2.5-flash-image-preview',
    );
  });

  it('exposes generateImage and refreshImageModels', () => {
    expect(typeof openRouterAdapter.generateImage).toBe('function');
    expect(typeof openRouterAdapter.refreshImageModels).toBe('function');
  });
});

describe('openRouterAdapter.refreshImageModels', () => {
  it('filters the model list to image-output models only', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'openai/gpt-4o-mini',
              architecture: { input_modalities: ['text'], output_modalities: ['text'] },
            },
            {
              id: 'google/gemini-2.5-flash-image-preview',
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] },
            },
            {
              id: 'black-forest-labs/flux-1-schnell',
              architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            },
            {
              id: 'openai/text-embedding-3-large',
              architecture: { input_modalities: ['text'], output_modalities: ['embedding'] },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await openRouterAdapter.refreshImageModels!({
      apiKey: 'sk-test',
      fetchFn: fetchFn as unknown as typeof fetch,
      now: () => new Date('2026-04-30T08:00:00.000Z'),
    });

    expect(result.provider).toBe('openrouter');
    expect(result.defaultModel).toBe('google/gemini-2.5-flash-image-preview');
    expect(result.models.map((m) => m.id)).toEqual([
      'google/gemini-2.5-flash-image-preview',
      'black-forest-labs/flux-1-schnell',
    ]);
  });

  it('rejects without an api key', async () => {
    await expect(
      openRouterAdapter.refreshImageModels!({}),
    ).rejects.toThrowError(/OPENROUTER_API_KEY/);
  });

  it('surfaces 401 as auth error', async () => {
    const fetchFn = vi.fn(async () => new Response('unauth', { status: 401 }));
    await expect(
      openRouterAdapter.refreshImageModels!({
        apiKey: 'bad',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/status 401/);
  });
});

describe('openRouterAdapter.generateImage', () => {
  it('rejects without an api key', async () => {
    await expect(
      openRouterAdapter.generateImage!({
        model: 'google/gemini-2.5-flash-image-preview',
        prompt: 'a marmot',
        n: 1,
      }),
    ).rejects.toThrowError(/OPENROUTER_API_KEY/);
  });

  it('hits /chat/completions with modalities=image,text and parses a data-url image', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toContain('/chat/completions');
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer sk-test');
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.model).toBe('google/gemini-2.5-flash-image-preview');
      expect(body.modalities).toEqual(['image', 'text']);
      expect(body.messages?.[0]?.content).toBe('a marmot');

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [{ type: 'image_url', image_url: { url: PNG_DATA_URL } }],
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await openRouterAdapter.generateImage!({
      model: 'google/gemini-2.5-flash-image-preview',
      prompt: 'a marmot',
      n: 1,
      apiKey: 'sk-test',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe('openrouter');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.data).toEqual(PNG_HEADER);
    expect(result.images[0]!.mimeType).toBe('image/png');
  });

  it('makes parallel calls when n > 1', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { images: [{ image_url: { url: PNG_DATA_URL } }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await openRouterAdapter.generateImage!({
      model: 'google/gemini-2.5-flash-image-preview',
      prompt: 'a marmot',
      n: 3,
      apiKey: 'sk-test',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.images).toHaveLength(3);
  });

  it('errors clearly when the response contains no image output', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'I cannot do that.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(
      openRouterAdapter.generateImage!({
        model: 'openai/gpt-4o-mini',
        prompt: 'a marmot',
        n: 1,
        apiKey: 'sk-test',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/contained no image output/);
  });

  it('surfaces 401 as auth error', async () => {
    const fetchFn = vi.fn(async () => new Response('unauth', { status: 401 }));
    await expect(
      openRouterAdapter.generateImage!({
        model: 'google/gemini-2.5-flash-image-preview',
        prompt: 'x',
        n: 1,
        apiKey: 'bad',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/status 401/);
  });
});
