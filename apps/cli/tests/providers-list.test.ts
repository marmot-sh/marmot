import { describe, expect, it } from 'vitest';

import { listProviderSummaries } from '../src/providers/index.js';

describe('listProviderSummaries', () => {
  const env = { HOME: '/tmp/marmot-test-home' };

  it('lists all six providers with their slugs and display names', () => {
    const summaries = listProviderSummaries(env);
    const slugs = summaries.map((s) => s.slug).sort();
    expect(slugs).toEqual(
      ['anthropic', 'cloudflare', 'ollama', 'openai', 'openrouter', 'vercel'],
    );
  });

  it('marks providers that need an API key', () => {
    const summaries = listProviderSummaries(env);
    const ollama = summaries.find((s) => s.slug === 'ollama');
    const openrouter = summaries.find((s) => s.slug === 'openrouter');
    expect(ollama?.requiresApiKey).toBe(false);
    expect(openrouter?.requiresApiKey).toBe(true);
  });

  it('lists Ollama with OLLAMA_HOST as its env var', () => {
    const summary = listProviderSummaries(env).find((s) => s.slug === 'ollama');
    expect(summary?.env).toEqual(['OLLAMA_HOST']);
  });

  it('lists Vercel with AI_GATEWAY_API_KEY', () => {
    const summary = listProviderSummaries(env).find((s) => s.slug === 'vercel');
    expect(summary?.env).toEqual(['AI_GATEWAY_API_KEY']);
    expect(summary?.defaultModel).toBe('anthropic/claude-sonnet-4.6');
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
});
