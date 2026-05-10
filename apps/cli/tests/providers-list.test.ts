import { describe, expect, it } from 'vitest';

import { listProviderSummaries } from '../src/providers/index.js';
import { handleProvidersListCommand } from '../src/commands/providers-list.js';

class Cap {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('handleProvidersListCommand — output modes', () => {
  const env = { HOME: '/tmp/marmot-test-home' };

  it('emits raw summaries array in JSON mode (preserves today envelope)', async () => {
    const cap = new Cap();
    await handleProvidersListCommand({ json: true }, { env, stdout: cap });
    const parsed = JSON.parse(cap.text());
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(19);
    expect(parsed[0]).toHaveProperty('slug');
  });

  it('--markdown emits a pipe-table with the expected columns', async () => {
    const cap = new Cap();
    await handleProvidersListCommand({ markdown: true }, { env, stdout: cap });
    const out = cap.text();
    expect(out).toMatch(/^\| SLUG \| NAME \| CATEGORY \| ENV VARS \|/m);
    expect(out).toMatch(/\| --- \| --- \| --- \| --- \|/);
  });

  it('--check-keys --markdown adds a STATUS column', async () => {
    const cap = new Cap();
    await handleProvidersListCommand({ checkKeys: true, markdown: true }, { env, stdout: cap });
    const out = cap.text();
    expect(out).toMatch(/^\| SLUG \| NAME \| CATEGORY \| ENV VARS \| STATUS \|/m);
  });

  it('rejects --json + --markdown together', async () => {
    const cap = new Cap();
    await expect(
      handleProvidersListCommand({ json: true, markdown: true }, { env, stdout: cap }),
    ).rejects.toThrow(/mutually exclusive/);
  });
});

describe('listProviderSummaries', () => {
  const env = { HOME: '/tmp/marmot-test-home' };

  it('returns all 19 providers across AI, web, and data categories', () => {
    const summaries = listProviderSummaries(env);
    expect(summaries).toHaveLength(19);
    const aiSlugs = summaries.filter((s) => s.category === 'ai').map((s) => s.slug).sort();
    const webSlugs = summaries.filter((s) => s.category === 'web').map((s) => s.slug).sort();
    const dataSlugs = summaries.filter((s) => s.category === 'data').map((s) => s.slug).sort();
    expect(aiSlugs).toEqual(
      ['anthropic', 'cloudflare', 'ollama', 'openai', 'openrouter', 'vercel'],
    );
    expect(webSlugs).toEqual(['brave', 'exa', 'firecrawl', 'parallel', 'tavily']);
    expect(dataSlugs).toEqual(
      ['apollo', 'bouncer', 'datagma', 'hunter', 'kickbox', 'pdl', 'tomba', 'zerobounce'],
    );
  });

  it('marks providers that need an API key', () => {
    const summaries = listProviderSummaries(env);
    const ollama = summaries.find((s) => s.slug === 'ollama');
    const openrouter = summaries.find((s) => s.slug === 'openrouter');
    const exa = summaries.find((s) => s.slug === 'exa');
    expect(ollama?.requiresApiKey).toBe(false);
    expect(openrouter?.requiresApiKey).toBe(true);
    expect(exa?.requiresApiKey).toBe(true);
  });

  it('lists Ollama with OLLAMA_HOST as its env var', () => {
    const summary = listProviderSummaries(env).find((s) => s.slug === 'ollama');
    expect(summary?.env).toEqual(['OLLAMA_HOST']);
  });

  it('lists Vercel with AI_GATEWAY_API_KEY', () => {
    const summary = listProviderSummaries(env).find((s) => s.slug === 'vercel');
    expect(summary?.env).toEqual(['AI_GATEWAY_API_KEY']);
  });

  it('lists Cloudflare with both API token and account id env vars', () => {
    const summary = listProviderSummaries(env).find(
      (s) => s.slug === 'cloudflare',
    );
    expect(summary?.env).toEqual([
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
    ]);
  });

  it('lists single-key providers with one env var entry', () => {
    const summary = listProviderSummaries(env).find(
      (s) => s.slug === 'anthropic',
    );
    expect(summary?.env).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('lists Tomba with both API key and secret env vars', () => {
    const summary = listProviderSummaries(env).find((s) => s.slug === 'tomba');
    expect(summary?.env).toEqual(['TOMBA_API_KEY', 'TOMBA_SECRET_KEY']);
    expect(summary?.category).toBe('data');
  });

  it('lists web providers with their single API key env var and no cachePath', () => {
    const tavily = listProviderSummaries(env).find((s) => s.slug === 'tavily');
    expect(tavily?.env).toEqual(['TAVILY_API_KEY']);
    expect(tavily?.category).toBe('web');
    expect(tavily?.cachePath).toBeUndefined();
  });

  it('AI providers carry a cachePath; web/data providers do not', () => {
    const summaries = listProviderSummaries(env);
    for (const s of summaries) {
      if (s.category === 'ai') {
        expect(s.cachePath).toBeTypeOf('string');
      } else {
        expect(s.cachePath).toBeUndefined();
      }
    }
  });

  it('does not surface a top-level defaultModel field (per-modality defaults live in config defaults.<verb>)', () => {
    const summaries = listProviderSummaries(env);
    for (const s of summaries) {
      expect(s).not.toHaveProperty('defaultModel');
    }
  });
});
