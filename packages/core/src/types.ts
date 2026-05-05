import type { FlexibleSchema } from 'ai';
import type {
  DataProviderSlug,
  ProviderSlug,
  WebProviderSlug,
  WebVerb,
} from './lib/constants.js';

export type ProviderModelPricing = {
  prompt: string | null;
  completion: string | null;
  request: string | null;
  image: string | null;
};

export type ProviderModelCacheEntry = {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: ProviderModelPricing | null;
  inputModalities: string[];
  outputModalities: string[];
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type ProviderCacheFile = {
  version: 1;
  provider: ProviderSlug;
  defaultModel: string;
  fetchedAt: string;
  models: ProviderModelCacheEntry[];
};

export type CostSource = 'provider-cache' | 'config-override';

export type NormalizedUsageSummary = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costCredits?: number;
  /** USD cost computed from cached or user-configured per-token rates. null when no rates are known. */
  costUsd?: number | null;
  /** Where the rates came from. Omitted when costUsd is null/undefined. */
  costSource?: CostSource;
  /** Tokens served from a prompt cache (read side). */
  cachedInputTokens?: number;
  /** Tokens that *populated* a prompt cache on this call (write side, if any). */
  cacheWriteInputTokens?: number;
  reasoningTokens?: number;
  costDetails?: {
    upstreamInferenceCostCredits?: number;
  };
};

export type NormalizedRunResult = {
  ok: true;
  provider: ProviderSlug;
  model: string;
  text: string;
  usage: NormalizedUsageSummary;
  finishReason: string | null;
  cachedModelValidated: boolean;
  outputFile: string | null;
  timestamp: string;
};

export type NormalizedObjectRunResult = {
  ok: true;
  provider: ProviderSlug;
  model: string;
  output: unknown;
  usage: NormalizedUsageSummary;
  finishReason: string | null;
  cachedModelValidated: boolean;
  outputFile: string | null;
  timestamp: string;
};

export type SchemaSource =
  | { kind: 'inline'; value: string }
  | { kind: 'file'; path: string }
  | { kind: 'module'; path: string };

export type ImagePart = {
  data: Uint8Array;
  mimeType: string;
  sourceName?: string;
};

export type FilePart = {
  data: Uint8Array;
  mimeType: string;
  sourceName?: string;
};

export type ChatHistoryEntry = {
  role: 'user' | 'assistant';
  content: string;
};

export type ReasoningEffort = 'low' | 'medium' | 'high';

