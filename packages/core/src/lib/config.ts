import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  DATA_PROVIDER_API_KEY_ENV_VARS,
  DATA_PROVIDER_EXTRA_ENV_VARS,
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_EXTRA_ENV_VARS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
  PROVIDER_SPEECH_DEFAULT_MODELS,
  PROVIDER_TRANSCRIPTION_DEFAULT_MODELS,
  PROVIDER_VIDEO_DEFAULT_MODELS,
  WEB_PROVIDER_API_KEY_ENV_VARS,
  type DataProviderSlug,
  type DataVerb,
  type ProviderSlug,
  type WebProviderSlug,
  type WebVerb,
} from './constants.js';
import { AICliError } from './errors.js';
import { getMarmotConfigPath } from './paths.js';
import {
  DEFAULT_CACHE_TTL_DAYS,
  marmotConfigSchema,
  type AnyProviderSlug,
  type MarmotConfig,
  type ProviderSettings,
  type ResolvedDataVerbDefaults,
  type ResolvedModeDefaults,
  type ResolvedWebVerbDefaults,
} from '../schemas/config.js';


function ensurePresetIdsOnRead(payload: unknown): void {
  if (!payload || typeof payload !== 'object') return;
  const presets = (payload as { presets?: unknown }).presets;
  if (!presets || typeof presets !== 'object') return;
  for (const entry of Object.values(presets)) {
    if (!entry || typeof entry !== 'object') continue;
    const preset = entry as { preset_id?: unknown };
    if (typeof preset.preset_id !== 'string') {
      preset.preset_id = randomUUID();
    }
  }
}

