import type { LanguageModelUsage, ProviderMetadata } from 'ai';

import type { NormalizedUsageSummary } from '../types.js';

export function normalizeUsage(
  usage: LanguageModelUsage | undefined,
): NormalizedUsageSummary {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  };
}

/**
 * Anthropic returns prompt-cache token counts in providerMetadata.anthropic.usage:
 *   - cache_read_input_tokens: tokens served from a cache hit (~10% input cost)
 *   - cache_creation_input_tokens: tokens that *populated* a cache (~125% input cost)
 * The Vercel AI SDK keeps these in the raw provider payload — surface them on
 * NormalizedUsageSummary so session logging can report cache hit/write rates.
 */
export function normalizeAnthropicUsage(
  usage: LanguageModelUsage | undefined,
  providerMetadata: ProviderMetadata | undefined,
): NormalizedUsageSummary {
  const out: NormalizedUsageSummary = normalizeUsage(usage);
  const anthropicUsage = getAnthropicUsage(providerMetadata);
  const cachedInputTokens =
    getNumber(anthropicUsage, 'cache_read_input_tokens')
    ?? getNumber(anthropicUsage, 'cacheReadInputTokens');
  const cacheWriteInputTokens =
    getNumber(anthropicUsage, 'cache_creation_input_tokens')
    ?? getNumber(anthropicUsage, 'cacheCreationInputTokens');
  if (cachedInputTokens !== undefined) out.cachedInputTokens = cachedInputTokens;
  if (cacheWriteInputTokens !== undefined) out.cacheWriteInputTokens = cacheWriteInputTokens;
  return out;
}

function getAnthropicUsage(providerMetadata: ProviderMetadata | undefined): unknown {
  if (!providerMetadata || typeof providerMetadata !== 'object') return undefined;
  const anthropic = providerMetadata.anthropic;
  if (!anthropic || typeof anthropic !== 'object') return undefined;
  if ('usage' in anthropic) return (anthropic as Record<string, unknown>).usage;
  return anthropic;
}

export function normalizeOpenRouterUsage(
  usage: LanguageModelUsage | undefined,
  providerMetadata: ProviderMetadata | undefined,
): NormalizedUsageSummary {
  const normalizedUsage: NormalizedUsageSummary = normalizeUsage(usage);
  const openRouterUsage = getOpenRouterUsage(providerMetadata);
  const costCredits = getNumber(openRouterUsage, 'cost');
  const cachedInputTokens = getNestedNumber(
    openRouterUsage,
    'promptTokensDetails',
    'cachedTokens',
  );
  const reasoningTokens = getNestedNumber(
    openRouterUsage,
    'completionTokensDetails',
    'reasoningTokens',
  );
  const upstreamInferenceCostCredits = getNestedNumber(
    openRouterUsage,
    'costDetails',
    'upstreamInferenceCost',
  );

  if (costCredits !== undefined) {
    normalizedUsage.costCredits = costCredits;
  }

  if (cachedInputTokens !== undefined) {
    normalizedUsage.cachedInputTokens = cachedInputTokens;
  }

  if (reasoningTokens !== undefined) {
    normalizedUsage.reasoningTokens = reasoningTokens;
  }

  if (upstreamInferenceCostCredits !== undefined) {
    normalizedUsage.costDetails = {
      upstreamInferenceCostCredits,
    };
  }

  return normalizedUsage;
}

function getOpenRouterUsage(providerMetadata: ProviderMetadata | undefined): unknown {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return undefined;
  }

  const openrouter = providerMetadata.openrouter;

  if (!openrouter || typeof openrouter !== 'object' || !('usage' in openrouter)) {
    return undefined;
  }

  return openrouter.usage;
}

function getNumber(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== 'object' || !(key in source)) {
    return undefined;
  }

  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

function getNestedNumber(
  source: unknown,
  objectKey: string,
  numberKey: string,
): number | undefined {
  if (!source || typeof source !== 'object' || !(objectKey in source)) {
    return undefined;
  }

  return getNumber((source as Record<string, unknown>)[objectKey], numberKey);
}
