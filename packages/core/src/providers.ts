import {
  DATA_PROVIDER_API_KEY_ENV_VARS,
  DATA_PROVIDER_DISPLAY_NAMES,
  DATA_PROVIDER_EXTRA_ENV_VARS,
  DATA_PROVIDERS,
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDER_EXTRA_ENV_VARS,
  PROVIDERS,
  WEB_PROVIDER_API_KEY_ENV_VARS,
  WEB_PROVIDER_DISPLAY_NAMES,
  WEB_PROVIDERS,
  type ProviderSlug,
} from './lib/constants.js';
import {
  defaultPrimaryEnvVar,
  defaultSecondaryEnvVar,
  resolveProviderAuth,
} from './lib/config.js';
import type { AnyProviderSlug, MarmotConfig } from './schemas/config.js';
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
 * Snapshot of every supported provider — AI, web, and data — for
 * `marmot providers list` and similar discovery commands. Doesn't load
 * any provider package; just the metadata. Categories ride on the
 * `category` field so consumers can filter without re-importing slug
 * constants.
 */
export function listProviderSummaries(
  env: NodeJS.ProcessEnv = process.env,
): ProviderSummary[] {
  const aiRows: ProviderSummary[] = PROVIDERS.map((provider) => {
    const apiKeyEnvVar = PROVIDER_API_KEY_ENV_VARS[provider];
    const extraEnvVars = PROVIDER_EXTRA_ENV_VARS[provider];
    const envVars = [
      ...(apiKeyEnvVar ? [apiKeyEnvVar] : []),
      ...extraEnvVars,
    ];

    return {
      slug: provider,
      name: PROVIDER_DISPLAY_NAMES[provider],
      category: 'ai' as const,
      requiresApiKey: apiKeyEnvVar !== null,
      cachePath: getProviderCachePath(provider, env),
      env: envVars,
    };
  });

  const webRows: ProviderSummary[] = WEB_PROVIDERS.map((provider) => ({
    slug: provider,
    name: WEB_PROVIDER_DISPLAY_NAMES[provider],
    category: 'web' as const,
    requiresApiKey: true,
    env: [WEB_PROVIDER_API_KEY_ENV_VARS[provider]],
  }));

  const dataRows: ProviderSummary[] = DATA_PROVIDERS.map((provider) => {
    const apiKeyEnvVar = DATA_PROVIDER_API_KEY_ENV_VARS[provider];
    const extraEnvVars = DATA_PROVIDER_EXTRA_ENV_VARS[provider];
    return {
      slug: provider,
      name: DATA_PROVIDER_DISPLAY_NAMES[provider],
      category: 'data' as const,
      requiresApiKey: true,
      env: [apiKeyEnvVar, ...extraEnvVars],
    };
  });

  return [...aiRows, ...webRows, ...dataRows];
}

/* -------------------------------------------------------------------------- */
/*  Readiness                                                                 */
/* -------------------------------------------------------------------------- */

const ALL_PROVIDER_SLUGS: AnyProviderSlug[] = [
  ...PROVIDERS,
  ...WEB_PROVIDERS,
  ...DATA_PROVIDERS,
];

/**
 * Per-env-var presence breakdown for diagnostic mode (`--check-keys`).
 * Order matches the `env` array on the corresponding ProviderSummary —
 * primary first, secondary credentials after.
 */
export type ProviderEnvStatus = { env: string; set: boolean };

/**
 * Verbose readiness info layered on top of a ProviderSummary, returned
 * when `--check-keys` is passed to `marmot providers list`. `enabled`
 * reflects the explicit config toggle (defaulting to true). `keys` lists
 * each env var marmot would read with a set/unset boolean. `ready`
 * is the bottom-line signal: the provider is callable right now.
 */
export type ProviderReadiness = {
  enabled: boolean;
  keys: ProviderEnvStatus[];
  ready: boolean;
};

/**
 * Resolve the env var names marmot would read for a provider's primary
 * and (optional) secondary credentials, taking config-level
 * apiKeyEnvVar / apiSecretEnvVar overrides into account. Returns the
 * names only — values are not surfaced.
 */
function resolveProviderEnvVarNames(
  slug: AnyProviderSlug,
  config: MarmotConfig | null,
): { primary: string | null; secondary: string | null } {
  const settings = config?.providers?.[slug];
  return {
    primary: settings?.apiKeyEnvVar ?? defaultPrimaryEnvVar(slug),
    secondary: settings?.apiSecretEnvVar ?? defaultSecondaryEnvVar(slug),
  };
}

/**
 * Bottom-line readiness for a provider: would a verb call succeed
 * right now without an auth error?
 *
 * A provider is ready when:
 *   - it isn't explicitly disabled in config (`providers.<slug>.enabled !== false`)
 *   - if it requires a primary credential, the resolved env var is set
 *     to a non-empty value
 *   - if it requires a secondary credential (Tomba secret, Cloudflare
 *     account id), that env var is also set
 *
 * Ollama has no required credentials, so it's ready unless explicitly
 * disabled in config.
 */
export function isProviderReady(
  slug: AnyProviderSlug,
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (config?.providers?.[slug]?.enabled === false) return false;

  const { primary, secondary } = resolveProviderEnvVarNames(slug, config);

  // Providers without a primary credential (Ollama) need no creds at
  // all to be callable. Their "extras" are config knobs like OLLAMA_HOST
  // (optional URL override that defaults to localhost), not required
  // secondaries — so we don't gate readiness on them.
  if (primary === null) return true;

  const { apiKey, apiSecret } = resolveProviderAuth(slug, config, env);
  if (!apiKey) return false;
  if (secondary !== null && !apiSecret) return false;

  return true;
}

/**
 * Slugs of every provider that is callable right now. Sorted
 * alphabetically. Surfaced in `marmot config show --json` under
 * `readyProviders` so an agent can read installed version, configured
 * defaults, and what's actually live in a single command.
 */
export function getReadyProviders(
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return ALL_PROVIDER_SLUGS
    .filter((slug) => isProviderReady(slug, config, env))
    .sort();
}

/**
 * Per-provider readiness breakdown for the `--check-keys` diagnostic.
 * Returns one row per provider in the same order as
 * `listProviderSummaries`, each carrying enabled / per-env-var
 * set status / overall ready signal.
 */
export function listProviderReadiness(
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): Map<string, ProviderReadiness> {
  const result = new Map<string, ProviderReadiness>();
  for (const slug of ALL_PROVIDER_SLUGS) {
    const settings = config?.providers?.[slug];
    const enabled = settings?.enabled !== false;
    const { primary, secondary } = resolveProviderEnvVarNames(slug, config);

    // Ollama (and any future no-key provider) has no required env vars.
    // Report empty keys list; readiness reduces to the enabled flag.
    if (primary === null) {
      result.set(slug, { enabled, keys: [], ready: enabled });
      continue;
    }

    const keys: ProviderEnvStatus[] = [
      { env: primary, set: Boolean(env[primary]?.trim()) },
    ];
    if (secondary !== null) {
      keys.push({ env: secondary, set: Boolean(env[secondary]?.trim()) });
    }
    const ready = enabled && keys.every((k) => k.set);
    result.set(slug, { enabled, keys, ready });
  }
  return result;
}
