import {
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_EXTRA_ENV_VARS,
  PROVIDERS,
  type ProviderSlug,
} from './lib/constants.js';
import { getProviderCachePath } from './lib/paths.js';
import type {
  ProviderCacheFile,
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
  ProviderSummary,
  ProviderTranscribeInput,
  ProviderTranscribeResult,
  ProviderTranscriptionCacheFile,
  ProviderVideoCacheFile,
  ProviderVideoGenerateInput,
  ProviderVideoGenerateResult,
  RefreshModelsInput,
} from './types.js';

/**
 * The contract every provider package implements. Concrete adapters live
 * in their own packages (`@marmot-sh/openai`, `@marmot-sh/anthropic`, …).
 * apps/cli wires them into the runtime registry.
 */
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

/**
 * Snapshot of every supported provider for `marmot providers list` and
 * similar commands. Doesn't load any provider package — just the metadata.
 */
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
