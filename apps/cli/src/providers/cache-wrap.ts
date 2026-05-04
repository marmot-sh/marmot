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
  /** When true, skip cache read AND skip cache write entirely. */
  noCache?: boolean;
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

  // Caching disabled (the default) or explicit --no-cache → straight fetch.
  if (!settings.enabled || options.noCache) {
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
