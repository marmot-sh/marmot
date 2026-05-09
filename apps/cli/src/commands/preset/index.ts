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

import { MODE_FIELDS, type FieldDescriptor } from './field-descriptors.js';

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
  // enrich identifiers
  email?: string;
  emailHash?: string;
  linkedin?: string;
  phone?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  company?: string;
  providerId?: string;
  domain?: string;
  website?: string;
  ticker?: string;
  // lookup filters
  q?: string;
  cursor?: string;
  title?: string;
  seniority?: string;
  location?: string;
  industry?: string;
  employees?: string;
  tech?: string;
  emailType?: string;
  department?: string;
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

/**
 * Apply a single field descriptor: read the matching key off `opts`, parse
 * per its type, and write to the candidate object. Empty arrays from
 * Commander default to `[]` for repeatable flags — we treat absence as
 * undefined (via nonEmptyArray) so they don't fight schema defaults.
 */
function applyDescriptor(
  desc: FieldDescriptor,
  opts: PresetWriteOptions,
  candidate: Record<string, unknown>,
): void {
  const value = (opts as Record<string, unknown>)[desc.key];
  if (value === undefined) return;

  switch (desc.type) {
    case 'number-int':
      candidate[desc.key] = parseIntField(desc.flag, value as string | number);
      break;
    case 'number-float':
      candidate[desc.key] = parseFloatField(desc.flag, value as string | number);
      break;
    case 'list-string': {
      const arr = nonEmptyArray(value as string[] | undefined);
      if (arr !== undefined) candidate[desc.key] = arr;
      break;
    }
    case 'string':
    case 'path':
    case 'enum':
    case 'bool':
    default:
      candidate[desc.key] = value;
  }
}

function buildPresetFromFlags(mode: PresetMode, opts: PresetWriteOptions): Preset {
  const candidate: Record<string, unknown> = { mode };
  for (const desc of MODE_FIELDS[mode]) {
    applyDescriptor(desc, opts, candidate);
  }
  // Drop empties so zod's strict() unions match cleanly.
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
