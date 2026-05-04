// Response cache for web/data sync verb results. Web/data calls are metered
// and often expensive; caching repeat calls within a TTL avoids unnecessary
// spend. Disabled by default; user opts in via providers.<slug>.cache.enabled.
//
// Storage: ~/.marmot/ai/cache/responses/<provider>/<sha256>.json
// File mode: 0o600 (entries may contain provider response bodies).
// Dir mode:  0o700.

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { AICliError } from '../lib/errors.js';
import {
  getProviderResponseCacheDir,
  getResponseCacheDir,
  getResponseCacheEntryPath,
} from '../lib/paths.js';

export type CacheKeyInput = {
  verb: string;
  /** Canonical request payload — anything that uniquely identifies the call.
   *  Keys are sorted before hashing so order-equivalent inputs map to the
   *  same hash. */
  input: unknown;
};

export type ResponseCacheEntry = {
  version: 1;
  /** Provider slug. Stored alongside response for prune/clear operations. */
  provider: string;
  /** Verb name (search, scrape, enrich, etc.). */
  verb: string;
  /** SHA-256 of the canonical {verb, input} pair. Same as the file basename. */
  hash: string;
  /** Optional human-readable label (query string, identifier) for grep / find
   *  operations. Truncated to 200 chars when set. */
  query?: string;
  /** ISO 8601 timestamp of when this entry was written. */
  requestedAt: string;
  /** TTL in seconds; entry is considered expired when now > requestedAt + ttl. */
  ttlSeconds: number;
  /** Cached response body. Verb-shaped (Web*Result, Data*Result, etc.). */
  response: unknown;
};

/* -- key construction ------------------------------------------------------ */

function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      // Drop fields that don't affect cache identity: fetchFn, abortSignal,
      // the apiKey/secret (cache identity is per-provider, not per-key).
      if (key === 'fetchFn' || key === 'abortSignal' || key === 'apiKey' || key === 'apiSecret') {
        continue;
      }
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function hashCacheKey(key: CacheKeyInput): string {
  const canonical = JSON.stringify({ verb: key.verb, input: canonicalize(key.input) });
  return createHash('sha256').update(canonical).digest('hex');
}

/* -- read/write ------------------------------------------------------------ */

export type CacheLookup<T = unknown> =
  | { hit: true; entry: ResponseCacheEntry; response: T }
  | { hit: false; reason: 'miss' | 'expired' | 'corrupt' };

export async function lookupCached<T = unknown>(
  provider: string,
  key: CacheKeyInput,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<CacheLookup<T>> {
  const hash = hashCacheKey(key);
  const path = getResponseCacheEntryPath(provider, hash, env);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return { hit: false, reason: 'miss' };
    throw new AICliError('cache', `Failed to read cache entry "${path}".`, { cause: error });
  }

  let entry: ResponseCacheEntry;
  try {
    entry = JSON.parse(raw) as ResponseCacheEntry;
  } catch {
    return { hit: false, reason: 'corrupt' };
  }

  const requestedAt = Date.parse(entry.requestedAt);
  if (Number.isNaN(requestedAt)) return { hit: false, reason: 'corrupt' };

  const expiresAt = requestedAt + entry.ttlSeconds * 1000;
  if (now().getTime() > expiresAt) return { hit: false, reason: 'expired' };

  return { hit: true, entry, response: entry.response as T };
}

export async function writeCached(
  provider: string,
  key: CacheKeyInput,
  response: unknown,
  ttlSeconds: number,
  options: { env?: NodeJS.ProcessEnv; query?: string; now?: () => Date } = {},
): Promise<{ hash: string; path: string }> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const hash = hashCacheKey(key);
  const path = getResponseCacheEntryPath(provider, hash, env);

  const entry: ResponseCacheEntry = {
    version: 1,
    provider,
    verb: key.verb,
    hash,
    query: options.query?.slice(0, 200),
    requestedAt: now().toISOString(),
    ttlSeconds,
    response,
  };

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(entry, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { hash, path };
}

/* -- invalidation ---------------------------------------------------------- */

export async function clearCachedEntry(
  provider: string,
  key: CacheKeyInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const hash = hashCacheKey(key);
  const path = getResponseCacheEntryPath(provider, hash, env);
  try {
    await rm(path);
    return true;
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return false;
    throw new AICliError('cache', `Failed to clear cache entry "${path}".`, { cause: error });
  }
}

export async function clearProviderCache(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const dir = getProviderResponseCacheDir(provider, env);
  return await removeDirContents(dir);
}

