/**
 * Single source of truth for per-mode preset field metadata. Both the
 * flag-driven `buildPresetFromFlags` and the interactive create/update
 * flows consume this table, so adding a new preset field only requires
 * touching one place.
 *
 * The order of fields per mode is the order the interactive walk
 * presents them — most-commonly-set first, advanced/rare ones last.
 */
import type { PresetMode } from '@marmot-sh/core';

export type FieldType =
  | 'string'
  | 'path'
  | 'number-int'
  | 'number-float'
  | 'bool'
  | 'enum'
  | 'list-string';

export type FieldDescriptor = {
  /** Preset field key (camelCase, matches the Zod schema field). */
  key: string;
  /** CLI flag name (kebab-case, no leading dashes). For error messages. */
  flag: string;
  /** Field shape. Drives both runtime parsing and prompt UI. */
  type: FieldType;
  /** Human-readable label used in interactive prompts. */
  label: string;
  /** One-liner help text shown next to the prompt. */
  help: string;
  /** Allowed values for `enum` type. */
  enumValues?: readonly string[];
  /**
   * Numeric inclusive lower bound (validated at prompt time; the schema
   * also enforces, so this is purely UX-side early-fail).
   */
  min?: number;
  /** Numeric inclusive upper bound (UX-side early-fail). */
  max?: number;
  /**
   * Regex the string input must match. The interactive walk re-prompts
   * with the descriptor's help text when it fails. The schema validates
   * a second time at the end of the walk as a backstop.
   */
  pattern?: RegExp;
  /** Friendly description of `pattern` shown when validation fails. */
  patternHint?: string;
  /**
   * Optional placeholder example shown in the prompt input area. Helps
   * answer "what does this look like?" — particularly useful for paths,
   * dates, and CSV-shaped fields. Falls back to a generic "skip" or
   * "current: …" hint when not set.
   */
  placeholder?: string;
  /**
   * Provider slugs this field actually has an effect on. When set, the
   * interactive walk skips this field entirely if the user picked a
   * provider not in the list. Leave undefined for fields that apply to
   * every provider for the mode. Use this for fields where we know the
   * underlying provider matrix ignores or doesn't honor a given flag —
   * showing it would just confuse the user.
   */
  appliesTo?: readonly string[];
  /**
   * Mutually-exclusive group. Within a group, the interactive flow asks
   * "which one (if any)?" once and only walks the chosen branch. The
   * flag-driven builder ignores this field — passing two members of the
   * same group is just stored, and the verb's runtime resolution decides.
   */
  group?: string;
};

const fieldProvider: FieldDescriptor = {
  key: 'provider',
  flag: 'provider',
  type: 'string',
  label: 'Provider',
  help: 'Provider slug. Skip to use the configured default.',
};
const fieldModel: FieldDescriptor = {
  key: 'model',
  flag: 'model',
  type: 'string',
  label: 'Model',
  help: 'Model id. Skip to use the provider default.',
};
const fieldRetries: FieldDescriptor = {
  key: 'retries',
  flag: 'retries',
  type: 'number-int',
  min: 0,
  label: 'Retries',
  help: 'Default retry count for this preset (0 or more).',
};
const fieldTimeout: FieldDescriptor = {
  key: 'timeout',
  flag: 'timeout',
  type: 'number-int',
  min: 1,
  label: 'Timeout (seconds)',
  help: 'Default per-attempt timeout for this preset (1 or more).',
};

const baseShared: FieldDescriptor[] = [fieldProvider, fieldRetries, fieldTimeout];
const baseAI: FieldDescriptor[] = [fieldProvider, fieldModel, fieldRetries, fieldTimeout];

const sharedOutput: FieldDescriptor[] = [
  {
    key: 'output',
    flag: 'output',
    type: 'path',
    label: 'Output path',
    help: 'Where to write the result. Use {i} for batch outputs (e.g. ./out-{i}.png). Skip to use the verb default.',
    placeholder: 'e.g. ~/results.json or ./out-{i}.png',
  },
  {
    key: 'session',
    flag: 'session',
    type: 'string',
    label: 'Session binding',
    help: 'Tag every call with this session name so it shows up in `marmot session show <name>` and filters in `marmot usage`.',
    placeholder: 'e.g. research-q2',
  },
];

