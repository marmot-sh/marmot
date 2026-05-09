import {
  AICliError,
  PRESET_MODES,
  deletePreset,
  getPreset,
  listPresets,
  presetSchema,
  renamePreset,
  upsertPreset,
  validatePresetName,
  writeLine,
  type OutputWriter,
  type Preset,
  type PresetMode,
} from '@marmot-sh/core';

export type PresetCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

export type PresetWriteOptions = {
  mode?: string;
  // shared
  provider?: string;
  model?: string;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  session?: string;
  promptFile?: string;
  // text
  system?: string;
  systemFile?: string;
  schema?: string;
  schemaFile?: string;
  schemaModule?: string;
  temperature?: string | number;
  maxTokens?: string | number;
  topP?: string | number;
  seed?: string | number;
  stop?: string[];
  reasoning?: string;
  providerOption?: string[];
  stream?: boolean;
  json?: boolean;
  // image
  size?: string;
  quality?: string;
  style?: string;
  negative?: string;
  n?: string | number;
  binary?: boolean;
  b64?: boolean;
  preview?: boolean;
  // speech
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
  play?: boolean;
  // transcription
  language?: string;
  prompt?: string;
  // video
  aspect?: string;
  resolution?: string;
  duration?: string | number;
  fps?: string | number;
  audio?: boolean;
  // web/data shared
  limit?: string | number;
  depth?: string;
  url?: string;
  urls?: string[];
  objective?: string;
  cache?: boolean;
  refresh?: boolean;
  raw?: boolean;
  wait?: boolean;
  async?: boolean;
  // search
  freshness?: string;
  afterDate?: string;
  beforeDate?: string;
  includeDomains?: string;
  excludeDomains?: string;
  includeContent?: boolean;
  // answer
  maxCitations?: string | number;
  includeSearch?: boolean;
  // scrape
  query?: string;
  // map
  search?: string;
  // crawl
  maxPages?: string | number;
  maxDepth?: string | number;
  includePaths?: string;
  excludePaths?: string;
  allowExternal?: boolean;
  // research
  pollInterval?: string;
  maxWait?: string | number;
  // findall
  entityType?: string;
  matchConditions?: string;
  // enrich
  type?: string;
  minLikelihood?: string | number;
  require?: string;
  fields?: string;
};

function parseIntField(name: string, value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new AICliError('validation', `--${name} must be an integer.`);
  }
  return n;
}

function parseFloatField(name: string, value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    throw new AICliError('validation', `--${name} must be a number.`);
  }
  return n;
}

/** Drop empty arrays from preset payloads — commander gives us `[]` when
 *  a repeatable flag wasn't passed, but `[]` would store as a meaningful
 *  empty value that overrides defaults. Treat absence as undefined. */
function nonEmptyArray(arr: string[] | undefined): string[] | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr;
}

function buildPresetFromFlags(mode: PresetMode, opts: PresetWriteOptions): Preset {
  const base = {
    mode,
    provider: opts.provider,
    model: opts.model,
    retries: parseIntField('retries', opts.retries),
    timeout: parseIntField('timeout', opts.timeout),
  };

  let candidate: Record<string, unknown>;
  switch (mode) {
    case 'text':
      candidate = {
        ...base,
        promptFile: opts.promptFile,
        system: opts.system,
        systemFile: opts.systemFile,
        schema: opts.schema,
        schemaFile: opts.schemaFile,
        schemaModule: opts.schemaModule,
        temperature: parseFloatField('temperature', opts.temperature),
        maxTokens: parseIntField('max-tokens', opts.maxTokens),
        topP: parseFloatField('top-p', opts.topP),
        seed: parseIntField('seed', opts.seed),
        stop: nonEmptyArray(opts.stop),
        reasoning: opts.reasoning,
        providerOption: nonEmptyArray(opts.providerOption),
        output: opts.output,
        stream: opts.stream,
        json: opts.json,
        session: opts.session,
      };
      break;
    case 'image':
      candidate = {
        ...base,
        promptFile: opts.promptFile,
        size: opts.size,
        quality: opts.quality,
        style: opts.style,
        seed: parseIntField('seed', opts.seed),
        negative: opts.negative,
        providerOption: nonEmptyArray(opts.providerOption),
        n: parseIntField('n', opts.n),
        output: opts.output,
        binary: opts.binary,
        b64: opts.b64,
        preview: opts.preview,
        session: opts.session,
      };
      break;
    case 'speech':
      candidate = {
        ...base,
        promptFile: opts.promptFile,
        voice: opts.voice,
        format: opts.format,
        speed: parseFloatField('speed', opts.speed),
        instructions: opts.instructions,
        providerOption: nonEmptyArray(opts.providerOption),
        output: opts.output,
        binary: opts.binary,
        b64: opts.b64,
        play: opts.play,
        wait: opts.wait,
        session: opts.session,
      };
      break;
    case 'transcription':
      candidate = {
        ...base,
        language: opts.language,
        format: opts.format,
        prompt: opts.prompt,
        providerOption: nonEmptyArray(opts.providerOption),
        output: opts.output,
        session: opts.session,
      };
      break;
    case 'video':
      candidate = {
        ...base,
        promptFile: opts.promptFile,
        aspect: opts.aspect,
        resolution: opts.resolution,
        duration: parseIntField('duration', opts.duration),
        fps: parseIntField('fps', opts.fps),
        audio: opts.audio,
        n: parseIntField('n', opts.n),
        seed: parseIntField('seed', opts.seed),
        providerOption: nonEmptyArray(opts.providerOption),
        output: opts.output,
        binary: opts.binary,
        b64: opts.b64,
        session: opts.session,
      };
      break;
    case 'search':
      // search has no model field — drop it from base.
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        query: opts.query,
        limit: parseIntField('limit', opts.limit),
        depth: opts.depth,
        freshness: opts.freshness,
        afterDate: opts.afterDate,
        beforeDate: opts.beforeDate,
        includeDomains: opts.includeDomains,
        excludeDomains: opts.excludeDomains,
        includeContent: opts.includeContent,
        cache: opts.cache,
        refresh: opts.refresh,
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'scrape':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        urls: nonEmptyArray(opts.urls),
        format: opts.format,
        query: opts.query,
        cache: opts.cache,
        refresh: opts.refresh,
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'answer':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        query: opts.query,
        maxCitations: parseIntField('max-citations', opts.maxCitations),
        includeSearch: opts.includeSearch,
        cache: opts.cache,
        refresh: opts.refresh,
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'map':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        url: opts.url,
        search: opts.search,
        limit: parseIntField('limit', opts.limit),
        cache: opts.cache,
        refresh: opts.refresh,
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'crawl':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        url: opts.url,
        maxPages: parseIntField('max-pages', opts.maxPages),
        maxDepth: parseIntField('max-depth', opts.maxDepth),
        instructions: opts.instructions,
        includePaths: opts.includePaths,
        excludePaths: opts.excludePaths,
        allowExternal: opts.allowExternal,
        wait: opts.wait,
        async: opts.async,
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'research':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        query: opts.query,
        depth: opts.depth,
        schema: opts.schema,
        schemaFile: opts.schemaFile,
        instructions: opts.instructions,
        wait: opts.wait,
        async: opts.async,
        pollInterval: opts.pollInterval,
        maxWait: parseIntField('max-wait', opts.maxWait),
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'findall':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        objective: opts.objective,
        limit: parseIntField('limit', opts.limit),
        schema: opts.schema,
        schemaFile: opts.schemaFile,
        entityType: opts.entityType,
        matchConditions: opts.matchConditions,
        wait: opts.wait,
        async: opts.async,
        output: opts.output,
        raw: opts.raw,
        session: opts.session,
      };
      break;
    case 'enrich':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        type: opts.type,
        minLikelihood: parseIntField('min-likelihood', opts.minLikelihood),
        require: opts.require,
        fields: opts.fields,
      };
      break;
    case 'lookup':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
        type: opts.type,
        limit: parseIntField('limit', opts.limit),
      };
      break;
    case 'verify':
      candidate = {
        mode,
        provider: opts.provider,
        retries: parseIntField('retries', opts.retries),
        timeout: parseIntField('timeout', opts.timeout),
      };
      break;
  }

  // Strip undefined keys so zod's strict() unions match cleanly.
  for (const k of Object.keys(candidate)) {
    if (candidate[k] === undefined) delete candidate[k];
  }

  const parsed = presetSchema.safeParse(candidate);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    throw new AICliError('validation', `Invalid preset: ${detail}.`);
  }
  return parsed.data;
}

