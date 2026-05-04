import {
  DEFAULT_OLLAMA_HOST,
  PROVIDER_API_KEY_ENV_VARS,
  type ProviderSlug,
} from './constants.js';
import { AICliError } from './errors.js';

export function getOpenRouterApiKey(
  cliKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return getProviderApiKey('openrouter', cliKey, env);
}

export function getAnthropicApiKey(
  cliKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return getProviderApiKey('anthropic', cliKey, env);
}

export function getOpenAIApiKey(
  cliKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return getProviderApiKey('openai', cliKey, env);
}

export function getProviderApiKey(
  provider: ProviderSlug,
  cliKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envVar = PROVIDER_API_KEY_ENV_VARS[provider];
  const fromEnv = envVar ? env[envVar]?.trim() : undefined;
  const candidate = cliKey?.trim() || fromEnv;
  return candidate || undefined;
}

export function getOllamaApiBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.OLLAMA_HOST?.trim() || DEFAULT_OLLAMA_HOST;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AICliError(
      'validation',
      `OLLAMA_HOST is not a valid URL (got "${raw}"). Expected something like http://localhost:11434.`,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AICliError(
      'validation',
      `OLLAMA_HOST must use http:// or https:// (got "${parsed.protocol}//" in "${raw}").`,
    );
  }
  const host = normalizeBaseUrl(raw);
  return host.endsWith('/api') ? host : `${host}/api`;
}

export function getCloudflareAccountId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.CLOUDFLARE_ACCOUNT_ID?.trim() || undefined;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