export type ProviderGenerateInput = {
  model: string;
  prompt: string;
  system?: string;
  images?: ImagePart[];
  files?: FilePart[];
  /** Prior turns for chat-mode sessions. Prepended to the messages array
   *  before the current user prompt. Text-only for v1; images/files in
   *  history are not yet supported. */
  history?: readonly ChatHistoryEntry[];
  /** When set, providers that support prompt caching may attach
   *  cache breakpoints. No-op for providers that auto-cache (OpenAI). */
  cacheBreakpoints?: {
    system?: boolean;
    lastUserMessage?: boolean;
  };
  /** Sampling temperature. AI SDK passes through to every provider that
   *  supports it. */
  temperature?: number;
  /** Hard cap on completion tokens. */
  maxOutputTokens?: number;
  /** Top-p / nucleus sampling. */
  topP?: number;
  /** Reproducibility seed (provider-supported). */
  seed?: number;
  /** Stop sequences. */
  stopSequences?: string[];
  /** Map low/medium/high to each provider's reasoning/thinking knob:
   *    OpenAI -> reasoning_effort
   *    Anthropic -> thinking: { type: 'enabled', budgetTokens }
   *    OpenRouter -> reasoning: { effort }
   *    Others -> ignored.
   *  Single biggest "why is the model dumber than expected" lever for
   *  frontier models (gpt-5, claude-sonnet-4.x, openai/o-series). */
  reasoning?: ReasoningEffort;
  /** Generic provider-options passthrough. Keys are top-level for the
   *  AI SDK's `providerOptions` shape (`{ openai: {...}, anthropic: {...} }`);
   *  the adapter wraps the user-supplied object under its own slug.
   *  Escape hatch for niche provider params we haven't typed (Anthropic
   *  beta headers, OpenAI verbosity, OpenRouter transforms, etc.). */
  providerOptions?: Record<string, unknown>;
  apiKey?: string;
  ollamaBaseUrl?: string;
  cloudflareAccountId?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type ProviderGenerateResult = {
  provider: ProviderSlug;
  model: string;
  text: string;
  usage: NormalizedUsageSummary;
  finishReason: string | null;
};

export type ProviderObjectGenerateInput = ProviderGenerateInput & {
  schema: FlexibleSchema<unknown>;
};

export type ProviderObjectGenerateResult = {
  provider: ProviderSlug;
  model: string;
  output: unknown;
  usage: NormalizedUsageSummary;
  finishReason: string | null;
};

export type ProviderStreamResult = {
  textStream: AsyncIterable<string>;
  complete: Promise<ProviderGenerateResult>;
};

export type RefreshModelsInput = {
  apiKey?: string;
  ollamaBaseUrl?: string;
  cloudflareAccountId?: string;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

/* -------------------------------------------------------------------------- */
/*  image generation                                                          */
/* -------------------------------------------------------------------------- */

export type ProviderCapabilities = {
  text: boolean;
  image: boolean;
  speech: boolean;
  transcription: boolean;
  video?: boolean;
};

export type ProviderGeneratedImage = {
  /** Raw image bytes. */
  data: Uint8Array;
  /** Mime type, e.g. "image/png". */
  mimeType: string;
};

export type ProviderImageGenerateInput = {
  model: string;
  prompt: string;
  n: number;
  size?: string;
  quality?: string;
  style?: string;
  seed?: number;
  negative?: string;
  apiKey?: string;
  cloudflareAccountId?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type ProviderImageGenerateResult = {
  provider: ProviderSlug;
  model: string;
  images: ProviderGeneratedImage[];
  usage: NormalizedUsageSummary;
  finishReason: string | null;
};

export type ProviderImageModelCacheEntry = {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
};

export type ProviderImageCacheFile = {
  version: 1;
  provider: ProviderSlug;
  defaultModel: string;
  fetchedAt: string;
  models: ProviderImageModelCacheEntry[];
};

export type NormalizedImageRunResult = {
  ok: true;
  provider: ProviderSlug;
  model: string;
  images: Array<{
    path?: string;
    b64?: string;
    format: string;
    size: string | null;
    bytes: number;
  }>;
  usage: NormalizedUsageSummary;
  finishReason: string | null;
  cachedModelValidated: boolean;
  timestamp: string;
};

export type ProviderSummary = {
  slug: ProviderSlug;
  name: string;
  defaultModel: string;
  requiresApiKey: boolean;
  cachePath: string;
  env: string[];
};

/* -------------------------------------------------------------------------- */
/*  speech (TTS)                                                              */
/* -------------------------------------------------------------------------- */

export type ProviderSpeechInput = {
  model: string;
  text: string;
  voice?: string;
  format?: string;
  speed?: number;
  instructions?: string;
  apiKey?: string;
  cloudflareAccountId?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type ProviderSpeechResult = {
  provider: ProviderSlug;
  model: string;
  audio: {
    data: Uint8Array;
    mimeType: string;
  };
  voice?: string;
  usage: NormalizedUsageSummary;
};

export type ProviderSpeechCacheEntry = {
  id: string;
  name: string;
  voices: string[];
  metadata: Record<string, unknown>;
};

export type ProviderSpeechCacheFile = {
  version: 1;
  provider: ProviderSlug;
  defaultModel: string;
  fetchedAt: string;
  models: ProviderSpeechCacheEntry[];
};

export type NormalizedSpeechRunResult = {
  ok: true;
  provider: ProviderSlug;
  model: string;
  audio: {
    path?: string;
    b64?: string;
    format: string;
    voice?: string;
    bytes: number;
  };
  usage: NormalizedUsageSummary;
  cachedModelValidated: boolean;
  timestamp: string;
};

/* -------------------------------------------------------------------------- */
/*  transcription (STT)                                                       */
/* -------------------------------------------------------------------------- */

export type ProviderTranscribeInput = {
  model: string;
  audio: Uint8Array;
  audioMimeType?: string;
  language?: string;
  prompt?: string;
  format?: string;
  apiKey?: string;
  cloudflareAccountId?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type TranscribeSegment = {
  start: number;
  end: number;
  text: string;
};

export type ProviderTranscribeResult = {
  provider: ProviderSlug;
  model: string;
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscribeSegment[];
  raw?: string;
  usage: NormalizedUsageSummary;
};

export type ProviderTranscriptionCacheEntry = {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
};

export type ProviderTranscriptionCacheFile = {
  version: 1;
  provider: ProviderSlug;
  defaultModel: string;
  fetchedAt: string;
  models: ProviderTranscriptionCacheEntry[];
};

export type NormalizedTranscribeRunResult = {
  ok: true;
  provider: ProviderSlug;
  model: string;
  text: string;
  language?: string;
  duration?: number;
  segments?: TranscribeSegment[];
  raw?: string;
  usage: NormalizedUsageSummary;
  cachedModelValidated: boolean;
  timestamp: string;
};

/* -------------------------------------------------------------------------- */
/*  video (text-to-video / image-to-video generation)                         */
/* -------------------------------------------------------------------------- */

export type ProviderGeneratedVideo = {
  /** Raw video bytes (typically MP4). */
  data: Uint8Array;
  /** Mime type, e.g. "video/mp4". */
  mimeType: string;
};

/** Input image used for image-to-video conditioning. Some models accept a
 *  single reference image; some accept first+last frame pairs. */
export type ProviderVideoImageInput = {
  data: Uint8Array;
  mimeType: string;
};

export type ProviderVideoGenerateInput = {
  model: string;
  prompt: string;
  /** Width:height ratio, e.g. "16:9". */
  aspectRatio?: string;
  /** Resolution label like "720p" / "1080p" / "4k". The adapter maps this
   *  to whatever the provider expects (a label, a `WxH` string, etc.). */
  resolution?: string;
  /** Clip length in seconds. */
  duration?: number;
  fps?: number;
  /** Number of clips to generate. Most models cap at 1 per call. */
  n?: number;
  seed?: number;
  /** Whether the model should generate synced audio. Ignored on always-on
   *  / never-on models; the adapter logs a warning for those. */
  audio?: boolean;
  /** Image references. Position 0 = single ref or first-frame; position 1
   *  = last-frame for models that support last-frame conditioning. */
  images?: ProviderVideoImageInput[];
  /** Provider-specific passthrough (Veo's negativePrompt, Kling's
   *  motion_strength, etc.). */
  providerOptions?: Record<string, unknown>;
  apiKey?: string;
  cloudflareAccountId?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type ProviderVideoGenerateResult = {
  provider: ProviderSlug;
  model: string;
  videos: ProviderGeneratedVideo[];
  usage: NormalizedUsageSummary;
  finishReason: string | null;
};

export type ProviderVideoModelCacheEntry = {
  id: string;
  name: string;
  metadata: Record<string, unknown>;
};

export type ProviderVideoCacheFile = {
  version: 1;
  provider: ProviderSlug;
  defaultModel: string;
  fetchedAt: string;
  models: ProviderVideoModelCacheEntry[];
};

export type NormalizedVideoRunResult = {
  ok: true;
  provider: ProviderSlug;
  model: string;
  videos: Array<{
    path?: string;
    b64?: string;
    format: string;
    duration?: number;
    bytes: number;
  }>;
  usage: NormalizedUsageSummary;
  finishReason: string | null;
  cachedModelValidated: boolean;
  timestamp: string;
};

/* -------------------------------------------------------------------------- */
/*  web / data search                                                         */
/* -------------------------------------------------------------------------- */

export type WebProviderCapabilities = {
  search: boolean;
  scrape: boolean;
  research: boolean;
  answer: boolean;
  crawl: boolean;
  map: boolean;
  findall: boolean;
};

export type WebUsage = {
  /** Provider-reported credits/cost. Optional. */
  credits?: number;
  costUsd?: number;
  /** Free-form metadata the provider returns alongside results. */
  raw?: Record<string, unknown>;
};

// -- search ------------------------------------------------------------------

export type WebSearchInput = {
  query: string;
  /** Optional natural-language objective (Parallel-style). */
  objective?: string;
  /** Optional list of seed queries (Parallel-style). */
  queries?: string[];
  /** Max results requested. Capped per provider. */
  limit?: number;
  /** Search-depth hint: provider interprets. */
  depth?: 'basic' | 'standard' | 'deep';
  /** Time-window filter. Brave/Tavily honor it. */
  freshness?: 'day' | 'week' | 'month' | 'year';
  includeDomains?: string[];
  excludeDomains?: string[];
  /** When true, fold full page content into each result if the provider supports it. */
  includeContent?: boolean;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebSearchResultItem = {
  url: string;
  title: string | null;
  snippet: string | null;
  score?: number | null;
  publishedAt?: string | null;
  /** Full extracted content if requested + supported. */
  content?: string | null;
};

export type WebSearchResult = {
  provider: WebProviderSlug;
  data: { results: WebSearchResultItem[]; total?: number | null };
  usage?: WebUsage;
  raw?: unknown;
};

// -- scrape ------------------------------------------------------------------

export type WebScrapeInput = {
  urls: string[];
  /** Output format hint; provider may return a subset. */
  format?: 'markdown' | 'text' | 'html';
  /** Optional intent for chunk reranking (Tavily-style). */
  query?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebScrapePage = {
  url: string;
  content: string | null;
  format: 'markdown' | 'text' | 'html';
  title?: string | null;
  metadata?: Record<string, unknown>;
};

export type WebScrapeResult = {
  provider: WebProviderSlug;
  data: { pages: WebScrapePage[]; failed: string[] };
  usage?: WebUsage;
  raw?: unknown;
};

// -- research (async) --------------------------------------------------------

export type WebResearchInput = {
  query: string;
  /** Optional structured output schema (JSON Schema). */
  schema?: unknown;
  /** Provider depth/model knob. */
  depth?: 'basic' | 'standard' | 'deep';
  /** Optional system instructions. */
  instructions?: string;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebResearchSubmission = {
  taskId: string;
};

// -- answer ------------------------------------------------------------------

export type WebAnswerInput = {
  query: string;
  /** Max citations to include. */
  maxCitations?: number;
  /** Whether to also return underlying search results alongside the answer. */
  includeSearch?: boolean;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebCitation = {
  url: string;
  title: string | null;
  snippet?: string | null;
};

export type WebAnswerResult = {
  provider: WebProviderSlug;
  data: {
    answer: string;
    citations: WebCitation[];
    /** Optional underlying search results when --include-search. */
    results?: WebSearchResultItem[];
  };
  usage?: WebUsage;
  raw?: unknown;
};

// -- crawl -------------------------------------------------------------------

export type WebCrawlInput = {
  url: string;
  maxPages?: number;
  maxDepth?: number;
  /** Natural-language guidance (Tavily-style; doubles cost). */
  instructions?: string;
  includePaths?: string[];
  excludePaths?: string[];
  allowExternal?: boolean;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebCrawlPage = {
  url: string;
  content: string | null;
  title?: string | null;
};

export type WebCrawlResult = {
  provider: WebProviderSlug;
  data: { pages: WebCrawlPage[]; stats: { crawled: number; errors: number } };
  usage?: WebUsage;
  raw?: unknown;
};

export type WebCrawlSubmission = { taskId: string };

// -- map ---------------------------------------------------------------------

export type WebMapInput = {
  url: string;
  /** Optional relevance query (Firecrawl). */
  search?: string;
  limit?: number;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebMapEntry = {
  url: string;
  title?: string | null;
  description?: string | null;
};

export type WebMapResult = {
  provider: WebProviderSlug;
  data: { urls: WebMapEntry[]; total?: number | null };
  usage?: WebUsage;
  raw?: unknown;
};

// -- findall (async) ---------------------------------------------------------

export type WebFindallMatchCondition = {
  name: string;
  description: string;
};

export type WebFindallInput = {
  objective: string;
  /** Optional structured schema for items. */
  schema?: unknown;
  /** Max items to find. */
  limit?: number;
  /** Type of entity being searched. Required by Parallel; ignored by Exa
   *  (it auto-detects). */
  entityType?: string;
  /** Structured match conditions evaluated per candidate. Required by
   *  Parallel; Exa auto-derives criteria from the objective. */
  matchConditions?: WebFindallMatchCondition[];
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type WebFindallSubmission = { taskId: string };

// -- task status (polling) ---------------------------------------------------

import type { WebTaskRecordStatus } from './schemas/web-tasks.js';

export type WebTaskStatus = {
  taskId: string;
  provider: WebProviderSlug;
  verb: WebVerb;
  status: WebTaskRecordStatus;
  /** Final result when status === 'done'. Verb-specific shape. */
  data?:
    | WebResearchResultData
    | WebCrawlResult['data']
    | WebFindallResultData;
  /** When status === 'failed' */
  error?: string;
  raw?: unknown;
};

export type WebResearchResultData = {
  /** Free-form research output (string or schema-shaped object). */
  output: string | Record<string, unknown>;
  citations?: WebCitation[];
};

export type WebFindallResultData = {
  items: Array<Record<string, unknown>>;
  total?: number | null;
};

// -- adapter contract --------------------------------------------------------

export type WebProviderAdapter = {
  slug: WebProviderSlug;
  name: string;
  capabilities: WebProviderCapabilities;
  /** When true, the provider requires an API key for any verb. */
  requiresApiKey: boolean;

  search?(input: WebSearchInput): Promise<WebSearchResult>;
  scrape?(input: WebScrapeInput): Promise<WebScrapeResult>;
  answer?(input: WebAnswerInput): Promise<WebAnswerResult>;
  map?(input: WebMapInput): Promise<WebMapResult>;
  /** Synchronous crawl (Tavily). */
  crawl?(input: WebCrawlInput): Promise<WebCrawlResult>;
  /** Async crawl submission (Firecrawl). */
  crawlSubmit?(input: WebCrawlInput): Promise<WebCrawlSubmission>;
  research?(input: WebResearchInput): Promise<WebResearchSubmission>;
  findall?(input: WebFindallInput): Promise<WebFindallSubmission>;

  /** Poll an outstanding task. Provider routes by verb internally. */
  getTask?(input: {
    taskId: string;
    verb: WebVerb;
    apiKey?: string;
    fetchFn?: typeof fetch;
    abortSignal?: AbortSignal;
  }): Promise<WebTaskStatus>;

  /** Cancel an outstanding task. Optional — providers without a cancel endpoint omit it. */
  cancelTask?(input: {
    taskId: string;
    verb: WebVerb;
    apiKey?: string;
    fetchFn?: typeof fetch;
  }): Promise<void>;
};

/* -------------------------------------------------------------------------- */
/*  data providers (people / org / email graph)                               */
/* -------------------------------------------------------------------------- */

export type DataProviderCapabilities = {
  enrichPerson: boolean;
  enrichOrg: boolean;
  lookupPerson: boolean;
  lookupOrg: boolean;
  lookupEmail: boolean;
  verifyEmail: boolean;
};

export type DataUsage = {
  /** Provider-reported credits consumed by the call. */
  credits?: number;
  /** Which counter the call drew from (Hunter: searches/verifications/credits). */
  counter?: string;
  /** Free-form metadata the provider returns. */
  raw?: Record<string, unknown>;
};

// -- shared input shapes -----------------------------------------------------

export type DataPersonIdentifiers = {
  email?: string;
  /** SHA-256 or MD5 hash of the email (Apollo, PDL). */
  emailHash?: string;
  linkedin?: string;
  /** LinkedIn numeric id (PDL `lid`). */
  linkedinId?: string;
  phone?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  /** Domain or company name to scope the match. */
  company?: string;
  domain?: string;
  /** Provider-specific stable id (Apollo `id`, PDL `pdl_id`). */
  providerId?: string;
};

export type DataOrgIdentifiers = {
  domain?: string;
  name?: string;
  /** PDL `website`. */
  website?: string;
  ticker?: string;
  linkedin?: string;
  /** Provider-specific stable id (Apollo `id`, PDL `pdl_id`). */
  providerId?: string;
};

export type DataMatchControls = {
  /** Reject results below this provider-defined likelihood (PDL 1-10, Apollo 0-100). */
  minLikelihood?: number;
  /** Comma-separated list of fields the result must populate. */
  require?: string;
  /** Output payload shaping; subset of fields to return. */
  fields?: string[];
};

// -- enrich (person) ---------------------------------------------------------

export type DataEnrichPersonInput = {
  identifiers: DataPersonIdentifiers;
  controls?: DataMatchControls;
  apiKey?: string;
  /** Some providers (e.g. Tomba) need a second static credential. */
  apiSecret?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type DataNormalizedPerson = {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  emails?: string[];
  phone: string | null;
  linkedin: string | null;
  twitter?: string | null;
  github?: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  /** Provider-specific stable id when available. */
  providerId: string | null;
  /** Confidence/score on a 0-100 scale, normalized when possible. */
  confidence: number | null;
  location: string | null;
  org: DataNormalizedOrg | null;
};

export type DataEnrichPersonResult = {
  provider: DataProviderSlug;
  data: { person: DataNormalizedPerson | null };
  usage?: DataUsage;
  raw?: unknown;
};

// -- enrich (org) ------------------------------------------------------------

export type DataEnrichOrgInput = {
  identifiers: DataOrgIdentifiers;
  controls?: DataMatchControls;
  apiKey?: string;
  apiSecret?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type DataNormalizedOrg = {
  name: string | null;
  domain: string | null;
  description: string | null;
  industry: string | null;
  headcount: number | null;
  /** Free-form headcount band when exact count is unavailable. */
  headcountRange: string | null;
  foundedYear: number | null;
  location: string | null;
  linkedin: string | null;
  twitter?: string | null;
  /** Stable provider id when available. */
  providerId: string | null;
};

export type DataEnrichOrgResult = {
  provider: DataProviderSlug;
  data: { org: DataNormalizedOrg | null };
  usage?: DataUsage;
  raw?: unknown;
};

// -- lookup (person) ---------------------------------------------------------

export type DataLookupPersonFilters = {
  title?: string;
  /** Hunter/Apollo seniority enum (`junior`, `senior`, `executive`, etc). */
  seniority?: string;
  location?: string;
  /** Restrict to people at these company domains. */
  domains?: string[];
  /** Employee count range, expressed as `[min, max]`. */
  employees?: [number, number];
  industry?: string;
  /** Free-form keyword query. */
  q?: string;
};

export type DataLookupPersonInput = {
  filters: DataLookupPersonFilters;
  limit?: number;
  /** Pagination cursor (PDL `scroll_token`, Apollo `page`). */
  cursor?: string;
  apiKey?: string;
  apiSecret?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type DataLookupPersonResult = {
  provider: DataProviderSlug;
  data: {
    results: DataNormalizedPerson[];
    total?: number | null;
    nextCursor?: string | null;
  };
  usage?: DataUsage;
  raw?: unknown;
};

// -- lookup (org) ------------------------------------------------------------

export type DataLookupOrgFilters = {
  domains?: string[];
  /** Employee count range. */
  employees?: [number, number];
  location?: string;
  industry?: string;
  /** Tech stack tags (Apollo `currently_using_any_of_technology_uids`). */
  tech?: string[];
  /** Free-form keyword query. */
  q?: string;
};

export type DataLookupOrgInput = {
  filters: DataLookupOrgFilters;
  limit?: number;
  cursor?: string;
  apiKey?: string;
  apiSecret?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type DataLookupOrgResult = {
  provider: DataProviderSlug;
  data: {
    results: DataNormalizedOrg[];
    total?: number | null;
    nextCursor?: string | null;
  };
  usage?: DataUsage;
  raw?: unknown;
};

// -- lookup (email) ----------------------------------------------------------

export type DataLookupEmailFilters = {
  domain?: string;
  company?: string;
  type?: 'personal' | 'generic';
  seniority?: string;
  department?: string;
};

export type DataLookupEmailInput = {
  filters: DataLookupEmailFilters;
  limit?: number;
  cursor?: string;
  apiKey?: string;
  apiSecret?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type DataEmailRecord = {
  email: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  title: string | null;
  seniority: string | null;
  department: string | null;
  type: 'personal' | 'generic' | null;
  /** 0-100 confidence reported by the provider. */
  confidence: number | null;
  verificationStatus: string | null;
};

export type DataLookupEmailResult = {
  provider: DataProviderSlug;
  data: {
    results: DataEmailRecord[];
    domain: string | null;
    /** Email-name pattern, e.g. `{first}.{last}` (Hunter). */
    pattern: string | null;
    acceptAll: boolean | null;
    total?: number | null;
    nextCursor?: string | null;
  };
  usage?: DataUsage;
  raw?: unknown;
};

// -- verify (email) ----------------------------------------------------------

export type DataVerifyEmailInput = {
  email: string;
  apiKey?: string;
  apiSecret?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
};

export type DataEmailVerification = {
  email: string;
  /** True when status is "valid" or "accept_all". */
  deliverable: boolean;
  /** Provider-defined status string (`valid`, `invalid`, `accept_all`, `unknown`, ...). */
  status: string;
  /** 0-100 score where the provider reports one. */
  score: number | null;
  checks: {
    regexp: boolean | null;
    mxRecords: boolean | null;
    smtpServer: boolean | null;
    smtpCheck: boolean | null;
    acceptAll: boolean | null;
    disposable: boolean | null;
    webmail: boolean | null;
    gibberish: boolean | null;
    block: boolean | null;
  };
};

export type DataVerifyEmailResult = {
  provider: DataProviderSlug;
  data: DataEmailVerification;
  usage?: DataUsage;
  raw?: unknown;
};

// -- adapter contract --------------------------------------------------------

export type DataProviderAdapter = {
  slug: DataProviderSlug;
  name: string;
  capabilities: DataProviderCapabilities;
  requiresApiKey: boolean;

  enrichPerson?(input: DataEnrichPersonInput): Promise<DataEnrichPersonResult>;
  enrichOrg?(input: DataEnrichOrgInput): Promise<DataEnrichOrgResult>;
  lookupPerson?(input: DataLookupPersonInput): Promise<DataLookupPersonResult>;
  lookupOrg?(input: DataLookupOrgInput): Promise<DataLookupOrgResult>;
  lookupEmail?(input: DataLookupEmailInput): Promise<DataLookupEmailResult>;
  verifyEmail?(input: DataVerifyEmailInput): Promise<DataVerifyEmailResult>;
};
