import {
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_EXTRA_ENV_VARS,
  type ProviderSlug,
  PROVIDERS,
} from '@marmot-sh/core';
import { getProviderCachePath } from '@marmot-sh/core';
import type {
  ProviderCapabilities,
  ProviderGenerateInput,
  ProviderGenerateResult,
  ProviderImageCacheFile,
  ProviderImageGenerateInput,
  ProviderImageGenerateResult,
  ProviderObjectGenerateInput,
  ProviderObjectGenerateResult,
  ProviderSpeechCacheFile,
  ProviderSpeechInput,
  ProviderSpeechResult,
  ProviderStreamResult,
  ProviderCacheFile,
  ProviderSummary,
  ProviderTranscribeInput,
  ProviderTranscribeResult,
  ProviderTranscriptionCacheFile,
  ProviderVideoCacheFile,
  ProviderVideoGenerateInput,
  ProviderVideoGenerateResult,
  RefreshModelsInput,
} from '@marmot-sh/core';
import { anthropicAdapter } from '@marmot-sh/anthropic';
import { cloudflareAdapter } from '@marmot-sh/cloudflare';
import { ollamaAdapter } from '@marmot-sh/ollama';
import { openAIAdapter } from '@marmot-sh/openai';
import { openRouterAdapter } from '@marmot-sh/openrouter';
import { vercelAdapter } from '@marmot-sh/vercel';

export type ProviderAdapter = {
  slug: ProviderSlug;
  name: string;
  defaultModel: string;
  defaultImageModel?: string;
  defaultSpeechModel?: string;
  defaultTranscriptionModel?: string;
  defaultVideoModel?: string;
  requiresApiKey: boolean;
  capabilities: ProviderCapabilities;
  generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult>;
  generateObject(input: ProviderObjectGenerateInput): Promise<ProviderObjectGenerateResult>;
  stream(input: ProviderGenerateInput): Promise<ProviderStreamResult>;
  refreshModels(input: RefreshModelsInput): Promise<ProviderCacheFile>;
  generateImage?(input: ProviderImageGenerateInput): Promise<ProviderImageGenerateResult>;
  refreshImageModels?(input: RefreshModelsInput): Promise<ProviderImageCacheFile>;
  generateSpeech?(input: ProviderSpeechInput): Promise<ProviderSpeechResult>;
  refreshSpeechModels?(input: RefreshModelsInput): Promise<ProviderSpeechCacheFile>;
  transcribe?(input: ProviderTranscribeInput): Promise<ProviderTranscribeResult>;
  refreshTranscriptionModels?(input: RefreshModelsInput): Promise<ProviderTranscriptionCacheFile>;
  generateVideo?(input: ProviderVideoGenerateInput): Promise<ProviderVideoGenerateResult>;
  refreshVideoModels?(input: RefreshModelsInput): Promise<ProviderVideoCacheFile>;
};

const providerAdapters: Record<ProviderSlug, ProviderAdapter> = {
  openrouter: openRouterAdapter,
  ollama: ollamaAdapter,
  anthropic: anthropicAdapter,
  openai: openAIAdapter,
  vercel: vercelAdapter,
  cloudflare: cloudflareAdapter,
};

export function getProviderAdapter(provider: ProviderSlug): ProviderAdapter {
  return providerAdapters[provider];
}

export function listProviderSummaries(
  env: NodeJS.ProcessEnv = process.env,
): ProviderSummary[] {
  return PROVIDERS.map((provider) => {
    const apiKeyEnvVar = PROVIDER_API_KEY_ENV_VARS[provider];
    const extraEnvVars = PROVIDER_EXTRA_ENV_VARS[provider];
    const envVars = [
      ...(apiKeyEnvVar ? [apiKeyEnvVar] : []),
      ...extraEnvVars,
    ];

    return {
      slug: provider,
      name: PROVIDER_DISPLAY_NAMES[provider],
      defaultModel: PROVIDER_DEFAULT_MODELS[provider],
      requiresApiKey: apiKeyEnvVar !== null,
      cachePath: getProviderCachePath(provider, env),
      env: envVars,
    };
  });
}
