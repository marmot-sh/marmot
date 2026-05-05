import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CACHE_MAX_AGE_MS, type ProviderSlug } from '../lib/constants.js';
import { AICliError, toAICliError } from '../lib/errors.js';
import {
  getProviderCachePath,
  getProviderImageCachePath,
  getProviderSpeechCachePath,
  getProviderTranscriptionCachePath,
  getProviderVideoCachePath,
} from '../lib/paths.js';
import { providerCacheSchema } from '../schemas/cache.js';
import type {
  ProviderCacheFile,
  ProviderImageCacheFile,
  ProviderSpeechCacheFile,
  ProviderTranscriptionCacheFile,
  ProviderVideoCacheFile,
  RefreshModelsInput,
} from '../types.js';
import type { ProviderAdapter } from '../providers.js';

export type CacheRefreshContext = {
  provider: ProviderSlug;
  reason: 'missing' | 'stale';
};

export type EnsureProviderCacheInput = RefreshModelsInput & {
  provider: ProviderSlug;
  adapter: ProviderAdapter;
  env?: NodeJS.ProcessEnv;
  /**
   * Optional wrapper around the actual refresh call. Lets the caller render
   * a spinner / status message while the network request runs. The cache
   * store itself stays UI-free.
   */
  wrapRefresh?: <T>(
    context: CacheRefreshContext,
    fn: () => Promise<T>,
  ) => Promise<T>;
};

export type EnsureProviderCacheResult = {
  cache: ProviderCacheFile;
  cachePath: string;
  refreshed: boolean;
  usedStaleCache: boolean;
  refreshReason?: CacheRefreshContext['reason'];
};

export async function readProviderCache(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderCacheFile | null> {
  const cachePath = getProviderCachePath(provider, env);

  try {
    const contents = await readFile(cachePath, 'utf8');
    const payload = JSON.parse(contents) as unknown;
    const parsed = providerCacheSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AICliError(
        'cache',
        `Cache file "${cachePath}" is invalid.`,
        { cause: parsed.error },
      );
    }

    return parsed.data;
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;

    if (errorCode === 'ENOENT') {
      return null;
    }

    if (error instanceof SyntaxError) {
      throw new AICliError(
        'cache',
        `Cache file "${cachePath}" contains invalid JSON.`,
        { cause: error },
      );
    }

    throw toAICliError(
      error,
      'cache',
      `Failed to read cache file "${cachePath}".`,
    );
  }
}

export async function writeProviderCache(
  cache: ProviderCacheFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cachePath = getProviderCachePath(cache.provider, env);
  const validated = providerCacheSchema.parse(cache);

  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return cachePath;
}

export function isProviderCacheFresh(
  cache: ProviderCacheFile,
  now: Date = new Date(),
): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  return now.getTime() - fetchedAt < CACHE_MAX_AGE_MS;
}

export async function ensureProviderCache(
  input: EnsureProviderCacheInput,
): Promise<EnsureProviderCacheResult> {
  const env = input.env ?? process.env;
  const cachePath = getProviderCachePath(input.provider, env);
  let existingCache: ProviderCacheFile | null = null;
  let readError: AICliError | null = null;

  try {
    existingCache = await readProviderCache(input.provider, env);
  } catch (error) {
    readError = toAICliError(
      error,
      'cache',
      `Failed to read the ${input.provider} cache.`,
    );
  }

  const now = input.now?.() ?? new Date();

  if (existingCache && isProviderCacheFresh(existingCache, now)) {
    return {
      cache: existingCache,
      cachePath,
      refreshed: false,
      usedStaleCache: false,
    };
  }

  const reason: CacheRefreshContext['reason'] = existingCache ? 'stale' : 'missing';
  const doRefresh = () => input.adapter.refreshModels(input);
  const wrapped = input.wrapRefresh
    ? () => input.wrapRefresh!({ provider: input.provider, reason }, doRefresh)
    : doRefresh;

  try {
    const refreshedCache = await wrapped();
    const writtenCachePath = await writeProviderCache(refreshedCache, env);

    return {
      cache: refreshedCache,
      cachePath: writtenCachePath,
      refreshed: true,
      usedStaleCache: false,
      refreshReason: reason,
    };
  } catch (error) {
    if (existingCache) {
      return {
        cache: existingCache,
        cachePath,
        refreshed: false,
        usedStaleCache: true,
        refreshReason: reason,
      };
    }

    if (readError) {
      throw readError;
    }

    throw toAICliError(
      error,
      'cache',
      `Failed to refresh the ${input.provider} model cache.`,
    );
  }
}

