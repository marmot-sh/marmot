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

export type UpsertOptions = {
  /** When false (default), refuse to overwrite an existing preset. */
  overwrite?: boolean;
};

export async function upsertPreset(
  name: string,
  preset: Preset,
  options: UpsertOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<MarmotConfig> {
  validatePresetName(name);
  const validatedPreset = presetSchema.parse(preset);
  const existing = (await readMarmotConfig(env)) ?? { version: 1 as const };
  const presets = { ...(existing.presets ?? {}) };

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
 * Merge a preset's saved values into a CLI options object. Existing
 * (explicit) option values always win; preset values only fill `undefined`
 * slots. The `mode` discriminator is dropped so it never collides with
 * subcommand options.
 */
export function applyPreset<T extends Record<string, unknown>>(
  preset: Preset,
  options: T,
): T {
  const out: Record<string, unknown> = { ...options };
  for (const [key, value] of Object.entries(preset)) {
    if (key === 'mode') continue;
    if (value === undefined) continue;
    if (out[key] === undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export function presetMode(preset: Preset): PresetMode {
  return preset.mode;
}
