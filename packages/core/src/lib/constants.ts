export const PROVIDERS = [
  'openrouter',
  'ollama',
  'anthropic',
  'openai',
  'vercel',
  'cloudflare',
] as const;

export type ProviderSlug = (typeof PROVIDERS)[number];

export const DEFAULT_PROVIDER: ProviderSlug = 'openrouter';

export const PROVIDER_DEFAULT_MODELS: Record<ProviderSlug, string> = {
  openrouter: 'openai/gpt-oss-120b',
  ollama: 'qwen3:4b',
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  vercel: 'anthropic/claude-sonnet-4.6',
  cloudflare: '@cf/meta/llama-3.1-8b-instruct',
};

export const PROVIDER_DISPLAY_NAMES: Record<ProviderSlug, string> = {
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  vercel: 'Vercel AI Gateway',
  cloudflare: 'Cloudflare Workers AI',
};

/**
 * Approximate context windows (input + output tokens) for the most common
 * text models, used by `session show` and compaction thresholding. Returns
 * null for unknown models — callers should treat that as "can't tell".
 *
 * Keys are matched as substrings against the model id (lowercased), so
 * "claude-opus-4-7" matches "claude-opus".
 */
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // Anthropic
  'claude-opus': 200_000,
  'claude-sonnet': 200_000,
  'claude-haiku': 200_000,
  // OpenAI
  'gpt-5': 400_000,
  'gpt-4o': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_192,
  'o1': 200_000,
  'o3': 200_000,
  // OpenRouter (these are mostly aliases)
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
  'gemini-2': 1_000_000,
  'llama-3.1-405b': 128_000,
  'llama-3.1-70b': 128_000,
  'llama-3.1-8b': 128_000,
  'llama-3.3': 128_000,
  // Defaults for smaller/local
  'qwen': 32_768,
  'mistral': 32_768,
};

export function lookupContextWindow(model: string): number | null {
  const lower = model.toLowerCase();
  for (const [key, max] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (lower.includes(key)) return max;
  }
  return null;
}

/**
 * Cheap approximation: tokens ≈ chars / 4. Good enough for window-usage
 * warnings; not for billing. Real tokenizers vary by model and aren't worth
 * the extra dep here.
 */
export function approximateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export const PROVIDER_API_KEY_ENV_VARS: Record<ProviderSlug, string | null> = {
  openrouter: 'OPENROUTER_API_KEY',
  ollama: null,
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  vercel: 'AI_GATEWAY_API_KEY',
  cloudflare: 'CLOUDFLARE_API_TOKEN',
};

// Providers that need additional env vars beyond the API key.
// listProviderSummaries surfaces all of these in `ai providers list`.
export const PROVIDER_EXTRA_ENV_VARS: Record<ProviderSlug, string[]> = {
  openrouter: [],
  ollama: ['OLLAMA_HOST'],
  anthropic: [],
  openai: [],
  vercel: [],
  cloudflare: ['CLOUDFLARE_ACCOUNT_ID'],
};

export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_MODELS_URL = `${OPENROUTER_BASE_URL}/models`;
export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_MODELS_URL = `${ANTHROPIC_BASE_URL}/models`;
export const ANTHROPIC_API_VERSION = '2023-06-01';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_MODELS_URL = `${OPENAI_BASE_URL}/models`;
export const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
export const PROVIDER_CACHE_DIRNAME = 'cache/models/text';
export const PROVIDER_IMAGE_CACHE_DIRNAME = 'cache/models/images';
export const PROVIDER_SPEECH_CACHE_DIRNAME = 'cache/models/speech';
export const PROVIDER_TRANSCRIPTION_CACHE_DIRNAME = 'cache/models/transcription';
export const PROVIDER_VIDEO_CACHE_DIRNAME = 'cache/models/video';
export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

// -- Web / data search providers ----------------------------------------------
// Distinct slug space from PROVIDERS (AI). Web verbs (search, scrape, research,
// answer, crawl, map, findall) dispatch off WEB_PROVIDERS.

export const WEB_PROVIDERS = [
  'brave',
  'exa',
  'firecrawl',
  'parallel',
  'tavily',
] as const;

export type WebProviderSlug = (typeof WEB_PROVIDERS)[number];

export const WEB_PROVIDER_DISPLAY_NAMES: Record<WebProviderSlug, string> = {
  brave: 'Brave Search',
  exa: 'Exa',
  firecrawl: 'Firecrawl',
  parallel: 'Parallel',
  tavily: 'Tavily',
};

export const WEB_PROVIDER_API_KEY_ENV_VARS: Record<WebProviderSlug, string> = {
  brave: 'BRAVE_API_KEY',
  exa: 'EXA_API_KEY',
  firecrawl: 'FIRECRAWL_API_KEY',
  parallel: 'PARALLEL_API_KEY',
  tavily: 'TAVILY_API_KEY',
};

