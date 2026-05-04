import { AICliError } from '../lib/errors.js';
import type { ProviderSpeechResult } from '../types.js';

export type BinaryWriter = {
  write(chunk: Uint8Array): boolean;
};

export function renderSpeechBinaryOutput(
  result: ProviderSpeechResult,
  writer: BinaryWriter,
): void {
  if (!result.audio.data || result.audio.data.byteLength === 0) {
    throw new AICliError('provider', 'Provider returned no audio bytes.');
  }
  writer.write(result.audio.data);
}