export async function forceRefreshProviderCache(
  input: EnsureProviderCacheInput,
): Promise<EnsureProviderCacheResult> {
  const env = input.env ?? process.env;
  const refreshedCache = await input.adapter.refreshModels(input);
  const cachePath = await writeProviderCache(refreshedCache, env);

  return {
    cache: refreshedCache,
    cachePath,
    refreshed: true,
    usedStaleCache: false,
  };
}

export type ForceRefreshImageCacheResult = {
  cache: ProviderImageCacheFile;
  cachePath: string;
};

export async function readProviderImageCache(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderImageCacheFile | null> {
  return readJsonCache<ProviderImageCacheFile>(
    getProviderImageCachePath(provider, env),
  );
}

export async function readProviderSpeechCache(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderSpeechCacheFile | null> {
  return readJsonCache<ProviderSpeechCacheFile>(
    getProviderSpeechCachePath(provider, env),
  );
}

export async function readProviderTranscriptionCache(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderTranscriptionCacheFile | null> {
  return readJsonCache<ProviderTranscriptionCacheFile>(
    getProviderTranscriptionCachePath(provider, env),
  );
}

export async function readProviderVideoCache(
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderVideoCacheFile | null> {
  return readJsonCache<ProviderVideoCacheFile>(
    getProviderVideoCachePath(provider, env),
  );
}

async function readJsonCache<T>(cachePath: string): Promise<T | null> {
  try {
    const contents = await readFile(cachePath, 'utf8');
    return JSON.parse(contents) as T;
  } catch (error) {
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : undefined;
    if (errorCode === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new AICliError(
        'cache',
        `Cache file "${cachePath}" contains invalid JSON.`,
        { cause: error },
      );
    }
    throw toAICliError(error, 'cache', `Failed to read cache file "${cachePath}".`);
  }
}

export async function writeProviderImageCache(
  cache: ProviderImageCacheFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cachePath = getProviderImageCachePath(cache.provider, env);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return cachePath;
}

export async function forceRefreshProviderImageCache(
  input: EnsureProviderCacheInput,
): Promise<ForceRefreshImageCacheResult> {
  const env = input.env ?? process.env;
  if (!input.adapter.refreshImageModels) {
    throw new AICliError(
      'cache',
      `${input.adapter.name} does not support image-model refresh.`,
    );
  }
  const refreshedCache = await input.adapter.refreshImageModels(input);
  const cachePath = await writeProviderImageCache(refreshedCache, env);
  return { cache: refreshedCache, cachePath };
}

export type EnsureImageCacheResult = {
  cache: ProviderImageCacheFile;
  cachePath: string;
  refreshed: boolean;
  usedStaleCache: boolean;
  refreshReason?: CacheRefreshContext['reason'];
};

export async function ensureProviderImageCache(
  input: EnsureProviderCacheInput,
): Promise<EnsureImageCacheResult> {
  return ensureModalityCache({
    input,
    cachePath: getProviderImageCachePath(input.provider, input.env ?? process.env),
    read: () => readProviderImageCache(input.provider, input.env ?? process.env),
    refresh: () => {
      if (!input.adapter.refreshImageModels) {
        throw new AICliError(
          'cache',
          `${input.adapter.name} does not support image-model refresh.`,
        );
      }
      return input.adapter.refreshImageModels(input);
    },
    write: (cache) => writeProviderImageCache(cache, input.env ?? process.env),
    modality: 'image',
  });
}

export type ForceRefreshSpeechCacheResult = {
  cache: ProviderSpeechCacheFile;
  cachePath: string;
};

export async function writeProviderSpeechCache(
  cache: ProviderSpeechCacheFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cachePath = getProviderSpeechCachePath(cache.provider, env);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return cachePath;
}

export async function forceRefreshProviderSpeechCache(
  input: EnsureProviderCacheInput,
): Promise<ForceRefreshSpeechCacheResult> {
  const env = input.env ?? process.env;
  if (!input.adapter.refreshSpeechModels) {
    throw new AICliError(
      'cache',
      `${input.adapter.name} does not support speech-model refresh.`,
    );
  }
  const refreshedCache = await input.adapter.refreshSpeechModels(input);
  const cachePath = await writeProviderSpeechCache(refreshedCache, env);
  return { cache: refreshedCache, cachePath };
}

export type EnsureSpeechCacheResult = {
  cache: ProviderSpeechCacheFile;
  cachePath: string;
  refreshed: boolean;
  usedStaleCache: boolean;
  refreshReason?: CacheRefreshContext['reason'];
};

export async function ensureProviderSpeechCache(
  input: EnsureProviderCacheInput,
): Promise<EnsureSpeechCacheResult> {
  return ensureModalityCache({
    input,
    cachePath: getProviderSpeechCachePath(input.provider, input.env ?? process.env),
    read: () => readProviderSpeechCache(input.provider, input.env ?? process.env),
    refresh: () => {
      if (!input.adapter.refreshSpeechModels) {
        throw new AICliError(
          'cache',
          `${input.adapter.name} does not support speech-model refresh.`,
        );
      }
      return input.adapter.refreshSpeechModels(input);
    },
    write: (cache) => writeProviderSpeechCache(cache, input.env ?? process.env),
    modality: 'speech',
  });
}

export type ForceRefreshTranscriptionCacheResult = {
  cache: ProviderTranscriptionCacheFile;
  cachePath: string;
};

export async function writeProviderTranscriptionCache(
  cache: ProviderTranscriptionCacheFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cachePath = getProviderTranscriptionCachePath(cache.provider, env);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return cachePath;
}

export async function forceRefreshProviderTranscriptionCache(
  input: EnsureProviderCacheInput,
): Promise<ForceRefreshTranscriptionCacheResult> {
  const env = input.env ?? process.env;
  if (!input.adapter.refreshTranscriptionModels) {
    throw new AICliError(
      'cache',
      `${input.adapter.name} does not support transcription-model refresh.`,
    );
  }
  const refreshedCache = await input.adapter.refreshTranscriptionModels(input);
  const cachePath = await writeProviderTranscriptionCache(refreshedCache, env);
  return { cache: refreshedCache, cachePath };
}

export type EnsureTranscriptionCacheResult = {
  cache: ProviderTranscriptionCacheFile;
  cachePath: string;
  refreshed: boolean;
  usedStaleCache: boolean;
  refreshReason?: CacheRefreshContext['reason'];
};

export async function ensureProviderTranscriptionCache(
  input: EnsureProviderCacheInput,
): Promise<EnsureTranscriptionCacheResult> {
  return ensureModalityCache({
    input,
    cachePath: getProviderTranscriptionCachePath(input.provider, input.env ?? process.env),
    read: () => readProviderTranscriptionCache(input.provider, input.env ?? process.env),
    refresh: () => {
      if (!input.adapter.refreshTranscriptionModels) {
        throw new AICliError(
          'cache',
          `${input.adapter.name} does not support transcription-model refresh.`,
        );
      }
      return input.adapter.refreshTranscriptionModels(input);
    },
    write: (cache) => writeProviderTranscriptionCache(cache, input.env ?? process.env),
    modality: 'transcription',
  });
}

export type ForceRefreshVideoCacheResult = {
  cache: ProviderVideoCacheFile;
  cachePath: string;
};

export async function writeProviderVideoCache(
  cache: ProviderVideoCacheFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cachePath = getProviderVideoCachePath(cache.provider, env);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  return cachePath;
}

export async function forceRefreshProviderVideoCache(
  input: EnsureProviderCacheInput,
): Promise<ForceRefreshVideoCacheResult> {
  const env = input.env ?? process.env;
  if (!input.adapter.refreshVideoModels) {
    throw new AICliError(
      'cache',
      `${input.adapter.name} does not support video-model refresh.`,
    );
  }
  const refreshedCache = await input.adapter.refreshVideoModels(input);
  const cachePath = await writeProviderVideoCache(refreshedCache, env);
  return { cache: refreshedCache, cachePath };
}

export type EnsureVideoCacheResult = {
  cache: ProviderVideoCacheFile;
  cachePath: string;
  refreshed: boolean;
  usedStaleCache: boolean;
  refreshReason?: CacheRefreshContext['reason'];
};

export async function ensureProviderVideoCache(
  input: EnsureProviderCacheInput,
): Promise<EnsureVideoCacheResult> {
  return ensureModalityCache({
    input,
    cachePath: getProviderVideoCachePath(input.provider, input.env ?? process.env),
    read: () => readProviderVideoCache(input.provider, input.env ?? process.env),
    refresh: () => {
      if (!input.adapter.refreshVideoModels) {
        throw new AICliError(
          'cache',
          `${input.adapter.name} does not support video-model refresh.`,
        );
      }
      return input.adapter.refreshVideoModels(input);
    },
    write: (cache) => writeProviderVideoCache(cache, input.env ?? process.env),
    modality: 'video',
  });
}

/* -------------------------------------------------------------------------- */
/*  shared modality-cache machinery                                           */
/* -------------------------------------------------------------------------- */

type ModalityCacheFile = ProviderImageCacheFile | ProviderSpeechCacheFile | ProviderTranscriptionCacheFile | ProviderVideoCacheFile;

type EnsureModalityCacheArgs<T extends ModalityCacheFile> = {
  input: EnsureProviderCacheInput;
  cachePath: string;
  read: () => Promise<T | null>;
  refresh: () => Promise<T>;
  write: (cache: T) => Promise<string>;
  modality: 'image' | 'speech' | 'transcription' | 'video';
};

/** Image/speech/transcription analog of `ensureProviderCache`. Same
 *  semantics: 24h TTL, stale-cache fallback when a refresh fails.
 *  Modality-specific I/O is plumbed through callbacks so each public
 *  ensure-function stays a thin wrapper. */
async function ensureModalityCache<T extends ModalityCacheFile>(
  args: EnsureModalityCacheArgs<T>,
): Promise<{
  cache: T;
  cachePath: string;
  refreshed: boolean;
  usedStaleCache: boolean;
  refreshReason?: CacheRefreshContext['reason'];
}> {
  const { input, cachePath, read, refresh, write, modality } = args;
  let existingCache: T | null = null;
  let readError: AICliError | null = null;

  try {
    existingCache = await read();
  } catch (error) {
    readError = toAICliError(
      error,
      'cache',
      `Failed to read the ${input.provider} ${modality} cache.`,
    );
  }

  const now = input.now?.() ?? new Date();

  if (existingCache && isModalityCacheFresh(existingCache, now)) {
    return {
      cache: existingCache,
      cachePath,
      refreshed: false,
      usedStaleCache: false,
    };
  }

  const reason: CacheRefreshContext['reason'] = existingCache ? 'stale' : 'missing';
  const doRefresh = refresh;
  const wrapped = input.wrapRefresh
    ? () => input.wrapRefresh!({ provider: input.provider, reason }, doRefresh)
    : doRefresh;

  try {
    const refreshedCache = await wrapped();
    const writtenCachePath = await write(refreshedCache);
    return {
      cache: refreshedCache,
      cachePath: writtenCachePath,
      refreshed: true,
      usedStaleCache: false,
      refreshReason: reason,
    };
  } catch (error) {
    if (existingCache) {
      return {
        cache: existingCache,
        cachePath,
        refreshed: false,
        usedStaleCache: true,
        refreshReason: reason,
      };
    }
    if (readError) throw readError;
    throw toAICliError(
      error,
      'cache',
      `Failed to refresh the ${input.provider} ${modality}-model cache.`,
    );
  }
}

function isModalityCacheFresh(cache: ModalityCacheFile, now: Date): boolean {
  const fetchedAt = new Date(cache.fetchedAt).getTime();
  return now.getTime() - fetchedAt < CACHE_MAX_AGE_MS;
}