function assertMode(value: string | undefined): PresetMode {
  if (!value) {
    throw new AICliError(
      'validation',
      `--mode is required. One of: ${PRESET_MODES.join(', ')}.`,
    );
  }
  if (!PRESET_MODES.includes(value as PresetMode)) {
    throw new AICliError(
      'validation',
      `Unknown mode "${value}". One of: ${PRESET_MODES.join(', ')}.`,
    );
  }
  return value as PresetMode;
}

export async function handlePresetCreate(
  name: string,
  options: PresetWriteOptions,
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  validatePresetName(name);
  const mode = assertMode(options.mode);
  const preset = buildPresetFromFlags(mode, options);

  await upsertPreset(name, preset, { overwrite: false }, env);
  // Read back so the JSON output reflects the persisted preset including
  // the auto-assigned preset_id.
  const stored = await getPreset(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'create', name, preset: stored }, null, 2));
}

export async function handlePresetUpdate(
  name: string,
  options: PresetWriteOptions,
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  validatePresetName(name);
  const existing = await getPreset(name, env);

  // Mode changes require delete + create. Reject here so users don't end up
  // with a preset that has fields belonging to two different modes.
  if (options.mode && options.mode !== existing.mode) {
    throw new AICliError(
      'validation',
      `Cannot change mode of preset "${name}" from "${existing.mode}" to "${options.mode}". Delete and recreate it instead.`,
    );
  }

  // Build a patch using only flags the user supplied; merge over existing.
  const patch = buildPresetFromFlags(existing.mode, {
    ...options,
    mode: existing.mode,
  });
  const merged = { ...existing, ...patch } as Preset;

  await upsertPreset(name, merged, { overwrite: true }, env);
  const stored = await getPreset(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'update', name, preset: stored }, null, 2));
}

export async function handlePresetDelete(
  name: string,
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  validatePresetName(name);
  const removed = await deletePreset(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'delete', name, removed }, null, 2));
}

export async function handlePresetRename(
  oldName: string,
  newName: string,
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const result = await renamePreset(oldName, newName, env);
  writeLine(
    stdout,
    JSON.stringify(
      {
        ok: true,
        action: 'rename',
        from: result.from,
        to: result.to,
        preset_id: result.preset.preset_id,
      },
      null,
      2,
    ),
  );
}

export async function handlePresetList(
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const presets = await listPresets(env);
  const names = Object.keys(presets).sort();
  const summary = names.map((name) => {
    const p = presets[name]!;
    return {
      name,
      mode: p.mode,
      provider: p.provider,
      // Only AI presets carry a model field; web/data presets don't.
      model: 'model' in p ? p.model : undefined,
    };
  });
  writeLine(stdout, JSON.stringify({ presets: summary }, null, 2));
}

export async function handlePresetShow(
  name: string,
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const preset = await getPreset(name, env);
  writeLine(stdout, JSON.stringify({ name, preset }, null, 2));
}
