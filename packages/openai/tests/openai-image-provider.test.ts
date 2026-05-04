import { describe, expect, it, vi } from 'vitest';

import { openAIAdapter } from '../src/index.js';

describe('openAIAdapter image capabilities', () => {
  it('declares image capability and a default image model', () => {
    expect(openAIAdapter.capabilities.image).toBe(true);
    expect(openAIAdapter.defaultImageModel).toBe('gpt-image-1');
  });

  it('exposes generateImage and refreshImageModels', () => {
    expect(typeof openAIAdapter.generateImage).toBe('function');
    expect(typeof openAIAdapter.refreshImageModels).toBe('function');
  });
});

describe('openAIAdapter.refreshImageModels', () => {
  it('returns a hardcoded list with gpt-image-1, dall-e-3, dall-e-2', async () => {
    const result = await openAIAdapter.refreshImageModels!({
      apiKey: 'sk-test',
      now: () => new Date('2026-04-29T12:00:00.000Z'),
    });

    expect(result.provider).toBe('openai');
    expect(result.defaultModel).toBe('gpt-image-1');
    expect(result.models.map((m) => m.id)).toEqual([
      'gpt-image-1',
      'dall-e-3',
      'dall-e-2',
    ]);
  });

  it('throws an auth error when no api key is provided', async () => {
    await expect(
      openAIAdapter.refreshImageModels!({}),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });
});

describe('openAIAdapter.generateImage', () => {
  it('throws an auth error when no api key is provided', async () => {
    await expect(
      openAIAdapter.generateImage!({
        model: 'gpt-image-1',
        prompt: 'a marmot',
        n: 1,
      }),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('rejects --n > 1 for dall-e-3 before any network call', async () => {
    const fetchSpy = vi.fn();
    await expect(
      openAIAdapter.generateImage!({
        model: 'dall-e-3',
        prompt: 'a marmot',
        n: 2,
        apiKey: 'sk-test',
        fetchFn: fetchSpy as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/DALL·E 3 only supports --n 1/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('produces a normalized result from a mocked OpenAI response', async () => {
    const samplePngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    const fetchFn = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url.toString();
        expect(target).toContain('/images/generations');
        const headers = new Headers(init?.headers as HeadersInit);
        expect(headers.get('authorization')).toBe('Bearer sk-test');

        return new Response(
          JSON.stringify({
            data: [
              {
                b64_json: Buffer.from(samplePngBytes).toString('base64'),
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    );

    const result = await openAIAdapter.generateImage!({
      model: 'gpt-image-1',
      prompt: 'a marmot in space',
      n: 1,
      size: '1024x1024',
      quality: 'high',
      apiKey: 'sk-test',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-image-1');
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.data).toEqual(samplePngBytes);
    expect(result.images[0]!.mimeType).toMatch(/^image\/png$/);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('forwards quality and style as openai providerOptions', async () => {
    const samplePngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const capturedBody: Record<string, unknown> = {};

    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.body) {
        const parsed = JSON.parse(String(init.body));
        Object.assign(capturedBody, parsed);
      }
      return new Response(
        JSON.stringify({
          data: [
            { b64_json: Buffer.from(samplePngBytes).toString('base64') },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    await openAIAdapter.generateImage!({
      model: 'dall-e-3',
      prompt: 'a marmot',
      n: 1,
      quality: 'hd',
      style: 'vivid',
      apiKey: 'sk-test',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(capturedBody).toMatchObject({
      model: 'dall-e-3',
      prompt: 'a marmot',
      quality: 'hd',
      style: 'vivid',
    });
  });
});
