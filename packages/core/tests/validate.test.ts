import { describe, expect, it } from 'vitest';

import {
  findStaleDefaults,
  formatStaleDefaultsBanner,
  type CatalogSnapshot,
} from '../src/cache/validate.js';
import type { MarmotConfig } from '../src/schemas/config.js';
import type {
  ProviderCacheFile,
  ProviderImageCacheFile,
} from '../src/types.js';

const baseConfig: MarmotConfig = {
  version: 1,
  defaults: {
    text: { provider: 'openrouter', model: 'openai/gpt-oss-120b' },
    image: { provider: 'openrouter', model: 'google/gemini-2.5-flash-image-preview' },
  },
};

const fetchedAt = '2026-05-05T00:00:00.000Z';

function textCache(provider: 'openrouter', modelIds: string[]): ProviderCacheFile {
  return {
    version: 1,
    provider,
    defaultModel: modelIds[0] ?? '',
    fetchedAt,
    models: modelIds.map((id) => ({
      id,
      name: id,
      contextLength: null,
      pricing: null,
      inputModalities: ['text'],
      outputModalities: ['text'],
      updatedAt: null,
      metadata: {},
    })),
  };
}

function imageCache(
  provider: 'openrouter',
  modelIds: string[],
): ProviderImageCacheFile {
  return {
    version: 1,
    provider,
    defaultModel: modelIds[0] ?? '',
    fetchedAt,
    models: modelIds.map((id) => ({
      id,
      name: id,
      metadata: {},
    })),
  };
}

describe('findStaleDefaults', () => {
  it('flags a configured model that is not in the cache', () => {
    const catalogs: CatalogSnapshot = {
      image: { openrouter: imageCache('openrouter', ['google/gemini-2.5-flash-image']) },
    };
    const stale = findStaleDefaults(baseConfig, catalogs);
    expect(stale).toEqual([
      {
        verb: 'image',
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-image-preview',
      },
    ]);
  });

  it('returns nothing when every configured model is present', () => {
    const catalogs: CatalogSnapshot = {
      text: { openrouter: textCache('openrouter', ['openai/gpt-oss-120b']) },
      image: { openrouter: imageCache('openrouter', ['google/gemini-2.5-flash-image-preview']) },
    };
    expect(findStaleDefaults(baseConfig, catalogs)).toEqual([]);
  });

  it('skips verbs whose cache is missing rather than flagging them', () => {
    // No catalog passed for text → can't validate, must not fabricate a
    // stale entry. Otherwise running the validator before any cache exists
    // would warn about every default in the user's config.
    const catalogs: CatalogSnapshot = {};
    expect(findStaleDefaults(baseConfig, catalogs)).toEqual([]);
  });

  it('skips verbs with no configured default', () => {
    const config: MarmotConfig = {
      version: 1,
      defaults: { text: { provider: 'openrouter' } },
    };
    const catalogs: CatalogSnapshot = {
      text: { openrouter: textCache('openrouter', []) },
    };
    expect(findStaleDefaults(config, catalogs)).toEqual([]);
  });
});

describe('formatStaleDefaultsBanner', () => {
  it('returns null when nothing is stale so callers can skip rendering', () => {
    expect(formatStaleDefaultsBanner([])).toBeNull();
  });

  it('renders a multiline banner with the actionable fix hint', () => {
    const banner = formatStaleDefaultsBanner([
      {
        verb: 'image',
        provider: 'openrouter',
        model: 'google/gemini-2.5-flash-image-preview',
      },
    ]);
    expect(banner).toMatch(/1 configured default/);
    expect(banner).toMatch(/openrouter:google\/gemini-2\.5-flash-image-preview/);
    expect(banner).toMatch(/`marmot setup`/);
  });
});
