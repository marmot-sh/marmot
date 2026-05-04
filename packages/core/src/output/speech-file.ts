import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ProviderSlug } from '../lib/constants.js';
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

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function timestampFor(date: Date): string {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds()),
  ].join('');
}

function defaultPathFor(
  provider: ProviderSlug,
  timestamp: string,
  ext: string,
  cwd: string,
): string {
  return resolve(cwd, `speak-${provider}-${timestamp}.${ext}`);
}

export type RenderSpeechFileContext = {
  result: ProviderSpeechResult;
  formatHint?: string;
  outputPath?: string;
  provider: ProviderSlug;
  cwd?: string;
  now: () => Date;
};

export async function renderSpeechFileOutput(
  context: RenderSpeechFileContext,
): Promise<NormalizedSpeechRunResult> {
  const cwd = context.cwd ?? process.cwd();
  const ext = extensionFor(context.result.audio.mimeType, context.formatHint);
  const stamp = timestampFor(context.now());

  const path = context.outputPath
    ? (isAbsolute(context.outputPath)
        ? context.outputPath
        : resolve(cwd, context.outputPath))
    : defaultPathFor(context.result.provider, stamp, ext, cwd);

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, context.result.audio.data);

  return {
    ok: true,
    provider: context.result.provider,
    model: context.result.model,
    audio: {
      path,
      format: ext,
      voice: context.result.voice,
      bytes: context.result.audio.data.byteLength,
    },
    usage: context.result.usage,
    cachedModelValidated: true,
    timestamp: context.now().toISOString(),
  };
}

export function renderSpeechFileEnvelopeJson(
  result: NormalizedSpeechRunResult,
): string {
  return JSON.stringify(result, null, 2);
}
