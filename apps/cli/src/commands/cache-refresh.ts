import {
  forceRefreshProviderCache,
  forceRefreshProviderImageCache,
  forceRefreshProviderSpeechCache,
  forceRefreshProviderTranscriptionCache,
} from '@marmot-sh/core';
import {
  getCloudflareAccountId,
  getOllamaApiBaseUrl,
  getProviderApiKey,
} from '@marmot-sh/core';
import { toAICliError } from '@marmot-sh/core';
import { PROVIDERS, type ProviderSlug } from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';
import {
  getProviderAdapter,
  type ProviderAdapter,
} from '../providers/index.js';
import { resolveCacheRefreshTarget } from '@marmot-sh/core';

type CacheRefreshDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  fetchFn?: typeof fetch;
  now?: () => Date;
  resolveProvider?: (provider: ProviderSlug) => ProviderAdapter;
};

export async function handleCacheRefreshCommand(
  targetArg?: string,
  dependencies: CacheRefreshDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const resolveProvider = dependencies.resolveProvider ?? getProviderAdapter;
  const target = resolveCacheRefreshTarget(targetArg);
  const providersToRefresh = target === 'all' ? [...PROVIDERS] : [target];
  const refreshed: Array<Record<string, unknown>> = [];
  const failed: Array<Record<string, unknown>> = [];

  for (const provider of providersToRefresh) {
    const adapter = resolveProvider(provider);
    const cacheInput = {
      provider,
      adapter,
      apiKey: getProviderApiKey(provider, undefined, env),
      ollamaBaseUrl:
        provider === 'ollama' ? getOllamaApiBaseUrl(env) : undefined,
      cloudflareAccountId:
        provider === 'cloudflare' ? getCloudflareAccountId(env) : undefined,
      fetchFn: dependencies.fetchFn,
      now: dependencies.now,
      env,
    };

    try {
      const result = await forceRefreshProviderCache(cacheInput);

      refreshed.push({
        provider,
        kind: 'text',
        modelCount: result.cache.models.length,
        defaultModel: result.cache.defaultModel,
        cachePath: result.cachePath,
        fetchedAt: result.cache.fetchedAt,
      });
    } catch (error) {
      const cliError = toAICliError(error, 'cache');

      failed.push({
        provider,
        kind: 'text',
        category: cliError.category,
        message: cliError.message,
      });
    }

    if (adapter.capabilities.image && adapter.refreshImageModels) {
      try {
        const result = await forceRefreshProviderImageCache(cacheInput);
        refreshed.push({
          provider,
          kind: 'image',
          modelCount: result.cache.models.length,
          defaultModel: result.cache.defaultModel,
          cachePath: result.cachePath,
          fetchedAt: result.cache.fetchedAt,
        });
      } catch (error) {
        const cliError = toAICliError(error, 'cache');
        failed.push({
          provider,
          kind: 'image',
          category: cliError.category,
          message: cliError.message,
        });
      }
    }

    if (adapter.capabilities.speech && adapter.refreshSpeechModels) {
      try {
        const result = await forceRefreshProviderSpeechCache(cacheInput);
        refreshed.push({
          provider,
          kind: 'speech',
          modelCount: result.cache.models.length,
          defaultModel: result.cache.defaultModel,
          cachePath: result.cachePath,
          fetchedAt: result.cache.fetchedAt,
        });
      } catch (error) {
        const cliError = toAICliError(error, 'cache');
        failed.push({
          provider,
          kind: 'speech',
          category: cliError.category,
          message: cliError.message,
        });
      }
    }

    if (adapter.capabilities.transcription && adapter.refreshTranscriptionModels) {
      try {
        const result = await forceRefreshProviderTranscriptionCache(cacheInput);
        refreshed.push({
          provider,
          kind: 'transcription',
          modelCount: result.cache.models.length,
          defaultModel: result.cache.defaultModel,
          cachePath: result.cachePath,
          fetchedAt: result.cache.fetchedAt,
        });
      } catch (error) {
        const cliError = toAICliError(error, 'cache');
        failed.push({
          provider,
          kind: 'transcription',
          category: cliError.category,
          message: cliError.message,
        });
      }
    }
  }

  writeLine(
    stdout,
    JSON.stringify(
      {
        ok: failed.length === 0,
        refreshed,
        failed,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}