const sharedCacheControl: FieldDescriptor[] = [
  {
    key: 'cache',
    flag: 'cache',
    type: 'bool',
    label: 'Use response cache',
    help: 'When the provider has caching enabled, reuse cached responses instead of re-hitting the API. true = use cache (default), false = bypass and always make a fresh call.',
  },
  {
    key: 'refresh',
    flag: 'refresh',
    type: 'bool',
    label: 'Force refresh',
    help: 'Always re-fetch from the provider but still write the result to the cache (overwrites any stale entry). Useful when you know the upstream content has changed.',
  },
];

const reasoningEnum = ['low', 'medium', 'high'] as const;
const depthEnum = ['basic', 'standard', 'deep'] as const;
const freshnessEnum = ['day', 'week', 'month', 'year'] as const;
const scrapeFormatEnum = ['markdown', 'text', 'html'] as const;
const speechFormatEnum = ['mp3', 'wav', 'flac', 'aac', 'opus'] as const;
const transcriptionFormatEnum = ['text', 'json', 'srt', 'vtt', 'verbose-json'] as const;
const enrichTypeEnum = ['person', 'org'] as const;
const lookupTypeEnum = ['person', 'org', 'email'] as const;

export const MODE_FIELDS: Record<PresetMode, FieldDescriptor[]> = {
  text: [
    ...baseAI,
    {
      key: 'system',
      flag: 'system',
      type: 'string',
      label: 'System prompt',
      help: 'Inline text used as the system message.',
    },
    {
      key: 'systemFile',
      flag: 'system-file',
      type: 'path',
      label: 'System prompt file',
      help: 'Path to a file holding the system prompt.',
    },
    {
      key: 'prompt',
      flag: 'prompt',
      type: 'string',
      label: 'Prompt prefix',
      help: 'Text prepended to every runtime prompt for this preset.',
    },
    {
      key: 'promptFile',
      flag: 'prompt-file',
      type: 'path',
      label: 'Prompt file',
      help: 'Path to a file whose contents are prepended to every runtime prompt.',
    },
    {
      key: 'temperature',
      flag: 'temperature',
      type: 'number-float',
      label: 'Temperature',
      help: 'Sampling temperature (typically 0–2).',
    },
    {
      key: 'maxTokens',
      flag: 'max-tokens',
      type: 'number-int',
      min: 1,
      label: 'Max tokens',
      help: 'Hard cap on completion tokens (1 or more).',
    },
    {
      key: 'topP',
      flag: 'top-p',
      type: 'number-float',
      min: 0,
      max: 1,
      label: 'Top-p',
      help: 'Nucleus sampling, between 0 and 1.',
    },
    {
      key: 'seed',
      flag: 'seed',
      type: 'number-int',
      label: 'Seed',
      help: 'Reproducibility seed.',
    },
    {
      key: 'reasoning',
      flag: 'reasoning',
      type: 'enum',
      enumValues: reasoningEnum,
      label: 'Reasoning effort',
      help: 'Thinking budget on supporting providers.',
    },
    {
      key: 'stop',
      flag: 'stop',
      type: 'list-string',
      label: 'Stop sequences',
      help: 'Stop generation when one of these strings appears. Repeatable.',
    },
    {
      key: 'file',
      flag: 'file',
      type: 'list-string',
      label: 'Document attachments',
      help: 'PDF / document files attached on every call. Repeatable.',
    },
    {
      key: 'image',
      flag: 'image',
      type: 'list-string',
      label: 'Image attachments',
      help: 'Vision input files attached on every call. Repeatable.',
    },
    {
      key: 'schema',
      flag: 'schema',
      type: 'string',
      label: 'JSON Schema (inline)',
      help: 'Inline JSON Schema for structured output.',
      group: 'structured-output',
    },
    {
      key: 'schemaFile',
      flag: 'schema-file',
      type: 'path',
      label: 'JSON Schema file',
      help: 'Path to a JSON Schema file.',
      group: 'structured-output',
    },
    {
      key: 'schemaModule',
      flag: 'schema-module',
      type: 'path',
      label: 'Zod schema module',
      help: 'Local TS/JS module exporting a Zod schema (trusted code only).',
      group: 'structured-output',
    },
    {
      key: 'stream',
      flag: 'stream',
      type: 'bool',
      label: 'Stream by default',
      help: 'Stream tokens as they arrive (text mode only).',
    },
    {
      key: 'json',
      flag: 'json',
      type: 'bool',
      label: 'JSON envelope',
      help: 'Emit the structured JSON envelope by default.',
    },
    {
      key: 'text',
      flag: 'text',
      type: 'bool',
      label: 'Plain text output',
      help: 'Emit just the generated text by default (default true).',
    },
    {
      key: 'providerOption',
      flag: 'provider-option',
      type: 'list-string',
      label: 'Provider options',
      help: 'Generic key=value passthrough. Repeatable.',
    },
    ...sharedOutput,
  ],

  image: [
    ...baseAI,
    {
      key: 'prompt',
      flag: 'prompt',
      type: 'string',
      label: 'Prompt prefix',
      help: 'Text prepended to every runtime image prompt.',
    },
    {
      key: 'promptFile',
      flag: 'prompt-file',
      type: 'path',
      label: 'Prompt file',
      help: 'Path to a file whose contents are prepended.',
    },
    {
      key: 'size',
      flag: 'size',
      type: 'string',
      label: 'Size (WxH)',
      help: 'Image dimensions, e.g. 1024x1024.',
    },
    {
      key: 'quality',
      flag: 'quality',
      type: 'string',
      label: 'Quality',
      help: 'Provider-specific quality level.',
    },
    {
      key: 'style',
      flag: 'style',
      type: 'string',
      label: 'Style',
      help: 'Provider-specific style.',
    },
    {
      key: 'negative',
      flag: 'negative',
      type: 'string',
      label: 'Negative prompt',
      help: 'Things to avoid in the generated image.',
    },
    {
      key: 'seed',
      flag: 'seed',
      type: 'number-int',
      label: 'Seed',
      help: 'Reproducibility seed.',
    },
    {
      key: 'n',
      flag: 'n',
      type: 'number-int',
      min: 1,
      max: 10,
      label: 'Number of images',
      help: 'How many images to generate (1–10).',
    },
    {
      key: 'binary',
      flag: 'binary',
      type: 'bool',
      label: 'Raw bytes to stdout',
      help: 'Default to writing raw image bytes to stdout (--n 1 only).',
    },
    {
      key: 'b64',
      flag: 'b64',
      type: 'bool',
      label: 'Base64 envelope',
      help: 'Default to JSON envelope with base64 image data inline.',
    },
    {
      key: 'json',
      flag: 'json',
      type: 'bool',
      label: 'JSON envelope',
      help: 'Default to emitting the JSON envelope on stdout.',
    },
    {
      key: 'preview',
      flag: 'preview',
      type: 'bool',
      label: 'Inline terminal preview',
      help: 'Show inline image preview on supporting terminals (default true).',
    },
    {
      key: 'providerOption',
      flag: 'provider-option',
      type: 'list-string',
      label: 'Provider options',
      help: 'Generic key=value passthrough. Repeatable.',
    },
    ...sharedOutput,
  ],

  speech: [
    ...baseAI,
    {
      key: 'voice',
      flag: 'voice',
      type: 'string',
      label: 'Voice',
      help: 'Voice id (provider-specific).',
    },
    {
      key: 'format',
      flag: 'format',
      type: 'enum',
      enumValues: speechFormatEnum,
      label: 'Audio format',
      help: 'mp3, wav, flac, aac, opus.',
    },
    {
      key: 'speed',
      flag: 'speed',
      type: 'number-float',
      min: 0.25,
      max: 4,
      label: 'Playback speed',
      help: 'Multiplier between 0.25 and 4.0.',
    },
    {
      key: 'instructions',
      flag: 'instructions',
      type: 'string',
      label: 'Voice steering',
      help: 'Steering text for steerable voices.',
    },
    {
      key: 'text',
      flag: 'text',
      type: 'string',
      label: 'Text prefix',
      help: 'Text prepended to every runtime "speak" call.',
    },
    {
      key: 'promptFile',
      flag: 'prompt-file',
      type: 'path',
      label: 'Text file',
      help: 'Path to a file whose contents are prepended.',
    },
    {
      key: 'play',
      flag: 'play',
      type: 'bool',
      label: 'Play through speakers',
      help: 'Default to playing audio through system speakers.',
    },
    {
      key: 'wait',
      flag: 'wait',
      type: 'bool',
      label: 'Wait for playback',
      help: 'With --play, block until playback finishes.',
    },
    {
      key: 'binary',
      flag: 'binary',
      type: 'bool',
      label: 'Raw bytes to stdout',
      help: 'Default to writing raw audio bytes to stdout.',
    },
    {
      key: 'b64',
      flag: 'b64',
      type: 'bool',
      label: 'Base64 envelope',
      help: 'Default to JSON envelope with base64 audio inline.',
    },
    {
      key: 'json',
      flag: 'json',
      type: 'bool',
      label: 'JSON envelope',
      help: 'Default to emitting the JSON envelope on stdout.',
    },
    {
      key: 'providerOption',
      flag: 'provider-option',
      type: 'list-string',
      label: 'Provider options',
      help: 'Generic key=value passthrough. Repeatable.',
    },
    ...sharedOutput,
  ],

  transcription: [
    ...baseAI,
    {
      key: 'audio',
      flag: 'audio',
      type: 'path',
      label: 'Default audio path',
      help: 'Audio file used when no positional path is given at runtime.',
    },
    {
      key: 'language',
      flag: 'language',
      type: 'string',
      label: 'Language hint',
      help: 'ISO-639-1 hint, e.g. en, es.',
    },
    {
      key: 'format',
      flag: 'format',
      type: 'enum',
      enumValues: transcriptionFormatEnum,
      label: 'Output format',
      help: 'text (default), json, srt, vtt, verbose-json.',
    },
    {
      key: 'prompt',
      flag: 'prompt',
      type: 'string',
      label: 'Bias prompt',
      help: 'Vocabulary / style hint that concatenates with runtime --prompt.',
    },
    {
      key: 'text',
      flag: 'text',
      type: 'bool',
      label: 'Plain text output',
      help: 'Default to plain text output.',
    },
    {
      key: 'json',
      flag: 'json',
      type: 'bool',
      label: 'JSON envelope',
      help: 'Default to JSON envelope (alias for --format json).',
    },
    {
      key: 'providerOption',
      flag: 'provider-option',
      type: 'list-string',
      label: 'Provider options',
      help: 'Generic key=value passthrough. Repeatable.',
    },
    ...sharedOutput,
  ],

  video: [
    ...baseAI,
    {
      key: 'prompt',
      flag: 'prompt',
      type: 'string',
      label: 'Prompt prefix',
      help: 'Text prepended to every runtime video prompt.',
    },
    {
      key: 'promptFile',
      flag: 'prompt-file',
      type: 'path',
      label: 'Prompt file',
      help: 'Path to a file whose contents are prepended.',
    },
    {
      key: 'aspect',
      flag: 'aspect',
      type: 'string',
      label: 'Aspect ratio',
      help: '16:9, 9:16, 1:1, etc.',
    },
    {
      key: 'resolution',
      flag: 'resolution',
      type: 'string',
      label: 'Resolution',
      help: '720p, 1080p, 4k, or WxH.',
    },
    {
      key: 'duration',
      flag: 'duration',
      type: 'number-int',
      min: 1,
      label: 'Duration (seconds)',
      help: 'Clip length (1 or more).',
    },
    {
      key: 'fps',
      flag: 'fps',
      type: 'number-int',
      min: 1,
      label: 'Frames per second',
      help: 'Honored by some providers (1 or more).',
    },
    {
      key: 'audio',
      flag: 'audio',
      type: 'bool',
      label: 'Synced audio',
      help: 'Default to including synced audio.',
    },
    {
      key: 'image',
      flag: 'image',
      type: 'list-string',
      label: 'Reference frames',
      help: 'First-frame and optional last-frame conditioning paths. Repeatable (max 2).',
    },
    {
      key: 'n',
      flag: 'n',
      type: 'number-int',
      min: 1,
      max: 10,
      label: 'Number of clips',
      help: 'How many clips to generate (1–10; most models cap at 1).',
    },
    {
      key: 'seed',
      flag: 'seed',
      type: 'number-int',
      label: 'Seed',
      help: 'Reproducibility seed.',
    },
    {
      key: 'binary',
      flag: 'binary',
      type: 'bool',
      label: 'Raw bytes to stdout',
      help: 'Default to writing raw video bytes to stdout.',
    },
    {
      key: 'b64',
      flag: 'b64',
      type: 'bool',
      label: 'Base64 envelope',
      help: 'Default to JSON envelope with base64 video inline.',
    },
    {
      key: 'json',
      flag: 'json',
      type: 'bool',
      label: 'JSON envelope',
      help: 'Default to emitting the JSON envelope on stdout.',
    },
    {
      key: 'providerOption',
      flag: 'provider-option',
      type: 'list-string',
      label: 'Provider options',
      help: 'Generic key=value passthrough. Repeatable.',
    },
    ...sharedOutput,
  ],

  search: [
    ...baseShared,
    {
      key: 'query',
      flag: 'query',
      type: 'string',
      label: 'Query prefix',
      help: 'Text prepended (with `\\n\\n`) to every runtime search query, e.g. baked-in operators like `site:linkedin.com`. Leave blank if you want the runtime query alone.',
      placeholder: 'e.g. site:linkedin.com',
    },
    {
      key: 'limit',
      flag: 'limit',
      type: 'number-int',
      min: 1,
      label: 'Result limit',
      help: 'How many results to return per call. Each provider has its own cap (typically 10–100).',
    },
    {
      key: 'depth',
      flag: 'depth',
      type: 'enum',
      enumValues: depthEnum,
      label: 'Search depth',
      help: 'How thoroughly the provider explores. basic = fast/cheap, standard = balanced (default), deep = slower/more thorough.',
    },
    {
      key: 'freshness',
      flag: 'freshness',
      type: 'enum',
      enumValues: freshnessEnum,
      label: 'Freshness window',
      help: 'Relative recency filter. Brave/Tavily honor natively; Exa/Firecrawl emulate.',
      // Parallel ignores --freshness (its API has no equivalent); use
      // --after-date instead.
      appliesTo: ['brave', 'exa', 'firecrawl', 'tavily'],
    },
    {
      key: 'afterDate',
      flag: 'after-date',
      type: 'string',
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      patternHint: 'Use YYYY-MM-DD (e.g. 2026-01-15).',
      placeholder: 'e.g. 2026-01-15',
      label: 'After date',
      help: 'Only return results on or after this absolute date.',
      // Brave and Tavily lack absolute date filtering on their search
      // endpoints; Exa, Firecrawl, and Parallel honor it.
      appliesTo: ['exa', 'firecrawl', 'parallel'],
    },
    {
      key: 'beforeDate',
      flag: 'before-date',
      type: 'string',
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      patternHint: 'Use YYYY-MM-DD (e.g. 2026-12-31).',
      placeholder: 'e.g. 2026-12-31',
      label: 'Before date',
      help: 'Only return results on or before this absolute date.',
      // Brave/Tavily lack date filtering; Parallel only supports a lower
      // bound. Only Exa and Firecrawl honor before-date.
      appliesTo: ['exa', 'firecrawl'],
    },
    {
      key: 'includeDomains',
      flag: 'include-domains',
      type: 'string',
      label: 'Include domains',
      help: 'Comma-separated allow-list — only return results from these domains.',
      placeholder: 'e.g. linkedin.com,github.com',
    },
    {
      key: 'excludeDomains',
      flag: 'exclude-domains',
      type: 'string',
      label: 'Exclude domains',
      help: 'Comma-separated block-list — drop results from these domains.',
      placeholder: 'e.g. pinterest.com,quora.com',
    },
    {
      key: 'includeContent',
      flag: 'include-content',
      type: 'bool',
      label: 'Inline page content',
      help: 'Inline full page content where supported.',
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  scrape: [
    ...baseShared,
    {
      key: 'urls',
      flag: 'urls',
      type: 'list-string',
      label: 'URLs to scrape',
      help: 'Default URLs scraped on every call. Repeatable.',
    },
    {
      key: 'format',
      flag: 'format',
      type: 'enum',
      enumValues: scrapeFormatEnum,
      label: 'Output format',
      help: 'markdown (default), text, or html.',
    },
    {
      key: 'query',
      flag: 'query',
      type: 'string',
      label: 'Reranking intent',
      help: 'Reranking query (Tavily reorders chunks against this).',
      appliesTo: ['tavily'],
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  answer: [
    ...baseShared,
    {
      key: 'query',
      flag: 'query',
      type: 'string',
      label: 'Query prefix',
      help: 'Text prepended to every runtime answer question.',
    },
    {
      key: 'maxCitations',
      flag: 'max-citations',
      type: 'number-int',
      label: 'Max citations',
      help: 'Cap citations included.',
    },
    {
      key: 'includeSearch',
      flag: 'include-search',
      type: 'bool',
      label: 'Include search results',
      help: 'Also return underlying search results alongside the answer.',
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  map: [
    ...baseShared,
    {
      key: 'url',
      flag: 'url',
      type: 'string',
      label: 'Default URL',
      help: 'Root URL used when no positional URL is given at runtime.',
    },
    {
      key: 'search',
      flag: 'search',
      type: 'string',
      label: 'Relevance query',
      help: 'Optional relevance ordering query (Firecrawl-only).',
      appliesTo: ['firecrawl'],
    },
    {
      key: 'limit',
      flag: 'limit',
      type: 'number-int',
      min: 1,
      label: 'URL limit',
      help: 'Max URLs returned (1 or more).',
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  crawl: [
    ...baseShared,
    {
      key: 'url',
      flag: 'url',
      type: 'string',
      label: 'Default URL',
      help: 'Root URL used when no positional URL is given at runtime.',
    },
    {
      key: 'maxPages',
      flag: 'max-pages',
      type: 'number-int',
      min: 1,
      label: 'Max pages',
      help: 'Cap pages crawled (1 or more).',
    },
    {
      key: 'maxDepth',
      flag: 'max-depth',
      type: 'number-int',
      min: 0,
      label: 'Max depth',
      help: 'Discovery depth (0 or more).',
    },
    {
      key: 'instructions',
      flag: 'instructions',
      type: 'string',
      label: 'Instructions',
      help: 'Natural-language guidance for the crawler agent. Concatenates with runtime --instructions. Tavily-only — doubles the per-call cost.',
      appliesTo: ['tavily'],
    },
    {
      key: 'includePaths',
      flag: 'include-paths',
      type: 'string',
      label: 'Include paths',
      help: 'Comma-separated regex include patterns.',
    },
    {
      key: 'excludePaths',
      flag: 'exclude-paths',
      type: 'string',
      label: 'Exclude paths',
      help: 'Comma-separated regex exclude patterns.',
    },
    {
      key: 'allowExternal',
      flag: 'allow-external',
      type: 'bool',
      label: 'Follow off-domain links',
      help: 'Default to following links outside the root domain.',
    },
    {
      key: 'wait',
      flag: 'wait',
      type: 'bool',
      label: 'Wait for completion',
      help: 'Block until the async crawl completes (default).',
    },
    {
      key: 'async',
      flag: 'async',
      type: 'bool',
      label: 'Return task id immediately',
      help: 'Submit and exit without polling.',
    },
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  research: [
    ...baseShared,
    {
      key: 'query',
      flag: 'query',
      type: 'string',
      label: 'Query prefix',
      help: 'Text prepended to every runtime research question.',
    },
    {
      key: 'depth',
      flag: 'depth',
      type: 'enum',
      enumValues: depthEnum,
      label: 'Research depth',
      help: 'basic, standard (default), or deep.',
    },
    {
      key: 'instructions',
      flag: 'instructions',
      type: 'string',
      label: 'Instructions',
      help: 'System instructions. Concatenates with runtime --instructions.',
    },
    {
      key: 'schema',
      flag: 'schema',
      type: 'string',
      label: 'JSON Schema (inline)',
      help: 'Inline JSON Schema for structured output.',
      group: 'structured-output',
    },
    {
      key: 'schemaFile',
      flag: 'schema-file',
      type: 'path',
      label: 'JSON Schema file',
      help: 'Path to a JSON Schema file.',
      group: 'structured-output',
    },
    {
      key: 'wait',
      flag: 'wait',
      type: 'bool',
      label: 'Wait for completion',
      help: 'Block until the research finishes (default).',
    },
    {
      key: 'async',
      flag: 'async',
      type: 'bool',
      label: 'Return task id immediately',
      help: 'Submit and exit without polling.',
    },
    {
      key: 'pollInterval',
      flag: 'poll-interval',
      type: 'string',
      label: 'Poll interval (s)',
      help: 'Single value or csv backoff steps (e.g. "5,10,30").',
    },
    {
      key: 'maxWait',
      flag: 'max-wait',
      type: 'number-int',
      min: 1,
      label: 'Max wait (s)',
      help: 'Total wait timeout in seconds. Default 900.',
    },
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  findall: [
    ...baseShared,
    {
      key: 'objective',
      flag: 'objective',
      type: 'string',
      label: 'Objective prefix',
      help: 'Text prepended to every runtime findall objective.',
    },
    {
      key: 'limit',
      flag: 'limit',
      type: 'number-int',
      min: 1,
      label: 'Item limit',
      help: 'Max items to find (1 or more).',
    },
    {
      key: 'entityType',
      flag: 'entity-type',
      type: 'string',
      label: 'Entity type',
      help: 'What kind of thing you\'re finding (e.g. "Person", "Company"). Required by Parallel.',
      appliesTo: ['parallel'],
    },
    {
      key: 'matchConditions',
      flag: 'match-conditions',
      type: 'string',
      label: 'Match conditions',
      help: 'JSON array of {name, description} predicates (Parallel-only — Exa auto-derives from the objective).',
      appliesTo: ['parallel'],
    },
    {
      key: 'schema',
      flag: 'schema',
      type: 'string',
      label: 'JSON Schema (inline)',
      help: 'Inline JSON Schema for items.',
      group: 'structured-output',
    },
    {
      key: 'schemaFile',
      flag: 'schema-file',
      type: 'path',
      label: 'JSON Schema file',
      help: 'Path to a JSON Schema file.',
      group: 'structured-output',
    },
    {
      key: 'wait',
      flag: 'wait',
      type: 'bool',
      label: 'Wait for completion',
      help: 'Block until findall finishes (default).',
    },
    {
      key: 'async',
      flag: 'async',
      type: 'bool',
      label: 'Return task id immediately',
      help: 'Submit and exit without polling.',
    },
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  enrich: [
    ...baseShared,
    {
      key: 'type',
      flag: 'type',
      type: 'enum',
      enumValues: enrichTypeEnum,
      label: 'Entity type',
      help: 'person or org.',
    },
    {
      key: 'email',
      flag: 'email',
      type: 'string',
      label: 'Email',
      help: 'Default email identifier (person mode).',
    },
    {
      key: 'emailHash',
      flag: 'email-hash',
      type: 'string',
      label: 'Email hash',
      help: 'MD5/SHA-256 of email.',
    },
    {
      key: 'linkedin',
      flag: 'linkedin',
      type: 'string',
      label: 'LinkedIn',
      help: 'LinkedIn URL or handle.',
    },
    {
      key: 'phone',
      flag: 'phone',
      type: 'string',
      label: 'Phone',
      help: 'Phone number (person).',
    },
    {
      key: 'name',
      flag: 'name',
      type: 'string',
      label: 'Full name',
      help: 'Person full name or org name.',
    },
    {
      key: 'firstName',
      flag: 'first-name',
      type: 'string',
      label: 'First name',
      help: 'Person first name.',
    },
    {
      key: 'lastName',
      flag: 'last-name',
      type: 'string',
      label: 'Last name',
      help: 'Person last name.',
    },
    {
      key: 'middleName',
      flag: 'middle-name',
      type: 'string',
      label: 'Middle name',
      help: 'Person middle name.',
    },
    {
      key: 'company',
      flag: 'company',
      type: 'string',
      label: 'Company',
      help: 'Employer name or domain (person).',
    },
    {
      key: 'domain',
      flag: 'domain',
      type: 'string',
      label: 'Domain',
      help: 'Company/org domain.',
    },
    {
      key: 'website',
      flag: 'website',
      type: 'string',
      label: 'Website',
      help: 'Org website.',
    },
    {
      key: 'ticker',
      flag: 'ticker',
      type: 'string',
      label: 'Ticker',
      help: 'Stock ticker (org).',
    },
    {
      key: 'providerId',
      flag: 'provider-id',
      type: 'string',
      label: 'Provider id',
      help: 'Stable provider id (Apollo id, PDL pdl_id).',
    },
    {
      key: 'minLikelihood',
      flag: 'min-likelihood',
      type: 'number-int',
      min: 1,
      label: 'Min likelihood',
      help: 'Reject results below this likelihood (1 or more).',
    },
    {
      key: 'require',
      flag: 'require',
      type: 'string',
      label: 'Required fields',
      help: 'Comma-separated fields the result must populate.',
    },
    {
      key: 'fields',
      flag: 'fields',
      type: 'string',
      label: 'Returned fields',
      help: 'Comma-separated fields to include in the response.',
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  lookup: [
    ...baseShared,
    {
      key: 'type',
      flag: 'type',
      type: 'enum',
      enumValues: lookupTypeEnum,
      label: 'Entity type',
      help: 'person, org, or email.',
    },
    {
      key: 'q',
      flag: 'q',
      type: 'string',
      label: 'Query',
      help: 'Free-form keyword query.',
    },
    {
      key: 'limit',
      flag: 'limit',
      type: 'number-int',
      min: 1,
      label: 'Result limit',
      help: 'Max results to return (1 or more).',
    },
    {
      key: 'cursor',
      flag: 'cursor',
      type: 'string',
      label: 'Pagination cursor',
      help: 'Opaque token from a prior response.',
    },
    {
      key: 'title',
      flag: 'title',
      type: 'string',
      label: 'Job title',
      help: 'Person title.',
    },
    {
      key: 'seniority',
      flag: 'seniority',
      type: 'string',
      label: 'Seniority',
      help: 'Person seniority level.',
    },
    {
      key: 'location',
      flag: 'location',
      type: 'string',
      label: 'Location',
      help: 'Geographic location.',
    },
    {
      key: 'domain',
      flag: 'domain',
      type: 'string',
      label: 'Company domain(s)',
      help: 'Comma-separated company domains.',
    },
    {
      key: 'company',
      flag: 'company',
      type: 'string',
      label: 'Company',
      help: 'Company name (alternative to --domain for emails).',
    },
    {
      key: 'industry',
      flag: 'industry',
      type: 'string',
      label: 'Industry',
      help: 'Industry filter.',
    },
    {
      key: 'employees',
      flag: 'employees',
      type: 'string',
      label: 'Employee range',
      help: 'min,max e.g. 100,500.',
    },
    {
      key: 'tech',
      flag: 'tech',
      type: 'string',
      label: 'Tech stack',
      help: 'Comma-separated tech tags (org).',
    },
    {
      key: 'emailType',
      flag: 'email-type',
      type: 'string',
      label: 'Email type',
      help: 'personal or generic (email lookup).',
    },
    {
      key: 'department',
      flag: 'department',
      type: 'string',
      label: 'Department',
      help: 'Department filter (email lookup).',
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],

  verify: [
    ...baseShared,
    {
      key: 'email',
      flag: 'email',
      type: 'string',
      label: 'Default email',
      help: 'Email used when no positional email is given at runtime.',
    },
    ...sharedCacheControl,
    {
      key: 'raw',
      flag: 'raw',
      type: 'bool',
      label: 'Raw provider response',
      help: 'Skip normalization — emit the provider\'s native response shape under a `raw` key. Useful for debugging or when you need provider-specific fields the normalized envelope drops.',
    },
    ...sharedOutput,
  ],
};

/** Look up a single field descriptor by mode + key. */
export function getFieldDescriptor(mode: PresetMode, key: string): FieldDescriptor | undefined {
  return MODE_FIELDS[mode].find((f) => f.key === key);
}
