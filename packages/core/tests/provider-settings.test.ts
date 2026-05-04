import { describe, expect, it } from 'vitest';

import {
  assertProviderEnabled,
  defaultPrimaryEnvVar,
  defaultSecondaryEnvVar,
  resolveProviderAuth,
  resolveProviderCache,
} from '../src/lib/config.js';
import { marmotConfigSchema, type MarmotConfig } from '../src/schemas/config.js';

const baseConfig: MarmotConfig = { version: 1 };

describe('marmotConfigSchema — providers block', () => {
  it('accepts a fully populated providers entry', () => {
    const cfg = {
      version: 1,
      providers: {
        apollo: {
          enabled: true,
          apiKeyEnvVar: 'MY_APOLLO_KEY',
          cache: { enabled: true, ttlDays: 14 },
        },
        tomba: {
          apiKeyEnvVar: 'WORK_TOMBA_KEY',
          apiSecretEnvVar: 'WORK_TOMBA_SECRET',
        },
      },
    };
    expect(marmotConfigSchema.parse(cfg)).toMatchObject(cfg);
  });

  it('rejects unknown provider slug as the key', () => {
    expect(() =>
      marmotConfigSchema.parse({
        version: 1,
        providers: { not_a_provider: { enabled: false } },
      }),
    ).toThrow();
  });

  it('rejects unknown fields under a provider entry', () => {
    expect(() =>
      marmotConfigSchema.parse({
        version: 1,
        providers: { apollo: { enabled: true, foo: 'bar' } },
      }),
    ).toThrow();
  });

  it('cache.ttlDays must be a positive integer', () => {
    expect(() =>
      marmotConfigSchema.parse({
        version: 1,
        providers: { apollo: { cache: { enabled: true, ttlDays: 0 } } },
      }),
    ).toThrow();
  });
});

describe('defaultPrimaryEnvVar / defaultSecondaryEnvVar', () => {
  it('returns built-in env vars per category', () => {
    expect(defaultPrimaryEnvVar('apollo')).toBe('APOLLO_API_KEY');
    expect(defaultPrimaryEnvVar('hunter')).toBe('HUNTER_API_KEY');
    expect(defaultPrimaryEnvVar('tomba')).toBe('TOMBA_API_KEY');
    expect(defaultPrimaryEnvVar('tavily')).toBe('TAVILY_API_KEY');
    expect(defaultPrimaryEnvVar('openai')).toBe('OPENAI_API_KEY');
  });

  it('returns null for providers without a primary key (Ollama)', () => {
    expect(defaultPrimaryEnvVar('ollama')).toBeNull();
  });

  it('returns secondary env vars where applicable', () => {
    expect(defaultSecondaryEnvVar('tomba')).toBe('TOMBA_SECRET_KEY');
    expect(defaultSecondaryEnvVar('cloudflare')).toBe('CLOUDFLARE_ACCOUNT_ID');
    expect(defaultSecondaryEnvVar('apollo')).toBeNull();
    expect(defaultSecondaryEnvVar('tavily')).toBeNull();
  });
});

describe('resolveProviderAuth', () => {
  it('falls back to built-in env vars when no config', () => {
    const result = resolveProviderAuth('apollo', baseConfig, {
      APOLLO_API_KEY: 'live-key',
    });
    expect(result.apiKey).toBe('live-key');
    expect(result.apiSecret).toBeUndefined();
  });

  it('honors apiKeyEnvVar override', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: { apollo: { apiKeyEnvVar: 'MY_APOLLO_KEY' } },
    };
    const result = resolveProviderAuth('apollo', config, {
      APOLLO_API_KEY: 'wrong',
      MY_APOLLO_KEY: 'right',
    });
    expect(result.apiKey).toBe('right');
  });

  it('explicit override beats both env and config', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: { apollo: { apiKeyEnvVar: 'MY_APOLLO_KEY' } },
    };
    const result = resolveProviderAuth(
      'apollo',
      config,
      { APOLLO_API_KEY: 'env', MY_APOLLO_KEY: 'config-env' },
      { apiKey: 'flag' },
    );
    expect(result.apiKey).toBe('flag');
  });

  it('resolves both primary and secondary for Tomba', () => {
    const result = resolveProviderAuth('tomba', baseConfig, {
      TOMBA_API_KEY: 'tk',
      TOMBA_SECRET_KEY: 'ts',
    });
    expect(result.apiKey).toBe('tk');
    expect(result.apiSecret).toBe('ts');
  });

  it('honors apiSecretEnvVar override for Tomba', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: { tomba: { apiSecretEnvVar: 'WORK_TOMBA_SECRET' } },
    };
    const result = resolveProviderAuth('tomba', config, {
      TOMBA_API_KEY: 'tk',
      WORK_TOMBA_SECRET: 'tsx',
    });
    expect(result.apiKey).toBe('tk');
    expect(result.apiSecret).toBe('tsx');
  });

  it('returns undefined when env var is missing', () => {
    const result = resolveProviderAuth('apollo', baseConfig, {});
    expect(result.apiKey).toBeUndefined();
  });
});

describe('assertProviderEnabled', () => {
  it('no-op when settings absent', () => {
    expect(() => assertProviderEnabled('apollo', baseConfig)).not.toThrow();
  });

  it('no-op when enabled is unset (defaults to enabled)', () => {
    expect(() =>
      assertProviderEnabled('apollo', {
        version: 1,
        providers: { apollo: { apiKeyEnvVar: 'X' } },
      }),
    ).not.toThrow();
  });

  it('no-op when enabled is true', () => {
    expect(() =>
      assertProviderEnabled('apollo', {
        version: 1,
        providers: { apollo: { enabled: true } },
      }),
    ).not.toThrow();
  });

  it('throws when enabled is false', () => {
    expect(() =>
      assertProviderEnabled('apollo', {
        version: 1,
        providers: { apollo: { enabled: false } },
      }),
    ).toThrow(/disabled/);
  });
});

describe('resolveProviderCache', () => {
  it('caching is disabled by default', () => {
    expect(resolveProviderCache('apollo', baseConfig)).toEqual({
      enabled: false,
      ttlSeconds: 30 * 24 * 60 * 60,
    });
  });

  it('uses configured ttlDays when caching is enabled', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: { apollo: { cache: { enabled: true, ttlDays: 7 } } },
    };
    expect(resolveProviderCache('apollo', config)).toEqual({
      enabled: true,
      ttlSeconds: 7 * 24 * 60 * 60,
    });
  });

  it('defaults ttlDays to 30 when only enabled is set', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: { apollo: { cache: { enabled: true } } },
    };
    expect(resolveProviderCache('apollo', config)).toEqual({
      enabled: true,
      ttlSeconds: 30 * 24 * 60 * 60,
    });
  });
});
