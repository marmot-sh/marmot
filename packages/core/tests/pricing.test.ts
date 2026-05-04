import { describe, expect, it } from 'vitest';

import {
  computeTextCallCost,
  resolveTextPricing,
} from '../src/lib/pricing.js';
import type {
  ProviderModelCacheEntry,
  ProviderModelPricing,
} from '../src/types.js';
import type { MarmotConfig } from '../src/schemas/config.js';

const PRICING_3_15: ProviderModelPricing = {
  // $3 / M input tokens, $15 / M output tokens.
  prompt: '0.000003',
  completion: '0.000015',
  request: null,
  image: null,
};

describe('computeTextCallCost', () => {
  it('computes cost from per-token rates', () => {
    const cost = computeTextCallCost({
      usage: { inputTokens: 1_000, outputTokens: 500 },
      pricing: PRICING_3_15,
    });
    expect(cost).toBeCloseTo(1_000 * 0.000003 + 500 * 0.000015, 12);
  });

  it('returns null when no rates are present', () => {
    const cost = computeTextCallCost({
      usage: { inputTokens: 1_000, outputTokens: 500 },
      pricing: { prompt: null, completion: null, request: null, image: null },
    });
    expect(cost).toBe(null);
  });

  it('returns null when both token counts are unknown', () => {
    const cost = computeTextCallCost({
      usage: { inputTokens: null, outputTokens: null },
      pricing: PRICING_3_15,
    });
    expect(cost).toBe(null);
  });

  it('partial credit: only output tokens known', () => {
    const cost = computeTextCallCost({
      usage: { inputTokens: null, outputTokens: 500 },
      pricing: PRICING_3_15,
    });
    expect(cost).toBeCloseTo(500 * 0.000015, 12);
  });

  it('rejects negative or NaN rates', () => {
    const cost = computeTextCallCost({
      usage: { inputTokens: 100, outputTokens: 100 },
      pricing: { prompt: '-1', completion: 'not-a-number', request: null, image: null },
    });
    expect(cost).toBe(null);
  });
});

describe('resolveTextPricing', () => {
  const cacheEntryWithPricing: ProviderModelCacheEntry = {
    id: 'gpt-4o',
    name: 'GPT-4o',
    contextLength: 128_000,
    pricing: PRICING_3_15,
    inputModalities: ['text'],
    outputModalities: ['text'],
    updatedAt: null,
    metadata: {},
  };

  const cacheEntryNoPricing: ProviderModelCacheEntry = {
    ...cacheEntryWithPricing,
    pricing: null,
  };

  it('prefers cache pricing when present', () => {
    const r = resolveTextPricing({
      provider: 'openrouter',
      modelId: 'gpt-4o',
      cacheEntry: cacheEntryWithPricing,
      config: null,
    });
    expect(r?.source).toBe('provider-cache');
    expect(r?.pricing.prompt).toBe('0.000003');
  });

  it('config override beats cache pricing', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: {
        openrouter: {
          pricing: {
            'gpt-4o': { prompt: '0.000001', completion: '0.000002' },
          },
        },
      },
    };
    const r = resolveTextPricing({
      provider: 'openrouter',
      modelId: 'gpt-4o',
      cacheEntry: cacheEntryWithPricing,
      config,
    });
    expect(r?.source).toBe('config-override');
    expect(r?.pricing.prompt).toBe('0.000001');
    expect(r?.pricing.completion).toBe('0.000002');
  });

  it('falls back to config when cache has no pricing', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: {
        openai: {
          pricing: {
            'gpt-4o': { prompt: '0.0000025', completion: '0.00001' },
          },
        },
      },
    };
    const r = resolveTextPricing({
      provider: 'openai',
      modelId: 'gpt-4o',
      cacheEntry: cacheEntryNoPricing,
      config,
    });
    expect(r?.source).toBe('config-override');
    expect(r?.pricing.prompt).toBe('0.0000025');
  });

  it('returns null when neither source has rates', () => {
    const r = resolveTextPricing({
      provider: 'openai',
      modelId: 'gpt-4o',
      cacheEntry: cacheEntryNoPricing,
      config: { version: 1 },
    });
    expect(r).toBe(null);
  });

  it('does not fall through to cache when override exists for a different model', () => {
    const config: MarmotConfig = {
      version: 1,
      providers: {
        openrouter: {
          pricing: {
            'some-other-model': { prompt: '0.00001' },
          },
        },
      },
    };
    const r = resolveTextPricing({
      provider: 'openrouter',
      modelId: 'gpt-4o',
      cacheEntry: cacheEntryWithPricing,
      config,
    });
    // Override is for a different model; cache pricing should win.
    expect(r?.source).toBe('provider-cache');
  });
});
