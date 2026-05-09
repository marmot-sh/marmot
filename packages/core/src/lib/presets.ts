import { randomUUID } from 'node:crypto';

import { AICliError } from './errors.js';
import { readMarmotConfig, writeMarmotConfig } from './config.js';
import {
  PRESET_NAME_REGEX,
  marmotConfigSchema,
  presetSchema,
  type MarmotConfig,
  type Preset,
  type PresetMode,
} from '../schemas/config.js';

/** Input shape for `upsertPreset`. Distributes Omit over the discriminated
 *  union so each mode allows omitting `preset_id`. The helper auto-assigns
 *  one when missing. */
type DistributiveOmit<T, K extends PropertyKey> = T extends T ? Omit<T, K> : never;
export type PresetInput = DistributiveOmit<Preset, 'preset_id'> & { preset_id?: string };

export function validatePresetName(name: string): void {
  if (!PRESET_NAME_REGEX.test(name)) {
    throw new AICliError(
      'validation',
      `Invalid preset name "${name}". Names must be lowercase letters/digits with single - or _ separators (no leading, trailing, or consecutive separators).`,
    );
  }
}

export async function listPresets(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, Preset>> {
  const config = await readMarmotConfig(env);
  return config?.presets ?? {};
}

export async function getPreset(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Preset> {
  validatePresetName(name);
  const presets = await listPresets(env);
  const preset = presets[name];
  if (!preset) {
    throw new AICliError(
      'validation',
      `Preset "${name}" not found. Run "marmot preset list" to see available presets.`,
    );
  }
  return preset;
}

/**
 * Look up a preset by its stable id rather than its slug. Used by the
 * display layer to resolve `preset_id` (stored on session metadata and
 * usage records) to the preset's current slug at render time.
 *
 * Returns `null` for an unknown id (preset was deleted, or the id was
 * captured before this lookup existed).
 */
export async function getPresetById(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ slug: string; preset: Preset } | null> {
  const presets = await listPresets(env);
  for (const [slug, preset] of Object.entries(presets)) {
    if (preset.preset_id === id) {
      return { slug, preset };
    }
  }
  return null;
}

export type UpsertOptions = {
  /** When false (default), refuse to overwrite an existing preset. */
  overwrite?: boolean;
};

export async function upsertPreset(
  name: string,
  preset: PresetInput,
  options: UpsertOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<MarmotConfig> {
  validatePresetName(name);
  // Auto-assign preset_id if the caller didn't provide one. Existing
  // presets being overwritten preserve their original id (stable across
  // renames/edits).
  const existing = (await readMarmotConfig(env)) ?? { version: 1 as const };
  const presets = { ...(existing.presets ?? {}) };
  const inputId = preset.preset_id ?? presets[name]?.preset_id ?? randomUUID();
  const validatedPreset = presetSchema.parse({ ...preset, preset_id: inputId } as Preset);

  if (presets[name] && !options.overwrite) {
    throw new AICliError(
      'validation',
      `Preset "${name}" already exists. Pass { overwrite: true } or use the update command.`,
    );
  }

  presets[name] = validatedPreset;
  const merged = marmotConfigSchema.parse({ ...existing, presets });
  await writeMarmotConfig(merged, env);
  return merged;
}

/**
 * Rename a preset by changing its config map key. The preset_id stays
 * stable, so any session metadata or usage records referencing it by id
 * are unaffected. Validates that the new slug is well-formed and not
 * already taken.
 */
export async function renamePreset(
  oldSlug: string,
  newSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ from: string; to: string; preset: Preset }> {
  validatePresetName(oldSlug);
  validatePresetName(newSlug);

  if (oldSlug === newSlug) {
    throw new AICliError('validation', `Old and new preset names are identical ("${oldSlug}").`);
  }

  const existing = await readMarmotConfig(env);
  const presets = existing?.presets;
  if (!presets || !presets[oldSlug]) {
    throw new AICliError(
      'validation',
      `Preset "${oldSlug}" not found. Run "marmot preset list" to see available presets.`,
    );
  }
  if (presets[newSlug]) {
    throw new AICliError(
      'validation',
      `Preset "${newSlug}" already exists. Pick a different name or "marmot preset delete ${newSlug}" first.`,
    );
  }

  const preset = presets[oldSlug];
  const next = { ...presets, [newSlug]: preset };
  delete next[oldSlug];

  const merged = marmotConfigSchema.parse({ ...existing, presets: next });
  await writeMarmotConfig(merged, env);
  return { from: oldSlug, to: newSlug, preset };
}

export async function deletePreset(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  validatePresetName(name);
  const existing = await readMarmotConfig(env);
  if (!existing?.presets?.[name]) return false;

  const presets = { ...existing.presets };
  delete presets[name];
  const merged = marmotConfigSchema.parse({ ...existing, presets });
  await writeMarmotConfig(merged, env);
  return true;
}

/**
 * Per-field merge rule. Default for any unlisted field is `scalar`
 * (CLI replaces preset). Lists explicitly opted into `list-append` (file,
 * image, stop, urls). Text fields where compositional intent is the rule
 * (preset establishes baseline, runtime adds context) opt into `concat`.
 *
 * Field names overlap across modes (`prompt` in run is positional text;
 * `prompt` in transcribe is a bias hint), so the registry is keyed by
 * mode → field name.
 */
type MergeRule = 'scalar' | 'list-append' | 'concat';

const MERGE_RULE_OVERRIDES: Partial<Record<PresetMode, Record<string, MergeRule>>> = {
  text: {
    system: 'concat',
    prompt: 'concat',
    file: 'list-append',
    image: 'list-append',
    stop: 'list-append',
  },
  image: {
    prompt: 'concat',
  },
  speech: {
    text: 'concat',
  },
  transcription: {
    prompt: 'concat',
  },
  video: {
    prompt: 'concat',
    image: 'list-append',
  },
  search: {
    query: 'concat',
  },
  scrape: {
    urls: 'list-append',
  },
  answer: {
    query: 'concat',
  },
  crawl: {
    instructions: 'concat',
  },
  research: {
    query: 'concat',
    instructions: 'concat',
  },
  findall: {
    objective: 'concat',
  },
};

function mergeText(presetText: unknown, optionsText: unknown): string | undefined {
  const a = typeof presetText === 'string' ? presetText : '';
  const b = typeof optionsText === 'string' ? optionsText : '';
  if (a && b) return `${a}\n\n${b}`;
  if (a) return a;
  if (b) return b;
  return undefined;
}

function mergeList(presetList: unknown, optionsList: unknown): unknown[] {
  const a = Array.isArray(presetList) ? presetList : [];
  const b = Array.isArray(optionsList) ? optionsList : [];
  return [...a, ...b];
}

/**
 * Merge a preset's saved values into a CLI options object.
 *
 * Per-field merge rule (looked up via {@link MERGE_RULE_OVERRIDES}):
 * - `scalar` (default): CLI wins if defined; preset fills undefined slots.
 * - `list-append`: preset list + CLI list, in that order.
 * - `concat`: both string values, joined with `\n\n`. Either side alone
 *   passes through.
 *
 * The `mode` discriminator and `preset_id` are dropped so they never
 * collide with subcommand options.
 */
export function applyPreset<T extends Record<string, unknown>>(
  preset: PresetInput | Preset,
  options: T,
): T {
  const out: Record<string, unknown> = { ...options };
  const overrides = MERGE_RULE_OVERRIDES[preset.mode] ?? {};
  for (const [key, value] of Object.entries(preset)) {
    if (key === 'mode' || key === 'preset_id') continue;
    if (value === undefined) continue;
    const rule: MergeRule = overrides[key] ?? 'scalar';
    if (rule === 'list-append') {
      out[key] = mergeList(value, out[key]);
    } else if (rule === 'concat') {
      const merged = mergeText(value, out[key]);
      if (merged !== undefined) out[key] = merged;
    } else {
      // scalar: CLI wins if defined.
      if (out[key] === undefined) out[key] = value;
    }
  }
  return out as T;
}

export function presetMode(preset: Preset): PresetMode {
  return preset.mode;
}
