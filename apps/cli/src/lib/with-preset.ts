import {
  AICliError,
  applyPreset,
  getPreset,
  type PresetMode,
} from '@marmot-sh/core';

export async function withPreset<T extends { preset?: string }>(
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
  return applyPreset(preset, options);
}
