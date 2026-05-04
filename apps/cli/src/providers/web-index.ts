import {
  AICliError,
  WEB_PROVIDERS,
  WEB_PROVIDER_API_KEY_ENV_VARS,
  type WebProviderAdapter,
  type WebProviderSlug,
  type WebVerb,
} from '@marmot-sh/core';

import { braveAdapter } from '@marmot-sh/brave';
import { exaAdapter } from '@marmot-sh/exa';
import { firecrawlAdapter } from '@marmot-sh/firecrawl';
import { parallelAdapter } from '@marmot-sh/parallel';
import { tavilyAdapter } from '@marmot-sh/tavily';

import { providersForVerb, verbSupportsProvider } from './web-capabilities.js';

const adapters: Record<WebProviderSlug, WebProviderAdapter> = {
  brave: braveAdapter,
  exa: exaAdapter,
  firecrawl: firecrawlAdapter,
  parallel: parallelAdapter,
  tavily: tavilyAdapter,
};

export function getWebProviderAdapter(slug: WebProviderSlug): WebProviderAdapter {
  return adapters[slug];
}

export function listWebProviderSlugs(): readonly WebProviderSlug[] {
  return WEB_PROVIDERS;
}

/**
 * Pre-flight check: validates that the chosen provider supports the verb.
 * Throws AICliError('validation', ...) with the list of valid providers.
 */
export function assertProviderSupportsVerb(
  verb: WebVerb,
  provider: WebProviderSlug,
): void {
  if (!verbSupportsProvider(verb, provider)) {
    const supported = providersForVerb(verb);
    throw new AICliError(
      'validation',
      `"${verb}" is not supported by "${provider}". Available: ${supported.join(', ')}.`,
    );
  }
}

/**
 * Resolve the API key for a web provider from CLI flag or env var. Returns
 * undefined when neither is set.
 */
export function getWebProviderApiKey(
  provider: WebProviderSlug,
  cliKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envVar = WEB_PROVIDER_API_KEY_ENV_VARS[provider];
  const fromEnv = env[envVar]?.trim();
  return cliKey?.trim() || fromEnv || undefined;
}
