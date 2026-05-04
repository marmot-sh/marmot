import { AICliError } from '../lib/errors.js';
import type { ProviderImageGenerateResult } from '../types.js';

export type BinaryWriter = {
  write(chunk: Uint8Array): boolean;
};

export function renderImageBinaryOutput(
  result: ProviderImageGenerateResult,
  writer: BinaryWriter,
): void {
  if (result.images.length === 0) {
    throw new AICliError(
      'provider',
      'Provider returned no images to render.',
    );
  }
  if (result.images.length > 1) {
    // Schema layer should prevent this, but defend at runtime in case
    // an adapter ignores --n.
    throw new AICliError(
      'validation',
      '--binary supports a single image. Use --output ./out-{i}.png for batches.',
    );
  }

  writer.write(result.images[0]!.data);
}
