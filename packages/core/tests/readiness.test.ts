import { describe, expect, it } from 'vitest';

import {
  getReadyProviders,
  isProviderReady,
  listProviderReadiness,
} from '../src/providers.js';

describe('isProviderReady', () => {
  it('reports openrouter ready when OPENROUTER_API_KEY is set', () => {
    expect(isProviderReady('openrouter', null, { OPENROUTER_API_KEY: 'sk-or-v1-...' })).toBe(true);
  });

  it('reports openrouter not ready when the env var is missing', () => {
    expect(isProviderReady('openrouter', null, {})).toBe(false);
  });

  it('reports openrouter not ready when the env var is whitespace', () => {
    expect(isProviderReady('openrouter', null, { OPENROUTER_API_KEY: '   ' })).toBe(false);
  });

  it('reports ollama ready by default — no env var required', () => {
    expect(isProviderReady('ollama', null, {})).toBe(true);
  });

  it('reports ollama not ready when explicitly disabled in config', () => {
    const config = { version: 1 as const, providers: { ollama: { enabled: false } } };
    expect(isProviderReady('ollama', config, {})).toBe(false);
  });

  it('honors a custom apiKeyEnvVar override', () => {
    const config = {
      version: 1 as const,
      providers: { openai: { apiKeyEnvVar: 'WORK_OPENAI_KEY' } },
    };
    // Default env var name is unset, but the custom override is set.
    expect(isProviderReady('openai', config, { WORK_OPENAI_KEY: 'sk-...' })).toBe(true);
    expect(isProviderReady('openai', config, { OPENAI_API_KEY: 'sk-...' })).toBe(false);
  });

  it('requires both api key AND secret for tomba', () => {
    expect(
      isProviderReady('tomba', null, { TOMBA_API_KEY: 't_key' }),
    ).toBe(false);
    expect(
      isProviderReady('tomba', null, { TOMBA_API_KEY: 't_key', TOMBA_SECRET_KEY: 't_sec' }),
    ).toBe(true);
  });

  it('requires both api token AND account id for cloudflare', () => {
    expect(
      isProviderReady('cloudflare', null, { CLOUDFLARE_API_TOKEN: 'cf_t' }),
    ).toBe(false);
    expect(
      isProviderReady('cloudflare', null, {
        CLOUDFLARE_API_TOKEN: 'cf_t',
        CLOUDFLARE_ACCOUNT_ID: 'acct_123',
      }),
    ).toBe(true);
  });

  it('reports a web provider ready when its env var is set', () => {
    expect(isProviderReady('tavily', null, { TAVILY_API_KEY: 'tv_k' })).toBe(true);
    expect(isProviderReady('tavily', null, {})).toBe(false);
  });

  it('reports a data provider ready when its single env var is set', () => {
    expect(isProviderReady('pdl', null, { PDL_API_KEY: 'pdl_k' })).toBe(true);
    expect(isProviderReady('pdl', null, {})).toBe(false);
  });
});

describe('getReadyProviders', () => {
  it('returns slugs alphabetically across AI, web, and data', () => {
    const env = {
      OPENROUTER_API_KEY: 'k',
      TAVILY_API_KEY: 'k',
      PDL_API_KEY: 'k',
      // Ollama is always ready (no key required) when not disabled.
    };
    expect(getReadyProviders(null, env)).toEqual(['ollama', 'openrouter', 'pdl', 'tavily']);
  });

  it('omits providers that are disabled in config even when keys are set', () => {
    const config = {
      version: 1 as const,
      providers: { tavily: { enabled: false } },
    };
    const env = { TAVILY_API_KEY: 'k', OPENROUTER_API_KEY: 'k' };
    expect(getReadyProviders(config, env)).toEqual(['ollama', 'openrouter']);
  });

  it('returns just ollama when no env vars are set', () => {
    expect(getReadyProviders(null, {})).toEqual(['ollama']);
  });
});

describe('listProviderReadiness', () => {
  it('reports per-env-var set/unset for each provider', () => {
    const env = {
      OPENROUTER_API_KEY: 'k',
      TOMBA_API_KEY: 'tk',
      // TOMBA_SECRET_KEY intentionally missing
    };
    const readiness = listProviderReadiness(null, env);

    const openrouter = readiness.get('openrouter');
    expect(openrouter?.ready).toBe(true);
    expect(openrouter?.keys).toEqual([{ env: 'OPENROUTER_API_KEY', set: true }]);

    const tomba = readiness.get('tomba');
    expect(tomba?.ready).toBe(false);
    expect(tomba?.keys).toEqual([
      { env: 'TOMBA_API_KEY', set: true },
      { env: 'TOMBA_SECRET_KEY', set: false },
    ]);

    const ollama = readiness.get('ollama');
    expect(ollama?.ready).toBe(true);
    expect(ollama?.keys).toEqual([]);
  });

  it('marks provider as not enabled when config flag is false', () => {
    const config = {
      version: 1 as const,
      providers: { openai: { enabled: false } },
    };
    const readiness = listProviderReadiness(config, { OPENAI_API_KEY: 'k' });
    const openai = readiness.get('openai');
    expect(openai?.enabled).toBe(false);
    expect(openai?.ready).toBe(false);
    expect(openai?.keys).toEqual([{ env: 'OPENAI_API_KEY', set: true }]);
  });

  it('uses custom apiKeyEnvVar in the keys list when set in config', () => {
    const config = {
      version: 1 as const,
      providers: { apollo: { apiKeyEnvVar: 'WORK_APOLLO' } },
    };
    const readiness = listProviderReadiness(config, { WORK_APOLLO: 'k' });
    const apollo = readiness.get('apollo');
    expect(apollo?.keys).toEqual([{ env: 'WORK_APOLLO', set: true }]);
    expect(apollo?.ready).toBe(true);
  });

  it('covers all 19 providers', () => {
    const readiness = listProviderReadiness(null, {});
    expect(readiness.size).toBe(19);
  });
});
