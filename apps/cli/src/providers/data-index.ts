import {
  AICliError,
  DATA_PROVIDERS,
  DATA_PROVIDER_API_KEY_ENV_VARS,
  DATA_PROVIDER_EXTRA_ENV_VARS,
  type DataProviderAdapter,
  type DataProviderSlug,
  type DataType,
  type DataVerb,
} from '@marmot-sh/core';

import { apolloAdapter } from '@marmot-sh/apollo';
import { bouncerAdapter } from '@marmot-sh/bouncer';
import { datagmaAdapter } from '@marmot-sh/datagma';
import { hunterAdapter } from '@marmot-sh/hunter';
import { kickboxAdapter } from '@marmot-sh/kickbox';
import { pdlAdapter } from '@marmot-sh/pdl';
import { tombaAdapter } from '@marmot-sh/tomba';
import { zerobounceAdapter } from '@marmot-sh/zerobounce';

import { cellSupportsProvider, providersForCell } from './data-capabilities.js';

const adapters: Record<DataProviderSlug, DataProviderAdapter> = {
  apollo: apolloAdapter,
  hunter: hunterAdapter,
  pdl: pdlAdapter,
  tomba: tombaAdapter,
  bouncer: bouncerAdapter,
  datagma: datagmaAdapter,
  zerobounce: zerobounceAdapter,
  kickbox: kickboxAdapter,
};

export function getDataProviderAdapter(slug: DataProviderSlug): DataProviderAdapter {
  return adapters[slug];
}

export function listDataProviderSlugs(): readonly DataProviderSlug[] {
  return DATA_PROVIDERS;
}

/**
 * Pre-flight check: validates that the chosen provider supports the
 * (verb, type) cell. Throws AICliError('validation') with the list of valid
 * providers when the cell × provider combination is unsupported.
 */
export function assertProviderSupportsCell(
  verb: DataVerb,
  type: DataType,
  provider: DataProviderSlug,
): void {
  if (!cellSupportsProvider(verb, type, provider)) {
    const supported = providersForCell(verb, type);
    if (supported.length === 0) {
      throw new AICliError(
        'validation',
        `"${verb} --type ${type}" is not supported by any provider yet.`,
      );
    }
    throw new AICliError(
      'validation',
      `"${verb} --type ${type}" is not supported by "${provider}". Available: ${supported.join(', ')}.`,
    );
  }
}

/**
 * Resolve the API key for a data provider from CLI flag or env var. Returns
 * undefined when neither is set; callers throw a clean auth error.
 */
export function getDataProviderApiKey(
  provider: DataProviderSlug,
  cliKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envVar = DATA_PROVIDER_API_KEY_ENV_VARS[provider];
  const fromEnv = env[envVar]?.trim();
  return cliKey?.trim() || fromEnv || undefined;
}

/**
 * Resolve a provider's secondary credential (e.g. Tomba's TOMBA_SECRET_KEY).
 * Returns undefined when the provider has no extra credential or when the
 * env var isn't set. Adapters that need a second credential throw their own
 * auth error when this returns undefined.
 */
export function getDataProviderApiSecret(
  provider: DataProviderSlug,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const extraVars = DATA_PROVIDER_EXTRA_ENV_VARS[provider];
  if (!extraVars || extraVars.length === 0) return undefined;
  const fromEnv = env[extraVars[0]!]?.trim();
  return fromEnv || undefined;
}