export async function clearAllCache(
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const root = getResponseCacheDir(env);
  let removed = 0;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return 0;
    throw new AICliError('cache', `Failed to list cache root "${root}".`, { cause: error });
  }
  for (const provider of entries) {
    removed += await clearProviderCache(provider, env);
  }
  return removed;
}

/**
 * Remove cached entries for a provider whose stored `query` field matches the
 * given substring (case-insensitive). Returns the number of entries removed.
 * Used by `marmot cache clear --provider X --query "..."`.
 */
export async function clearByQuery(
  provider: string,
  needle: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const dir = getProviderResponseCacheDir(provider, env);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return 0;
    throw new AICliError('cache', `Failed to list cache dir "${dir}".`, { cause: error });
  }
  const lowerNeedle = needle.toLowerCase();
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(dir, file);
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as ResponseCacheEntry;
      if (entry.query?.toLowerCase().includes(lowerNeedle)) {
        await rm(path);
        removed += 1;
      }
    } catch {
      // Corrupt or unreadable — leave it; user can run --all to nuke.
    }
  }
  return removed;
}

export async function clearOlderThan(
  provider: string | null,
  olderThanDays: number,
  env: NodeJS.ProcessEnv = process.env,
  now: () => Date = () => new Date(),
): Promise<number> {
  const cutoff = now().getTime() - olderThanDays * 24 * 60 * 60 * 1000;
  const root = provider
    ? getProviderResponseCacheDir(provider, env)
    : getResponseCacheDir(env);

  if (provider) {
    return await clearOlderThanInDir(root, cutoff);
  }
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return 0;
    throw new AICliError('cache', `Failed to list cache root "${root}".`, { cause: error });
  }
  let removed = 0;
  for (const slug of entries) {
    removed += await clearOlderThanInDir(join(root, slug), cutoff);
  }
  return removed;
}

async function clearOlderThanInDir(dir: string, cutoffMs: number): Promise<number> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return 0;
    throw new AICliError('cache', `Failed to list cache dir "${dir}".`, { cause: error });
  }
  let removed = 0;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(dir, file);
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as ResponseCacheEntry;
      const requestedAt = Date.parse(entry.requestedAt);
      if (Number.isNaN(requestedAt)) continue;
      // `<=` so `--older-than 0` means "remove everything", not "remove only
      // entries strictly older than now."
      if (requestedAt <= cutoffMs) {
        await rm(path);
        removed += 1;
      }
    } catch {
      // Skip corrupt entries.
    }
  }
  return removed;
}

async function removeDirContents(dir: string): Promise<number> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return 0;
    throw new AICliError('cache', `Failed to list cache dir "${dir}".`, { cause: error });
  }
  let removed = 0;
  for (const file of files) {
    const path = join(dir, file);
    const info = await stat(path);
    if (info.isFile()) {
      await rm(path);
      removed += 1;
    }
  }
  return removed;
}

/* -- stats ----------------------------------------------------------------- */

export type CacheStats = {
  provider: string;
  entries: number;
  bytes: number;
  oldestRequestedAt?: string;
  newestRequestedAt?: string;
};

export async function statsForProvider(
  provider: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CacheStats> {
  const dir = getProviderResponseCacheDir(provider, env);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return { provider, entries: 0, bytes: 0 };
    throw new AICliError('cache', `Failed to list cache dir "${dir}".`, { cause: error });
  }
  let entries = 0;
  let bytes = 0;
  let oldest: string | undefined;
  let newest: string | undefined;
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const path = join(dir, file);
    const info = await stat(path);
    bytes += info.size;
    entries += 1;
    try {
      const raw = await readFile(path, 'utf8');
      const entry = JSON.parse(raw) as ResponseCacheEntry;
      if (entry.requestedAt) {
        if (!oldest || entry.requestedAt < oldest) oldest = entry.requestedAt;
        if (!newest || entry.requestedAt > newest) newest = entry.requestedAt;
      }
    } catch {
      // Skip corrupt.
    }
  }
  return {
    provider,
    entries,
    bytes,
    oldestRequestedAt: oldest,
    newestRequestedAt: newest,
  };
}

export async function statsAll(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CacheStats[]> {
  const root = getResponseCacheDir(env);
  let providers: string[];
  try {
    providers = await readdir(root);
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return [];
    throw new AICliError('cache', `Failed to list cache root "${root}".`, { cause: error });
  }
  const out: CacheStats[] = [];
  for (const slug of providers) {
    out.push(await statsForProvider(slug, env));
  }
  return out;
}
