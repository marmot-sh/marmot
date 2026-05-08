import {
  AICliError,
  applyPreset,
  getPreset,
  type PresetMode,
} from '@marmot-sh/core';

/** When a preset is applied, also attach its stable id to options so call
 *  sites can pass `preset_id` into recordUsage/recordCall without a second
 *  lookup. The slug stays available at `options.preset`. */
export async function withPreset<T extends { preset?: string; preset_id?: string }>(
  options: T,
  expectedMode: PresetMode,
): Promise<T> {
  if (!options.preset) return options;
  const preset = await getPreset(options.preset);
  if (preset.mode !== expectedMode) {
    throw new AICliError(
      'validation',
      `Preset "${options.preset}" has mode "${preset.mode}", but this command requires "${expectedMode}".`,
    );
  }
  const merged = applyPreset(preset, options) as T & { preset_id?: string };
  merged.preset_id = preset.preset_id;
  return merged;
}
