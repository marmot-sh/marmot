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

export const PRESET_MODES = ['text', 'image', 'speech', 'transcription'] as const;
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
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    system: z.string().optional(),
    systemFile: z.string().trim().min(1).optional(),
    schema: z.string().min(1).optional(),
    schemaFile: z.string().trim().min(1).optional(),
    schemaModule: z.string().trim().min(1).optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().min(0).max(1).optional(),
    seed: z.number().int().optional(),
    stop: z.array(z.string().min(1)).optional(),
    reasoning: z.enum(['low', 'medium', 'high']).optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    stream: z.boolean().optional(),
    json: z.boolean().optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

const presetImageSchema = z
  .object({
    mode: z.literal('image'),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    size: z.string().trim().min(1).optional(),
    quality: z.string().trim().min(1).optional(),
    style: z.string().trim().min(1).optional(),
    seed: z.number().int().optional(),
    negative: z.string().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    n: z.number().int().min(1).max(10).optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

const presetSpeechSchema = z
  .object({
    mode: z.literal('speech'),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    voice: z.string().trim().min(1).optional(),
    format: z.string().trim().min(1).optional(),
    speed: z.number().positive().optional(),
    instructions: z.string().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

const presetTranscriptionSchema = z
  .object({
    mode: z.literal('transcription'),
    provider: providerSlugSchema.optional(),
    model: z.string().trim().min(1).optional(),
    language: z.string().trim().min(1).optional(),
    format: z.string().trim().min(1).optional(),
    prompt: z.string().optional(),
    providerOption: z.array(z.string().min(1)).optional(),
    retries: z.number().int().min(0).optional(),
    timeout: z.number().int().min(1).optional(),
  })
  .strict();

export const presetSchema = z.discriminatedUnion('mode', [
  presetTextSchema,
  presetImageSchema,
  presetSpeechSchema,
  presetTranscriptionSchema,
]);

export type Preset = z.infer<typeof presetSchema>;
export type TextPreset = z.infer<typeof presetTextSchema>;
export type ImagePreset = z.infer<typeof presetImageSchema>;
export type SpeechPreset = z.infer<typeof presetSpeechSchema>;
export type TranscriptionPreset = z.infer<typeof presetTranscriptionSchema>;

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
