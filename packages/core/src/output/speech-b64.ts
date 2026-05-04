import { Buffer } from 'node:buffer';

import type {
  NormalizedSpeechRunResult,
  ProviderSpeechResult,
} from '../types.js';

const MIME_TO_EXT: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
};

function extensionFor(mimeType: string, formatHint?: string): string {
  if (formatHint) return formatHint.toLowerCase();
  return MIME_TO_EXT[mimeType.toLowerCase()] ?? 'mp3';
}

export type RenderSpeechB64Context = {
  result: ProviderSpeechResult;
  formatHint?: string;
  now: () => Date;
};

export function renderSpeechB64Output(
  context: RenderSpeechB64Context,
): NormalizedSpeechRunResult {
  const ext = extensionFor(context.result.audio.mimeType, context.formatHint);
  return {
    ok: true,
    provider: context.result.provider,
    model: context.result.model,
    audio: {
      b64: Buffer.from(context.result.audio.data).toString('base64'),
      format: ext,
      voice: context.result.voice,
      bytes: context.result.audio.data.byteLength,
    },
    usage: context.result.usage,
    cachedModelValidated: true,
    timestamp: context.now().toISOString(),
  };
}

export function renderSpeechB64EnvelopeJson(
  result: NormalizedSpeechRunResult,
): string {
  return JSON.stringify(result, null, 2);
}
