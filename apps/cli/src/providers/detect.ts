import {
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DISPLAY_NAMES,
  PROVIDERS,
  type ProviderSlug,
} from '@marmot-sh/core';
import { getOllamaApiBaseUrl } from '@marmot-sh/core';
import { anthropicAdapter } from '@marmot-sh/anthropic';
import { cloudflareAdapter } from '@marmot-sh/cloudflare';
import { ollamaAdapter } from '@marmot-sh/ollama';
import { openAIAdapter } from '@marmot-sh/openai';
import { openRouterAdapter } from '@marmot-sh/openrouter';
import { vercelAdapter } from '@marmot-sh/vercel';
import type { ProviderCapabilities } from '@marmot-sh/core';

export type ProviderStatus = {
  slug: ProviderSlug;
  name: string;
  ready: boolean;
  reason?: string;
  capabilities: ProviderCapabilities;
};

const ADAPTERS_BY_SLUG = {
  openrouter: openRouterAdapter,
  ollama: ollamaAdapter,
  anthropic: anthropicAdapter,
  openai: openAIAdapter,
  vercel: vercelAdapter,
  cloudflare: cloudflareAdapter,
} as const;

async function pingOllama(
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const base = getOllamaApiBaseUrl(env).replace(/\/api$/, '');
  const url = `${base}/api/version`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function detectProviders(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
  ollamaTimeoutMs = 1000,
): Promise<ProviderStatus[]> {
  const results: ProviderStatus[] = [];

  for (const slug of PROVIDERS) {
    const adapter = ADAPTERS_BY_SLUG[slug];
    const name = PROVIDER_DISPLAY_NAMES[slug];
    const capabilities = adapter.capabilities;

    if (slug === 'ollama') {
      const reachable = await pingOllama(env, fetchFn, ollamaTimeoutMs);
      results.push({
        slug,
        name,
        ready: reachable,
        reason: reachable ? undefined : `not running on ${getOllamaApiBaseUrl(env).replace(/\/api$/, '')}`,
        capabilities,
      });
      continue;
    }

    if (slug === 'cloudflare') {
      const tokenSet = Boolean(env.CLOUDFLARE_API_TOKEN?.trim());
      const accountSet = Boolean(env.CLOUDFLARE_ACCOUNT_ID?.trim());
      const ready = tokenSet && accountSet;
      const missing = [
        !tokenSet ? 'CLOUDFLARE_API_TOKEN' : null,
        !accountSet ? 'CLOUDFLARE_ACCOUNT_ID' : null,
      ].filter(Boolean) as string[];
      results.push({
        slug,
        name,
        ready,
        reason: ready ? undefined : `missing ${missing.join(' + ')}`,
        capabilities,
      });
      continue;
    }

    const envVar = PROVIDER_API_KEY_ENV_VARS[slug];
    const keySet = envVar ? Boolean(env[envVar]?.trim()) : false;
    results.push({
      slug,
      name,
      ready: keySet,
      reason: keySet ? undefined : envVar ? `missing ${envVar}` : undefined,
      capabilities,
    });
  }

  return results;
}

export function filterReady(statuses: ProviderStatus[]): ProviderStatus[] {
  return statuses.filter((s) => s.ready);
}

export function filterImageReady(statuses: ProviderStatus[]): ProviderStatus[] {
  return statuses.filter((s) => s.ready && s.capabilities.image);
}

export function filterSpeechReady(statuses: ProviderStatus[]): ProviderStatus[] {
  return statuses.filter((s) => s.ready && s.capabilities.speech);
}

export function filterTranscriptionReady(
  statuses: ProviderStatus[],
): ProviderStatus[] {
  return statuses.filter((s) => s.ready && s.capabilities.transcription);
}

export function filterVideoReady(statuses: ProviderStatus[]): ProviderStatus[] {
  return statuses.filter((s) => s.ready && s.capabilities.video === true);
}
