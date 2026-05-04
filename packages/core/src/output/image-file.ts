import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import type { ProviderSlug } from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';
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
  return resolve(cwd, `${provider}-${timestamp}${suffix}.${ext}`);
}

function expandTemplate(
  template: string,
  index: number,
  total: number,
  cwd: string,
): string {
  // {i} is 1-based for n>1; for n=1 we substitute "1" but most users will
  // omit the template and provide a literal path.
  const replaced = template.replace(/\{i\}/g, String(index + 1));
  if (total > 1 && replaced === template) {
    throw new AICliError(
      'validation',
      'When --n > 1, --output must include the {i} placeholder (e.g. ./out-{i}.png).',
    );
  }
  return isAbsolute(replaced) ? replaced : resolve(cwd, replaced);
}

export type RenderImageContext = {
  result: ProviderImageGenerateResult;
  requestedSize?: string;
  outputPath?: string;
  provider: ProviderSlug;
  cwd?: string;
  now: () => Date;
};

export async function renderImageFileOutput(
  context: RenderImageContext,
): Promise<NormalizedImageRunResult> {
  const cwd = context.cwd ?? process.cwd();
  const total = context.result.images.length;
  const stamp = timestampFor(context.now());

  const written: NormalizedImageRunResult['images'] = [];

  for (let i = 0; i < total; i += 1) {
    const image = context.result.images[i]!;
    const ext = extensionFor(image.mimeType);
    const path = context.outputPath
      ? expandTemplate(context.outputPath, i, total, cwd)
      : defaultPathFor(context.provider, stamp, ext, i, total, cwd);

    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, image.data);

    written.push({
      path,
      format: ext,
      size: context.requestedSize ?? null,
      bytes: image.data.byteLength,
    });
  }

  return {
    ok: true,
    provider: context.result.provider,
    model: context.result.model,
    images: written,
    usage: context.result.usage,
    finishReason: context.result.finishReason,
    cachedModelValidated: true,
    timestamp: context.now().toISOString(),
  };
}

export function renderImageFileEnvelopeJson(
  result: NormalizedImageRunResult,
): string {
  return JSON.stringify(result, null, 2);
}
