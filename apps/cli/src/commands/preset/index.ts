import {
  AICliError,
  PRESET_MODES,
  deletePreset,
  getPreset,
  listPresets,
  presetSchema,
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
  // speech
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
  // transcription
  language?: string;
  prompt?: string;
  // video
  aspect?: string;
  resolution?: string;
  duration?: string | number;
  fps?: string | number;
  audio?: boolean;
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
        stream: opts.stream,
        json: opts.json,
      };
      break;
    case 'image':
      candidate = {
        ...base,
        size: opts.size,
        quality: opts.quality,
        style: opts.style,
        seed: parseIntField('seed', opts.seed),
        negative: opts.negative,
        providerOption: nonEmptyArray(opts.providerOption),
        n: parseIntField('n', opts.n),
      };
      break;
    case 'speech':
      candidate = {
        ...base,
        voice: opts.voice,
        format: opts.format,
        speed: parseFloatField('speed', opts.speed),
        instructions: opts.instructions,
        providerOption: nonEmptyArray(opts.providerOption),
      };
      break;
    case 'transcription':
      candidate = {
        ...base,
        language: opts.language,
        format: opts.format,
        prompt: opts.prompt,
        providerOption: nonEmptyArray(opts.providerOption),
      };
      break;
    case 'video':
      candidate = {
        ...base,
        aspect: opts.aspect,
        resolution: opts.resolution,
        duration: parseIntField('duration', opts.duration),
        fps: parseIntField('fps', opts.fps),
        audio: opts.audio,
        n: parseIntField('n', opts.n),
        seed: parseIntField('seed', opts.seed),
        providerOption: nonEmptyArray(opts.providerOption),
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
  writeLine(stdout, JSON.stringify({ ok: true, action: 'create', name, preset }, null, 2));
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
  writeLine(stdout, JSON.stringify({ ok: true, action: 'update', name, preset: merged }, null, 2));
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

export async function handlePresetList(
  dependencies: PresetCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const presets = await listPresets(env);
  const names = Object.keys(presets).sort();
  const summary = names.map((name) => {
    const p = presets[name]!;
    return { name, mode: p.mode, provider: p.provider, model: p.model };
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