export const WEB_PROVIDER_BASE_URLS: Record<WebProviderSlug, string> = {
  brave: 'https://api.search.brave.com/res/v1',
  exa: 'https://api.exa.ai',
  firecrawl: 'https://api.firecrawl.dev',
  parallel: 'https://api.parallel.ai',
  tavily: 'https://api.tavily.com',
};

export const WEB_VERBS = [
  'search',
  'scrape',
  'research',
  'answer',
  'crawl',
  'map',
  'findall',
] as const;

export type WebVerb = (typeof WEB_VERBS)[number];

// -- Data providers (people / company / email graph) --------------------------
// Distinct slug space from PROVIDERS (AI) and WEB_PROVIDERS (web retrieval).
// Data verbs (enrich, lookup, verify) dispatch off DATA_PROVIDERS.

export const DATA_PROVIDERS = [
  'apollo',
  'hunter',
  'pdl',
  'tomba',
  'bouncer',
  'datagma',
  'zerobounce',
  'kickbox',
] as const;

export type DataProviderSlug = (typeof DATA_PROVIDERS)[number];

export const DATA_PROVIDER_DISPLAY_NAMES: Record<DataProviderSlug, string> = {
  apollo: 'Apollo',
  hunter: 'Hunter',
  pdl: 'People Data Labs',
  tomba: 'Tomba',
  bouncer: 'Bouncer',
  datagma: 'Datagma',
  zerobounce: 'ZeroBounce',
  kickbox: 'Kickbox',
};

export const DATA_PROVIDER_API_KEY_ENV_VARS: Record<DataProviderSlug, string> = {
  apollo: 'APOLLO_API_KEY',
  hunter: 'HUNTER_API_KEY',
  pdl: 'PDL_API_KEY',
  tomba: 'TOMBA_API_KEY',
  bouncer: 'BOUNCER_API_KEY',
  datagma: 'DATAGMA_API_KEY',
  zerobounce: 'ZEROBOUNCE_API_KEY',
  kickbox: 'KICKBOX_API_KEY',
};

// Some data providers need additional env vars beyond the API key. Tomba uses
// a dual-header auth scheme (X-Tomba-Key + X-Tomba-Secret); the secret lives
// here. Other providers have an empty list.
export const DATA_PROVIDER_EXTRA_ENV_VARS: Record<DataProviderSlug, string[]> = {
  apollo: [],
  hunter: [],
  pdl: [],
  tomba: ['TOMBA_SECRET_KEY'],
  bouncer: [],
  datagma: [],
  zerobounce: [],
  kickbox: [],
};

export const DATA_PROVIDER_BASE_URLS: Record<DataProviderSlug, string> = {
  apollo: 'https://api.apollo.io/api/v1',
  hunter: 'https://api.hunter.io/v2',
  pdl: 'https://api.peopledatalabs.com/v5',
  tomba: 'https://api.tomba.io/v1',
  bouncer: 'https://api.usebouncer.com/v1.1',
  datagma: 'https://gateway.datagma.net/api/ingress/v8',
  zerobounce: 'https://api.zerobounce.net/v2',
  kickbox: 'https://api.kickbox.com/v2',
};

export const DATA_VERBS = ['enrich', 'lookup', 'verify'] as const;

export type DataVerb = (typeof DATA_VERBS)[number];

export const DATA_TYPES = ['person', 'org', 'email'] as const;

export type DataType = (typeof DATA_TYPES)[number];

/**
 * Default image model per provider. Only providers with image generation
 * support appear here.
 */
export const PROVIDER_IMAGE_DEFAULT_MODELS: Partial<Record<ProviderSlug, string>> = {
  openai: 'gpt-image-1',
  vercel: 'openai/dall-e-3',
  cloudflare: '@cf/black-forest-labs/flux-1-schnell',
  openrouter: 'google/gemini-2.5-flash-image',
};

/**
 * Default speech (TTS) model per provider. Only providers with speech support
 * appear here.
 */
export const PROVIDER_SPEECH_DEFAULT_MODELS: Partial<Record<ProviderSlug, string>> = {
  openai: 'tts-1',
  cloudflare: '@cf/myshell-ai/melotts',
  vercel: 'openai/tts-1',
  openrouter: 'openai/gpt-4o-mini-tts-2025-12-15',
};

/**
 * Default transcription (STT) model per provider. Only providers with
 * transcription support appear here.
 */
export const PROVIDER_TRANSCRIPTION_DEFAULT_MODELS: Partial<Record<ProviderSlug, string>> = {
  openai: 'whisper-1',
  cloudflare: '@cf/openai/whisper-large-v3-turbo',
  vercel: 'openai/whisper-1',
  openrouter: 'openai/gpt-4o-transcribe',
};

/**
 * Default video model per provider. Video generation is async and pricey
 * (~pennies-to-dollars per second). Defaults pick the cheapest reasonable
 * tier so casual usage stays affordable; users can override via --model.
 */
export const PROVIDER_VIDEO_DEFAULT_MODELS: Partial<Record<ProviderSlug, string>> = {
  openrouter: 'google/veo-3.1-lite',
  vercel: 'google/veo-3.1-lite',
};
