import { describe, expect, it } from 'vitest';

import {
  findStaleDefaults,
  formatStaleDefaultsBanner,
  type CatalogSnapshot,
  type MarmotConfig,
} from '../src/cache/validate.js';

const baseConfig: MarmotConfig = {
  version: 1,
  defaults: {
    text: { provider: 'openrouter', model: 'openai/gpt-oss-120b' },
    image: { provider: 'openrouter', model: 'google/gemini-2.5-flash-image-preview' },
  },
};

const fetchedAt = '2026-05-05T00:00:00.000Z';

describe('findStaleDefaults', () => {
  it('flags a configured model that is not in the cache', () => {
    const catalogs: CatalogSnapshot = {
      image: {
        openrouter: {
          version: 1,
          provider: 'openrouter',
          defaultModel: 'google/gemini-2.5-flash-image',
          fetchedAt,
          models: [
            { id: 'google/gemini-2.5-flash-image', name: 'GA' },
          ],
        },
      },
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
      text: {
        openrouter: {
          version: 1,
          provider: 'openrouter',
          defaultModel: 'openai/gpt-oss-120b',
          fetchedAt,
          models: [{ id: 'openai/gpt-oss-120b', name: 'gpt-oss-120b' }],
        },
      },
      image: {
        openrouter: {
          version: 1,
          provider: 'openrouter',
          defaultModel: 'google/gemini-2.5-flash-image-preview',
          fetchedAt,
          models: [
            {
              id: 'google/gemini-2.5-flash-image-preview',
              name: 'preview',
            },
          ],
        },
      },
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
      text: {
        openrouter: {
          version: 1,
          provider: 'openrouter',
          defaultModel: 'openai/gpt-oss-120b',
          fetchedAt,
          models: [],
        },
      },
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
