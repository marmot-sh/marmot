import { describe, expect, it } from 'vitest';

import { isProviderCacheFresh } from '../src/cache/store.js';
import type { ProviderCacheFile } from '../src/types.js';

const sampleCache: ProviderCacheFile = {
  version: 1,
  provider: 'ollama',
  defaultModel: 'qwen3:4b',
  fetchedAt: '2026-04-22T12:00:00.000Z',
  models: [
    {
      id: 'qwen3:4b',
      name: 'qwen3:4b',
      contextLength: null,
      pricing: null,
      inputModalities: ['text'],
      outputModalities: ['text'],
      updatedAt: null,
      metadata: {},
    },
  ],
};

describe('isProviderCacheFresh', () => {
  it('returns true for a fresh cache', () => {
    expect(
      isProviderCacheFresh(sampleCache, new Date('2026-04-23T11:59:59.000Z')),
    ).toBe(true);
  });

  it('returns false for a stale cache', () => {
    expect(
      isProviderCacheFresh(sampleCache, new Date('2026-04-23T12:00:01.000Z')),
    ).toBe(false);
  });
});
