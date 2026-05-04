import { describe, expect, it } from 'vitest';

import { normalizeOpenRouterUsage } from '../src/lib/usage.js';

describe('normalizeOpenRouterUsage', () => {
  it('adds OpenRouter cost metadata when present', () => {
    const usage = normalizeOpenRouterUsage({
      inputTokens: 12,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokens: 8,
      outputTokenDetails: {
        textTokens: undefined,
        reasoningTokens: undefined,
      },
      totalTokens: 20,
    }, {
      openrouter: {
        usage: {
          promptTokens: 12,
          completionTokens: 8,
          totalTokens: 20,
          cost: 0.00042,
          promptTokensDetails: {
            cachedTokens: 3,
          },
          completionTokensDetails: {
            reasoningTokens: 2,
          },
          costDetails: {
            upstreamInferenceCost: 0.00031,
          },
        },
      },
    });

    expect(usage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      costCredits: 0.00042,
      cachedInputTokens: 3,
      reasoningTokens: 2,
      costDetails: {
        upstreamInferenceCostCredits: 0.00031,
      },
    });
  });
});
