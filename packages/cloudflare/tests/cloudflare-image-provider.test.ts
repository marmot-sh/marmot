import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

import { cloudflareAdapter } from '../src/index.js';

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const baseInput = {
  apiKey: 'cf_test_token',
  cloudflareAccountId: 'acct_test',
};

describe('cloudflareAdapter image capabilities', () => {
  it('declares image capability and a default image model', () => {
    expect(cloudflareAdapter.capabilities.image).toBe(true);
    expect(cloudflareAdapter.defaultImageModel).toBe(
      '@cf/black-forest-labs/flux-1-schnell',
    );
  });

  it('exposes generateImage and refreshImageModels', () => {
    expect(typeof cloudflareAdapter.generateImage).toBe('function');
    expect(typeof cloudflareAdapter.refreshImageModels).toBe('function');
  });
});

describe('cloudflareAdapter.refreshImageModels', () => {
  it('returns the curated hardcoded list', async () => {
    const result = await cloudflareAdapter.refreshImageModels!({
      ...baseInput,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
    });
    expect(result.provider).toBe('cloudflare');
    expect(result.defaultModel).toBe('@cf/black-forest-labs/flux-1-schnell');
    expect(result.models.map((m) => m.id)).toEqual([
      '@cf/black-forest-labs/flux-1-schnell',
      '@cf/bytedance/stable-diffusion-xl-lightning',
      '@cf/lykon/dreamshaper-8-lcm',
      '@cf/runwayml/stable-diffusion-v1-5-img2img',
    ]);
  });

  it('rejects without an api token', async () => {
    await expect(
      cloudflareAdapter.refreshImageModels!({
        cloudflareAccountId: 'acct_test',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });

  it('rejects without an account id', async () => {
    await expect(
      cloudflareAdapter.refreshImageModels!({
        apiKey: 'cf_test',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_ACCOUNT_ID/);
  });
});

describe('cloudflareAdapter.generateImage', () => {
  it('rejects without credentials', async () => {
    await expect(
      cloudflareAdapter.generateImage!({
        model: '@cf/black-forest-labs/flux-1-schnell',
        prompt: 'a marmot',
        n: 1,
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });

  it('hits /ai/run/<model> with bearer auth and posts the prompt', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acct_test/ai/run/@cf/black-forest-labs/flux-1-schnell',
      );
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer cf_test_token');
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.prompt).toBe('a marmot');
      expect(body.width).toBe(1024);
      expect(body.height).toBe(1024);
      expect(body.seed).toBe(42);
      expect(body.negative_prompt).toBe('blurry');

      return new Response(PNG_HEADER, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      });
    });

    const result = await cloudflareAdapter.generateImage!({
      ...baseInput,
      model: '@cf/black-forest-labs/flux-1-schnell',
      prompt: 'a marmot',
      n: 1,
      size: '1024x1024',
      seed: 42,
      negative: 'blurry',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.data).toEqual(PNG_HEADER);
    expect(result.images[0]!.mimeType).toBe('image/png');
  });

  it('handles JSON-wrapped base64 responses (when content-type is application/json)', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          image: Buffer.from(PNG_HEADER).toString('base64'),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await cloudflareAdapter.generateImage!({
      ...baseInput,
      model: '@cf/black-forest-labs/flux-1-schnell',
      prompt: 'a marmot',
      n: 1,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.images[0]!.data).toEqual(PNG_HEADER);
  });

  it('makes parallel requests when n>1 and aggregates results', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(PNG_HEADER, {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );

    const result = await cloudflareAdapter.generateImage!({
      ...baseInput,
      model: '@cf/black-forest-labs/flux-1-schnell',
      prompt: 'a marmot',
      n: 3,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.images).toHaveLength(3);
  });

  it('surfaces 401 as auth error', async () => {
    const fetchFn = vi.fn(async () => new Response('unauth', { status: 401 }));
    await expect(
      cloudflareAdapter.generateImage!({
        ...baseInput,
        model: '@cf/black-forest-labs/flux-1-schnell',
        prompt: 'x',
        n: 1,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/status 401/);
  });
});
