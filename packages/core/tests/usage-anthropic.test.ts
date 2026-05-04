import { describe, expect, it } from 'vitest';

import { normalizeAnthropicUsage } from '../src/lib/usage.js';

describe('normalizeAnthropicUsage', () => {
  const baseUsage = { inputTokens: 100, outputTokens: 50, totalTokens: 150 } as never;

  it('returns plain usage when no provider metadata', () => {
    const out = normalizeAnthropicUsage(baseUsage, undefined);
    expect(out).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });

  it('extracts cache_read_input_tokens from snake_case payload', () => {
    const out = normalizeAnthropicUsage(baseUsage, {
      anthropic: { usage: { cache_read_input_tokens: 80, cache_creation_input_tokens: 20 } },
    } as never);
    expect(out.cachedInputTokens).toBe(80);
    expect(out.cacheWriteInputTokens).toBe(20);
  });

  it('extracts camelCase variants too (defensive)', () => {
    const out = normalizeAnthropicUsage(baseUsage, {
      anthropic: { cacheReadInputTokens: 40, cacheCreationInputTokens: 10 },
    } as never);
    expect(out.cachedInputTokens).toBe(40);
    expect(out.cacheWriteInputTokens).toBe(10);
  });

  it('omits cache fields when not present in payload', () => {
    const out = normalizeAnthropicUsage(baseUsage, {
      anthropic: { usage: {} },
    } as never);
    expect(out.cachedInputTokens).toBeUndefined();
    expect(out.cacheWriteInputTokens).toBeUndefined();
  });
});
