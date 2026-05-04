import { Buffer } from 'node:buffer';

import type {
  NormalizedImageRunResult,
  ProviderImageGenerateResult,
} from '../types.js';

const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extensionFor(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'png';
}

export type RenderImageB64Context = {
  result: ProviderImageGenerateResult;
  requestedSize?: string;
  now: () => Date;
};

export function renderImageB64Output(
  context: RenderImageB64Context,
): NormalizedImageRunResult {
  return {
    ok: true,
    provider: context.result.provider,
    model: context.result.model,
    images: context.result.images.map((image) => ({
      b64: Buffer.from(image.data).toString('base64'),
      format: extensionFor(image.mimeType),
      size: context.requestedSize ?? null,
      bytes: image.data.byteLength,
    })),
    usage: context.result.usage,
    finishReason: context.result.finishReason,
    cachedModelValidated: true,
    timestamp: context.now().toISOString(),
  };
}

export function renderImageB64EnvelopeJson(
  result: NormalizedImageRunResult,
): string {
  return JSON.stringify(result, null, 2);
}
