// Cost computation for text generation calls.
//
// Two sources of pricing rates, in precedence order:
//   1. The model's pricing record in the provider model cache (today: only
//      OpenRouter ships real rates; Vercel partial; others null).
//   2. A user-supplied override at config.providers.<slug>.pricing.<modelId>.
//      Lets users hand-write rates for providers whose API doesn't return them.
//
// Rates follow the OpenRouter convention: stringified per-token USD. For
// example "0.000003" means $3 per million tokens. computeTextCallCost
// multiplies the rate by inputTokens/outputTokens and returns USD.

import type {
  CostSource,
  NormalizedUsageSummary,
  ProviderModelCacheEntry,
  ProviderModelPricing,
} from '../types.js';
import type { ProviderSlug } from './constants.js';
import type { MarmotConfig } from '../schemas/config.js';

export type ResolvedTextPricing = {
  pricing: ProviderModelPricing;
  source: CostSource;
};

export type ComputeTextCallCostInput = {
  usage: Pick<NormalizedUsageSummary, 'inputTokens' | 'outputTokens'>;
  pricing: ProviderModelPricing;
};

/** Cost in USD, or null if rates are missing or token counts are unknown. */
export function computeTextCallCost(input: ComputeTextCallCostInput): number | null {
  const promptRate = parseRate(input.pricing.prompt);
  const completionRate = parseRate(input.pricing.completion);
  if (promptRate === null && completionRate === null) return null;

  const inputTokens = input.usage.inputTokens;
  const outputTokens = input.usage.outputTokens;
  if (inputTokens === null && outputTokens === null) return null;

  let cost = 0;
  if (promptRate !== null && inputTokens !== null) cost += promptRate * inputTokens;
  if (completionRate !== null && outputTokens !== null) cost += completionRate * outputTokens;
  return cost;
}

/**
 * Resolves pricing for (provider, modelId) preferring config override over the
 * cached entry. Returns null if neither has anything usable.
 */
export function resolveTextPricing(input: {
  provider: ProviderSlug;
  modelId: string;
  cacheEntry?: ProviderModelCacheEntry | null;
  config?: MarmotConfig | null;
}): ResolvedTextPricing | null {
  const override = readConfigPricingOverride(input.provider, input.modelId, input.config);
  if (override) {
    return { pricing: override, source: 'config-override' };
  }

  const cached = input.cacheEntry?.pricing ?? null;
  if (cached && hasAnyRate(cached)) {
    return { pricing: cached, source: 'provider-cache' };
  }

  return null;
}

function readConfigPricingOverride(
  provider: ProviderSlug,
  modelId: string,
  config: MarmotConfig | null | undefined,
): ProviderModelPricing | null {
  const settings = config?.providers?.[provider];
  const entry = settings?.pricing?.[modelId];
  if (!entry) return null;
  const pricing: ProviderModelPricing = {
    prompt: entry.prompt ?? null,
    completion: entry.completion ?? null,
    request: entry.request ?? null,
    image: entry.image ?? null,
  };
  if (!hasAnyRate(pricing)) return null;
  return pricing;
}

function hasAnyRate(p: ProviderModelPricing): boolean {
  return Boolean(p.prompt || p.completion || p.request || p.image);
}

function parseRate(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
