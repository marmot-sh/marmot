import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ProviderSlug } from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';
import type {
  NormalizedVideoRunResult,
  ProviderVideoGenerateResult,
} from '../types.js';

const MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

function extensionFor(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'mp4';
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
  index: number,
  total: number,
  cwd: string,
): string {
  const suffix = total > 1 ? `-${index + 1}` : '';
  return resolve(cwd, `${provider}-video-${timestamp}${suffix}.${ext}`);
}

function expandTemplate(
  template: string,
  index: number,
  total: number,
  cwd: string,
): string {
  const replaced = template.replace(/\{i\}/g, String(index + 1));
  if (total > 1 && replaced === template) {
    throw new AICliError(
      'validation',
      'When --n > 1, --output must include the {i} placeholder (e.g. ./out-{i}.mp4).',
    );
  }
  return isAbsolute(replaced) ? replaced : resolve(cwd, replaced);
}

export type RenderVideoContext = {
  result: ProviderVideoGenerateResult;
  outputPath?: string;
  provider: ProviderSlug;
  cwd?: string;
  now: () => Date;
};

export async function renderVideoFileOutput(
  context: RenderVideoContext,
): Promise<NormalizedVideoRunResult> {
  const cwd = context.cwd ?? process.cwd();
  const total = context.result.videos.length;
  const stamp = timestampFor(context.now());

  const written: NormalizedVideoRunResult['videos'] = [];

  for (let i = 0; i < total; i += 1) {
    const clip = context.result.videos[i]!;
    const ext = extensionFor(clip.mimeType);
    const path = context.outputPath
      ? expandTemplate(context.outputPath, i, total, cwd)
      : defaultPathFor(context.provider, stamp, ext, i, total, cwd);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, clip.data);

    written.push({
      path,
      format: ext,
      bytes: clip.data.byteLength,
    });
  }

  return {
    ok: true,
    provider: context.result.provider,
    model: context.result.model,
    videos: written,
    usage: context.result.usage,
    finishReason: context.result.finishReason,
    cachedModelValidated: true,
    timestamp: context.now().toISOString(),
  };
}

export function renderVideoFileEnvelopeJson(
  result: NormalizedVideoRunResult,
): string {
  return JSON.stringify(result, null, 2);
}

export function renderVideoBinaryOutput(
  result: ProviderVideoGenerateResult,
  stdout: { write: (chunk: Uint8Array) => boolean | void },
): void {
  if (result.videos.length === 0) {
    throw new AICliError('provider', 'Provider returned no video output.');
  }
  stdout.write(result.videos[0]!.data);
}