export async function readMarmotConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MarmotConfig | null> {
  const path = getMarmotConfigPath(env);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;
    if (code === 'ENOENT') return null;
    throw new AICliError('cache', `Failed to read config file "${path}".`, {
      cause: error,
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new AICliError(
      'validation',
      `Config file "${path}" contains invalid JSON.`,
      { cause: error },
    );
  }

  // Lazy assign-on-read: presets created before 0.6.0 don't carry
  // preset_id. Inject a fresh UUID so schema validation passes; the new
  // id is persisted on the next write. Single-line "migration" — not a
  // sweep.
  ensurePresetIdsOnRead(payload);

  const parsed = marmotConfigSchema.safeParse(payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new AICliError(
      'validation',
      `Config file "${path}" did not match the expected schema (${detail}). Run "marmot config init --force" to overwrite, or "marmot setup" to walk through configuration.`,
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

export async function configFileExists(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  try {
    await access(getMarmotConfigPath(env));
    return true;
  } catch {
    return false;
  }
}

export async function writeMarmotConfig(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const path = getMarmotConfigPath(env);
  const validated = marmotConfigSchema.parse(config);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return path;
}

function requireConfiguredProvider(
  verb: string,
  override: string | undefined,
  configured: string | undefined,
): ProviderSlug {
  const provider = (override as ProviderSlug | undefined) ?? (configured as ProviderSlug | undefined);
  if (!provider) {
    throw new AICliError(
      'validation',
      `No default provider for "${verb}". Run "marmot setup" or "marmot config set ${verb}.provider <slug>".`,
    );
  }
  return provider;
}

export function resolveTextDefaults(
  config: MarmotConfig | null,
  override?: { provider?: string; model?: string },
): ResolvedModeDefaults {
  const configured = config?.defaults?.text;
  const provider = requireConfiguredProvider('text', override?.provider, configured?.provider);
  const model =
    override?.model
    ?? configured?.model
    ?? PROVIDER_DEFAULT_MODELS[provider];
  return { provider, model };
}

export function resolveImageDefaults(
  config: MarmotConfig | null,
  override?: { provider?: string; model?: string },
): ResolvedModeDefaults {
  const configured = config?.defaults?.image;
  const provider = requireConfiguredProvider('image', override?.provider, configured?.provider);
  const model =
    override?.model
    ?? configured?.model
    ?? PROVIDER_IMAGE_DEFAULT_MODELS[provider];
  return { provider, model };
}

export type ResolvedSpeechDefaults = ResolvedModeDefaults & {
  voice?: string;
};

export function resolveSpeechDefaults(
  config: MarmotConfig | null,
  override?: { provider?: string; model?: string; voice?: string },
): ResolvedSpeechDefaults {
  const configured = config?.defaults?.speech;
  const provider = requireConfiguredProvider('speech', override?.provider, configured?.provider);
  const model =
    override?.model
    ?? configured?.model
    ?? PROVIDER_SPEECH_DEFAULT_MODELS[provider];
  const voice = override?.voice ?? configured?.voice;
  return { provider, model, voice };
}

export function resolveTranscriptionDefaults(
  config: MarmotConfig | null,
  override?: { provider?: string; model?: string },
): ResolvedModeDefaults {
  const configured = config?.defaults?.transcription;
  const provider = requireConfiguredProvider('transcription', override?.provider, configured?.provider);
  const model =
    override?.model
    ?? configured?.model
    ?? PROVIDER_TRANSCRIPTION_DEFAULT_MODELS[provider];
  return { provider, model };
}

export function resolveVideoDefaults(
  config: MarmotConfig | null,
  override?: { provider?: string; model?: string },
): ResolvedModeDefaults {
  const configured = config?.defaults?.video;
  const provider = requireConfiguredProvider('video', override?.provider, configured?.provider);
  const model =
    override?.model
    ?? configured?.model
    ?? PROVIDER_VIDEO_DEFAULT_MODELS[provider];
  return { provider, model };
}

/**
 * Resolve the web provider for a given web verb. Resolution order:
 *   1. explicit override (--provider flag)
 *   2. config defaults.<verb>.provider
 *   3. throw — no hardcoded fallback (web providers all need API keys)
 *
 * Throws AICliError('validation', ...) with a clear actionable message
 * pointing the user at `marmot setup` or `marmot config set <verb>.provider`.
 */
export function resolveWebVerbDefaults(
  verb: WebVerb,
  config: MarmotConfig | null,
  override?: { provider?: string },
): ResolvedWebVerbDefaults {
  const configured = config?.defaults?.[verb];
  const provider =
    (override?.provider as WebProviderSlug | undefined) ??
    configured?.provider;
  if (!provider) {
    throw new AICliError(
      'validation',
      `No default provider for "${verb}". Run "marmot setup" or "marmot config set ${verb}.provider <slug>".`,
    );
  }
  return { provider };
}

/**
 * Resolve the data provider for a given data verb (enrich, lookup, verify).
 * Same resolution order as resolveWebVerbDefaults: flag, then config, then throw.
 */
export function resolveDataVerbDefaults(
  verb: DataVerb,
  config: MarmotConfig | null,
  override?: { provider?: string },
): ResolvedDataVerbDefaults {
  const configured = config?.defaults?.[verb];
  const provider =
    (override?.provider as DataProviderSlug | undefined) ??
    configured?.provider;
  if (!provider) {
    throw new AICliError(
      'validation',
      `No default provider for "${verb}". Run "marmot setup" or "marmot config set ${verb}.provider <slug>".`,
    );
  }
  return { provider };
}

/* -------------------------------------------------------------------------- */
/*  Per-provider settings resolvers (auth, enable/disable, response cache)    */
/* -------------------------------------------------------------------------- */

/**
 * Built-in env var name for a provider's primary credential, regardless of
 * category. Returns null for providers that don't need a key (Ollama).
 */
export function defaultPrimaryEnvVar(slug: AnyProviderSlug): string | null {
  if (slug in PROVIDER_API_KEY_ENV_VARS) {
    return PROVIDER_API_KEY_ENV_VARS[slug as ProviderSlug] ?? null;
  }
  if (slug in WEB_PROVIDER_API_KEY_ENV_VARS) {
    return WEB_PROVIDER_API_KEY_ENV_VARS[slug as WebProviderSlug];
  }
  if (slug in DATA_PROVIDER_API_KEY_ENV_VARS) {
    return DATA_PROVIDER_API_KEY_ENV_VARS[slug as DataProviderSlug];
  }
  return null;
}

/**
 * Built-in env var name for a provider's secondary credential, if one exists
 * (e.g. Tomba's TOMBA_SECRET_KEY, Cloudflare's CLOUDFLARE_ACCOUNT_ID). Returns
 * null when the provider has no secondary credential.
 */
export function defaultSecondaryEnvVar(slug: AnyProviderSlug): string | null {
  if (slug in PROVIDER_EXTRA_ENV_VARS) {
    const extras = PROVIDER_EXTRA_ENV_VARS[slug as ProviderSlug];
    return extras?.[0] ?? null;
  }
  if (slug in DATA_PROVIDER_EXTRA_ENV_VARS) {
    const extras = DATA_PROVIDER_EXTRA_ENV_VARS[slug as DataProviderSlug];
    return extras?.[0] ?? null;
  }
  return null;
}

function getProviderSettings(
  config: MarmotConfig | null,
  slug: AnyProviderSlug,
): ProviderSettings | undefined {
  return config?.providers?.[slug];
}

/**
 * Resolve the auth credentials for a provider. Resolution order for each
 * credential:
 *   1. explicit override (--api-key / --api-secret flag)
 *   2. custom env var name from config (providers.<slug>.apiKeyEnvVar)
 *   3. built-in env var name (e.g. APOLLO_API_KEY, TOMBA_SECRET_KEY)
 * Returns undefined for any credential that's still unresolved; callers
 * raise the auth error.
 */
export function resolveProviderAuth(
  slug: AnyProviderSlug,
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv = process.env,
  override?: { apiKey?: string; apiSecret?: string },
): { apiKey: string | undefined; apiSecret: string | undefined } {
  const settings = getProviderSettings(config, slug);

  const primaryEnvVar = settings?.apiKeyEnvVar ?? defaultPrimaryEnvVar(slug);
  const apiKey =
    override?.apiKey?.trim() ||
    (primaryEnvVar ? env[primaryEnvVar]?.trim() : undefined) ||
    undefined;

  const secondaryEnvVar = settings?.apiSecretEnvVar ?? defaultSecondaryEnvVar(slug);
  const apiSecret =
    override?.apiSecret?.trim() ||
    (secondaryEnvVar ? env[secondaryEnvVar]?.trim() : undefined) ||
    undefined;

  return { apiKey, apiSecret };
}

/**
 * Throw a clean error when a provider has been explicitly disabled in config.
 * No-op when settings are absent or `enabled` is unset (treated as enabled by
 * default to preserve backward compatibility).
 */
export function assertProviderEnabled(
  slug: AnyProviderSlug,
  config: MarmotConfig | null,
): void {
  const settings = getProviderSettings(config, slug);
  if (settings && settings.enabled === false) {
    throw new AICliError(
      'validation',
      `Provider "${slug}" is disabled. Re-enable via "marmot config set providers.${slug}.enabled true" or "marmot setup".`,
    );
  }
}

export type ResolvedCacheSettings = {
  enabled: boolean;
  ttlSeconds: number;
};

/**
 * Resolve cache settings for a provider. Caching is disabled by default;
 * the user must opt in via config or `marmot setup`. TTL defaults to 30 days.
 */
export function resolveProviderCache(
  slug: AnyProviderSlug,
  config: MarmotConfig | null,
): ResolvedCacheSettings {
  const settings = getProviderSettings(config, slug);
  const enabled = settings?.cache?.enabled ?? false;
  const ttlDays = settings?.cache?.ttlDays ?? DEFAULT_CACHE_TTL_DAYS;
  return { enabled, ttlSeconds: ttlDays * 24 * 60 * 60 };
}
