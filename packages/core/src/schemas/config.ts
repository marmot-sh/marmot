import { z } from 'zod';

import {
  DATA_PROVIDERS,
  PROVIDERS,
  WEB_PROVIDERS,
  type DataProviderSlug,
  type ProviderSlug,
  type WebProviderSlug,
} from '../lib/constants.js';

const providerSlugSchema = z.enum(PROVIDERS);
const webProviderSlugSchema = z.enum(WEB_PROVIDERS);
const dataProviderSlugSchema = z.enum(DATA_PROVIDERS);

const modeDefaultsSchema = z
  .object({
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
  })
  .strict();

const webVerbDefaultsSchema = z
  .object({
    provider: webProviderSlugSchema.optional(),
  })
  .strict();

const dataVerbDefaultsSchema = z
  .object({
    provider: dataProviderSlugSchema.optional(),
  })
  .strict();

// Per-provider settings: enable toggle, custom env var names for credentials,
// optional response cache. Used by AI, web, and data providers — slug union
// is the union of all three provider categories.
const providerSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Override env var name for the primary credential. Default is the
     *  built-in *_API_KEY (or provider-specific) name. */
    apiKeyEnvVar: z.string().trim().min(1).optional(),
    /** Override env var name for a secondary credential (Tomba secret,
     *  Cloudflare account id). Default is the provider's built-in extra
     *  env var. */
    apiSecretEnvVar: z.string().trim().min(1).optional(),
    /** Response cache settings. Web/data providers only — applying to AI is
     *  a no-op at runtime. Both fields optional so users can set ttlDays
     *  without first having to set enabled (and vice versa); resolveProviderCache
     *  treats absent enabled as false. */
    cache: z
      .object({
        enabled: z.boolean().optional(),
        ttlDays: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
    /** Per-model pricing overrides for cost reporting. Used when the provider
     *  cache has no pricing data (Anthropic, OpenAI, Cloudflare, ...). Rates
     *  follow the OpenRouter convention: stringified per-token USD, e.g.
     *  "0.000003" = $3 per million tokens. Keys are model ids. */
    pricing: z
      .record(
        z.string().min(1),
        z
          .object({
            prompt: z.string().min(1).optional(),
            completion: z.string().min(1).optional(),
            request: z.string().min(1).optional(),
            image: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type ProviderSettings = z.infer<typeof providerSettingsSchema>;
export const DEFAULT_CACHE_TTL_DAYS = 30;

const ALL_PROVIDER_SLUGS = [...PROVIDERS, ...WEB_PROVIDERS, ...DATA_PROVIDERS] as const;
type AllProviderSlugTuple = readonly [string, ...string[]];
const anyProviderSlugSchema = z.enum(ALL_PROVIDER_SLUGS as unknown as AllProviderSlugTuple);
export type AnyProviderSlug = ProviderSlug | WebProviderSlug | DataProviderSlug;

const speechDefaultsSchema = z
  .object({
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    voice: z.string().trim().min(1).optional(),
  })
  .strict();

export const PRESET_MODES = [
  'text',
  'image',
  'video',
  'speech',
  'transcription',
  'search',
  'scrape',
  'answer',
  'map',
  'crawl',
  'research',
  'findall',
  'enrich',
  'lookup',
  'verify',
] as const;
export type PresetMode = (typeof PRESET_MODES)[number];

// Slug-format preset names: lowercase letters and digits, with single
// `-` or `_` separators between alphanumeric runs. No leading/trailing
// separator and no consecutive separators (`--`, `__`, `-_`, `_-`).
export const PRESET_NAME_REGEX = /^[a-z0-9]+([-_][a-z0-9]+)*$/;

const presetNameSchema = z
  .string()
  .regex(
    PRESET_NAME_REGEX,
    'Preset name must be lowercase letters/digits with single - or _ separators (no leading, trailing, or consecutive separators).',
  );

// All preset shapes share: provider / model / retries / timeout. Mode-
// specific shapes layer on the per-modality flags. Field names are
// camelCase so they match commander's option keys verbatim — applyPreset
// merges by key name, so `maxTokens` here directly fills `options.maxTokens`
// at runtime without per-verb glue.

const presetTextSchema = z
  .object({
    mode: z.literal('text'),
    preset_id: z.string().uuid().optional(),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    prompt: z.string().optional(),
    promptFile: z.string().trim().min(1).optional(),
    system: z.string().optional(),
    systemFile: z.string().trim().min(1).optional(),
    schema: z.string().min(1).optional(),
    schemaFile: z.string().trim().min(1).optional(),
    schemaModule: z.string().trim().min(1).optional(),
    file: z.array(z.string().trim().min(1)).optional(),
    image: z.array(z.string().trim().min(1)).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string().min(1)).optional(),
    reasoning: z.enum(['low', 'medium', 'high']).optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    output: z.string().trim().min(1).optional(),
    stream: z.boolean().optional(),
    text: z.boolean().optional(),
    json: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetImageSchema = z
  .object({
    mode: z.literal('image'),
    preset_id: z.string().uuid().optional(),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    prompt: z.string().optional(),
    promptFile: z.string().trim().min(1).optional(),
    size: z.string().trim().min(1).optional(),
    quality: z.string().trim().min(1).optional(),
    style: z.string().trim().min(1).optional(),
    seed: z.number().int().optional(),
    negative: z.string().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    n: z.number().int().min(1).max(10).optional(),
    output: z.string().trim().min(1).optional(),
    binary: z.boolean().optional(),
    b64: z.boolean().optional(),
    json: z.boolean().optional(),
    preview: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetSpeechSchema = z
  .object({
    mode: z.literal('speech'),
    preset_id: z.string().uuid().optional(),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    text: z.string().optional(),
    promptFile: z.string().trim().min(1).optional(),
    voice: z.string().trim().min(1).optional(),
    format: z.string().trim().min(1).optional(),
    speed: z.number().positive().optional(),
    instructions: z.string().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    output: z.string().trim().min(1).optional(),
    binary: z.boolean().optional(),
    b64: z.boolean().optional(),
    json: z.boolean().optional(),
    play: z.boolean().optional(),
    wait: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetTranscriptionSchema = z
  .object({
    mode: z.literal('transcription'),
    preset_id: z.string().uuid().optional(),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    audio: z.string().trim().min(1).optional(),
    language: z.string().trim().min(1).optional(),
    format: z.string().trim().min(1).optional(),
    prompt: z.string().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    output: z.string().trim().min(1).optional(),
    text: z.boolean().optional(),
    json: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetVideoSchema = z
  .object({
    mode: z.literal('video'),
    preset_id: z.string().uuid().optional(),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    prompt: z.string().optional(),
    promptFile: z.string().trim().min(1).optional(),
    image: z.array(z.string().trim().min(1)).optional(),
    aspect: z.string().trim().min(1).optional(),
    resolution: z.string().trim().min(1).optional(),
    duration: z.number().int().positive().optional(),
    fps: z.number().int().positive().optional(),
    audio: z.boolean().optional(),
    n: z.number().int().min(1).max(10).optional(),
    seed: z.number().int().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    output: z.string().trim().min(1).optional(),
    binary: z.boolean().optional(),
    b64: z.boolean().optional(),
    json: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

// Web/data verb presets. Field names match commander's option keys
// verbatim (e.g. includeDomains as a CSV string, not string[]) so
// applyPreset merges directly into options without per-verb glue.
// CSV-shaped fields stay as strings; the verb's existing csvToList
// parser handles them downstream.

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

const presetSearchSchema = z
  .object({
    mode: z.literal('search'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    query: z.string().optional(),
    limit: z.number().int().positive().optional(),
    depth: z.enum(['basic', 'standard', 'deep']).optional(),
    freshness: z.enum(['day', 'week', 'month', 'year']).optional(),
    afterDate: isoDateSchema.optional(),
    beforeDate: isoDateSchema.optional(),
    includeDomains: z.string().min(1).optional(),
    excludeDomains: z.string().min(1).optional(),
    includeContent: z.boolean().optional(),
    cache: z.boolean().optional(),
    refresh: z.boolean().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetScrapeSchema = z
  .object({
    mode: z.literal('scrape'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    urls: z.array(z.string().trim().min(1)).optional(),
    format: z.enum(['markdown', 'text', 'html']).optional(),
    query: z.string().min(1).optional(),
    cache: z.boolean().optional(),
    refresh: z.boolean().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetAnswerSchema = z
  .object({
    mode: z.literal('answer'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    query: z.string().optional(),
    maxCitations: z.number().int().positive().optional(),
    includeSearch: z.boolean().optional(),
    cache: z.boolean().optional(),
    refresh: z.boolean().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetMapSchema = z
  .object({
    mode: z.literal('map'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    url: z.string().trim().min(1).optional(),
    search: z.string().min(1).optional(),
    limit: z.number().int().positive().optional(),
    cache: z.boolean().optional(),
    refresh: z.boolean().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetCrawlSchema = z
  .object({
    mode: z.literal('crawl'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    url: z.string().trim().min(1).optional(),
    maxPages: z.number().int().positive().optional(),
    maxDepth: z.number().int().min(0).optional(),
    instructions: z.string().min(1).optional(),
    includePaths: z.string().min(1).optional(),
    excludePaths: z.string().min(1).optional(),
    allowExternal: z.boolean().optional(),
    wait: z.boolean().optional(),
    async: z.boolean().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetResearchSchema = z
  .object({
    mode: z.literal('research'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    query: z.string().optional(),
    depth: z.enum(['basic', 'standard', 'deep']).optional(),
    schema: z.string().min(1).optional(),
    schemaFile: z.string().trim().min(1).optional(),
    instructions: z.string().min(1).optional(),
    wait: z.boolean().optional(),
    async: z.boolean().optional(),
    pollInterval: z.string().min(1).optional(),
    maxWait: z.number().int().positive().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetFindallSchema = z
  .object({
    mode: z.literal('findall'),
    preset_id: z.string().uuid().optional(),
    provider: webProviderSlugSchema.optional(),
    objective: z.string().optional(),
    limit: z.number().int().positive().optional(),
    schema: z.string().min(1).optional(),
    schemaFile: z.string().trim().min(1).optional(),
    entityType: z.string().min(1).optional(),
    matchConditions: z.string().min(1).optional(),
    wait: z.boolean().optional(),
    async: z.boolean().optional(),
    output: z.string().trim().min(1).optional(),
    raw: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
    session: z.string().trim().min(1).optional(),
  })
  .strict();

const presetEnrichSchema = z
  .object({
    mode: z.literal('enrich'),
    preset_id: z.string().uuid().optional(),
    provider: dataProviderSlugSchema.optional(),
    type: z.enum(['person', 'org']).optional(),
    minLikelihood: z.number().int().positive().optional(),
    require: z.string().min(1).optional(),
    fields: z.string().min(1).optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

const presetLookupSchema = z
  .object({
    mode: z.literal('lookup'),
    preset_id: z.string().uuid().optional(),
    provider: dataProviderSlugSchema.optional(),
    type: z.enum(['person', 'org', 'email']).optional(),
    limit: z.number().int().positive().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

const presetVerifySchema = z
  .object({
    mode: z.literal('verify'),
    preset_id: z.string().uuid().optional(),
    provider: dataProviderSlugSchema.optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

export const presetSchema = z.discriminatedUnion('mode', [
  presetTextSchema,
  presetImageSchema,
  presetVideoSchema,
  presetSpeechSchema,
  presetTranscriptionSchema,
  presetSearchSchema,
  presetScrapeSchema,
  presetAnswerSchema,
  presetMapSchema,
  presetCrawlSchema,
  presetResearchSchema,
  presetFindallSchema,
  presetEnrichSchema,
  presetLookupSchema,
  presetVerifySchema,
]);

export type Preset = z.infer<typeof presetSchema>;
export type TextPreset = z.infer<typeof presetTextSchema>;
export type ImagePreset = z.infer<typeof presetImageSchema>;
export type VideoPreset = z.infer<typeof presetVideoSchema>;
export type SpeechPreset = z.infer<typeof presetSpeechSchema>;
export type TranscriptionPreset = z.infer<typeof presetTranscriptionSchema>;
export type SearchPreset = z.infer<typeof presetSearchSchema>;
export type ScrapePreset = z.infer<typeof presetScrapeSchema>;
export type AnswerPreset = z.infer<typeof presetAnswerSchema>;
export type MapPreset = z.infer<typeof presetMapSchema>;
export type CrawlPreset = z.infer<typeof presetCrawlSchema>;
export type ResearchPreset = z.infer<typeof presetResearchSchema>;
export type FindallPreset = z.infer<typeof presetFindallSchema>;
export type EnrichPreset = z.infer<typeof presetEnrichSchema>;
export type LookupPreset = z.infer<typeof presetLookupSchema>;
export type VerifyPreset = z.infer<typeof presetVerifySchema>;

export const marmotConfigSchema = z
  .object({
    version: z.literal(1),
    defaults: z
      .object({
        text: modeDefaultsSchema.optional(),
        image: modeDefaultsSchema.optional(),
        speech: speechDefaultsSchema.optional(),
        transcription: modeDefaultsSchema.optional(),
        video: modeDefaultsSchema.optional(),
        search: webVerbDefaultsSchema.optional(),
        scrape: webVerbDefaultsSchema.optional(),
        research: webVerbDefaultsSchema.optional(),
        answer: webVerbDefaultsSchema.optional(),
        crawl: webVerbDefaultsSchema.optional(),
        map: webVerbDefaultsSchema.optional(),
        findall: webVerbDefaultsSchema.optional(),
        enrich: dataVerbDefaultsSchema.optional(),
        lookup: dataVerbDefaultsSchema.optional(),
        verify: dataVerbDefaultsSchema.optional(),
      })
      .strict()
      .optional(),
    presets: z.record(presetNameSchema, presetSchema).optional(),
    /** Usage log settings.
     *  - `enabled` (default true): write a record per metered call to
     *    ~/.marmot/usage/<UTC-DATE>.jsonl. Disable globally here or per-call
     *    via env var `MARMOT_NO_LOG=1`.
     *  - `recordSensitive` (default false): when true, also include the
     *    user's prompt, query, target URLs, and identifier values
     *    (`--email`, `--include-domains`, etc.) under the record's
     *    `sensitive` field. Off by default — keep it off unless you
     *    explicitly want a full audit trail and accept that the log file
     *    contains everything you searched for or wrote. */
    logging: z
      .object({
        enabled: z.boolean().optional(),
        recordSensitive: z.boolean().optional(),
      })
      .strict()
      .optional(),
    /** Per-provider settings (enable toggle, custom env var names, response
     *  cache). Keyed by provider slug across AI, web, and data categories. */
    providers: z.partialRecord(anyProviderSlugSchema, providerSettingsSchema).optional(),
  })
  .strict();

export type MarmotConfig = z.infer<typeof marmotConfigSchema>;

export type ResolvedModeDefaults = {
  provider: ProviderSlug;
  model?: string;
};

export type ResolvedWebVerbDefaults = {
  provider: WebProviderSlug;
};

export type ResolvedDataVerbDefaults = {
  provider: DataProviderSlug;
};

export const DEFAULT_CONFIG: MarmotConfig = {
  version: 1,
  defaults: {
    text: {},
    image: {},
  },
};
