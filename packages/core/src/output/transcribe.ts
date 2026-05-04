import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import type {
  NormalizedTranscribeRunResult,
  ProviderTranscribeResult,
} from '../types.js';
import type { TranscribeFormat } from '../schemas/transcription.js';

export type RenderTranscribeContext = {
  result: ProviderTranscribeResult;
  format: TranscribeFormat;
  textOnly: boolean;
  outputPath?: string;
  cwd?: string;
  now: () => Date;
};

export type RenderedTranscribe = {
  rendered: NormalizedTranscribeRunResult;
  stdoutBody: string;
  filePath?: string;
};

function toEnvelope(
  result: ProviderTranscribeResult,
  now: () => Date,
): NormalizedTranscribeRunResult {
  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    text: result.text,
    language: result.language,
    duration: result.duration,
    segments: result.segments,
    raw: result.raw,
    usage: result.usage,
    cachedModelValidated: true,
    timestamp: now().toISOString(),
  };
}

function toSrt(segments?: ProviderTranscribeResult['segments']): string {
  if (!segments || segments.length === 0) return '';
  return segments
    .map((seg, i) => {
      return `${i + 1}\n${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n${seg.text.trim()}\n`;
    })
    .join('\n');
}

function toVtt(segments?: ProviderTranscribeResult['segments']): string {
  if (!segments || segments.length === 0) return 'WEBVTT\n';
  return [
    'WEBVTT',
    '',
    ...segments.map((seg) => {
      return `${formatVttTime(seg.start)} --> ${formatVttTime(seg.end)}\n${seg.text.trim()}\n`;
    }),
  ].join('\n');
}

function formatSrtTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(millis, 3)}`;
}

function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(',', '.');
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}

export async function renderTranscribeOutput(
  context: RenderTranscribeContext,
): Promise<RenderedTranscribe> {
  const rendered = toEnvelope(context.result, context.now);

  let stdoutBody: string;
  if (context.textOnly || context.format === 'text') {
    stdoutBody = context.result.text;
  } else if (context.format === 'srt') {
    stdoutBody = toSrt(context.result.segments) || context.result.text;
  } else if (context.format === 'vtt') {
    stdoutBody = toVtt(context.result.segments) || `WEBVTT\n\n${context.result.text}\n`;
  } else if (context.format === 'verbose-json') {
    stdoutBody = JSON.stringify({ ...rendered, raw: context.result.raw }, null, 2);
  } else {
    stdoutBody = JSON.stringify(rendered, null, 2);
  }

  let filePath: string | undefined;
  if (context.outputPath) {
    const cwd = context.cwd ?? process.cwd();
    filePath = isAbsolute(context.outputPath)
      ? context.outputPath
      : resolve(cwd, context.outputPath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, stdoutBody, 'utf8');
  }

  return { rendered, stdoutBody, filePath };
}
