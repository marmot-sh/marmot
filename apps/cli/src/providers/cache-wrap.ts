// Shared cache wrapper for web/data sync verbs. Reads provider cache settings
// from config, looks up cached responses on hit, calls the adapter on miss
// then writes the result.

import {
  lookupCached,
  resolveProviderCache,
  writeCached,
  type AnyProviderSlug,
  type MarmotConfig,
} from '@marmot-sh/core';

export type WithResponseCacheOptions<T> = {
  provider: AnyProviderSlug;
  verb: string;
  /** Canonical request payload that uniquely identifies this call. */
  input: unknown;
  /** Optional human-readable label for grep / find operations. */
  query?: string;
  config: MarmotConfig | null;
  env?: NodeJS.ProcessEnv;
  /**
   * Explicit per-call opt-out. When true, skip cache read AND skip cache
   * write entirely. Wins over both `forceCache` and the provider's
   * config — explicit-bypass is always honored.
   */
  noCache?: boolean;
  /**
   * Explicit per-call opt-in. When true, run the cache path regardless of
   * the provider's `cache.enabled` config. Set by callers when the user
   * explicitly chose `cache: true` on a preset or passed `--cache` at
   * runtime — preset truth wins so `cache: true` on a preset turns
   * caching on for that call without the user also having to flip
   * `providers.<slug>.cache.enabled`. The provider's `enabled` flag
   * remains the default for calls with no explicit opinion.
   */
  forceCache?: boolean;
  /** When true, skip cache read but still write the response. Forces a fresh
   *  call and overwrites any existing entry. */
  refresh?: boolean;
  /** Function that performs the actual provider call when cache misses. */
  fetcher: () => Promise<T>;
};

export type CacheOutcome<T> = {
  response: T;
  /** True when the response came from the local cache, false when fresh. */
  cached: boolean;
};

export async function withResponseCache<T>(
  options: WithResponseCacheOptions<T>,
): Promise<CacheOutcome<T>> {
  const env = options.env ?? process.env;
  const settings = resolveProviderCache(options.provider, options.config);

  // Explicit opt-out always wins.
  if (options.noCache) {
    const response = await options.fetcher();
    return { response, cached: false };
  }

  // Caching is active when the provider's config says so OR the call site
  // forced it on (preset `cache: true` / runtime `--cache`). This lets a
  // preset author opt into caching without separately flipping
  // `providers.<slug>.cache.enabled` — preset truth wins.
  const cacheActive = settings.enabled || Boolean(options.forceCache);
  if (!cacheActive) {
    const response = await options.fetcher();
    return { response, cached: false };
  }

  const key = { verb: options.verb, input: options.input };

  // --refresh skips read but still writes.
  if (!options.refresh) {
    const lookup = await lookupCached<T>(options.provider, key, env);
    if (lookup.hit) {
      return { response: lookup.response, cached: true };
    }
  }

  const response = await options.fetcher();
  // Best-effort write — adapter call already succeeded; cache failure shouldn't
  // poison the response.
  try {
    await writeCached(options.provider, key, response, settings.ttlSeconds, {
      env,
      query: options.query,
    });
  } catch {
    // ignore
  }
  return { response, cached: false };
}
