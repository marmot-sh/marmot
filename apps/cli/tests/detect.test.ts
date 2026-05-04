import { describe, expect, it, vi } from 'vitest';

import {
  detectProviders,
  filterImageReady,
  filterReady,
  filterSpeechReady,
  filterTranscriptionReady,
} from '../src/providers/detect.js';

function fakeFetchOllamaUp(): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const target = typeof url === 'string' ? url : url.toString();
    if (target.includes('/api/version')) {
      return new Response(JSON.stringify({ version: '0.1.30' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function fakeFetchOllamaDown(): typeof fetch {
  return vi.fn(async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
}

describe('detectProviders', () => {
  it('marks providers as ready when their env vars are set', async () => {
    const statuses = await detectProviders(
      {
        OPENAI_API_KEY: 'sk-test',
        ANTHROPIC_API_KEY: 'sk-ant',
      },
      fakeFetchOllamaDown(),
    );

    const bySlug = Object.fromEntries(statuses.map((s) => [s.slug, s]));
    expect(bySlug.openai!.ready).toBe(true);
    expect(bySlug.anthropic!.ready).toBe(true);
    expect(bySlug.openrouter!.ready).toBe(false);
    expect(bySlug.openrouter!.reason).toBe('missing OPENROUTER_API_KEY');
  });

  it('reports cloudflare missing both env vars when neither is set', async () => {
    const statuses = await detectProviders({}, fakeFetchOllamaDown());
    const cf = statuses.find((s) => s.slug === 'cloudflare');
    expect(cf?.ready).toBe(false);
    expect(cf?.reason).toContain('CLOUDFLARE_API_TOKEN');
    expect(cf?.reason).toContain('CLOUDFLARE_ACCOUNT_ID');
  });

  it('reports cloudflare missing the missing one when only one is set', async () => {
    const statuses = await detectProviders(
      { CLOUDFLARE_API_TOKEN: 't' },
      fakeFetchOllamaDown(),
    );
    const cf = statuses.find((s) => s.slug === 'cloudflare');
    expect(cf?.ready).toBe(false);
    expect(cf?.reason).toBe('missing CLOUDFLARE_ACCOUNT_ID');
    expect(cf?.reason).not.toContain('CLOUDFLARE_API_TOKEN');
  });

  it('reports cloudflare ready when both env vars are set', async () => {
    const statuses = await detectProviders(
      { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' },
      fakeFetchOllamaDown(),
    );
    const cf = statuses.find((s) => s.slug === 'cloudflare');
    expect(cf?.ready).toBe(true);
    expect(cf?.reason).toBeUndefined();
  });

  it('marks ollama ready when /api/version responds', async () => {
    const statuses = await detectProviders({}, fakeFetchOllamaUp());
    const ollama = statuses.find((s) => s.slug === 'ollama');
    expect(ollama?.ready).toBe(true);
  });

  it('marks ollama not ready when /api/version is unreachable', async () => {
    const statuses = await detectProviders({}, fakeFetchOllamaDown());
    const ollama = statuses.find((s) => s.slug === 'ollama');
    expect(ollama?.ready).toBe(false);
    expect(ollama?.reason).toContain('not running');
  });

  it('exposes capabilities on each status', async () => {
    const statuses = await detectProviders({}, fakeFetchOllamaDown());
    const openai = statuses.find((s) => s.slug === 'openai');
    expect(openai?.capabilities.image).toBe(true);
    const anthropic = statuses.find((s) => s.slug === 'anthropic');
    expect(anthropic?.capabilities.image).toBe(false);
  });
});

describe('filter helpers', () => {
  it('filterReady drops not-ready entries', async () => {
    const statuses = await detectProviders(
      { OPENAI_API_KEY: 'sk' },
      fakeFetchOllamaDown(),
    );
    const ready = filterReady(statuses);
    expect(ready.map((s) => s.slug)).toEqual(['openai']);
  });

  it('filterImageReady drops text-only providers even when they have keys', async () => {
    const statuses = await detectProviders(
      { OPENAI_API_KEY: 'sk', ANTHROPIC_API_KEY: 'sk-ant' },
      fakeFetchOllamaDown(),
    );
    const imageReady = filterImageReady(statuses);
    expect(imageReady.map((s) => s.slug)).toEqual(['openai']);
  });

  it('filterSpeechReady picks providers with speech capability', async () => {
    const statuses = await detectProviders(
      {
        OPENAI_API_KEY: 'sk',
        ANTHROPIC_API_KEY: 'sk-ant',
        CLOUDFLARE_API_TOKEN: 't',
        CLOUDFLARE_ACCOUNT_ID: 'a',
      },
      fakeFetchOllamaDown(),
    );
    const slugs = filterSpeechReady(statuses).map((s) => s.slug).sort();
    expect(slugs).toEqual(['cloudflare', 'openai']);
  });

  it('filterTranscriptionReady picks providers with transcription capability', async () => {
    const statuses = await detectProviders(
      {
        OPENAI_API_KEY: 'sk',
        CLOUDFLARE_API_TOKEN: 't',
        CLOUDFLARE_ACCOUNT_ID: 'a',
      },
      fakeFetchOllamaDown(),
    );
    const slugs = filterTranscriptionReady(statuses).map((s) => s.slug).sort();
    expect(slugs).toEqual(['cloudflare', 'openai']);
  });
});
