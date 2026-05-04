import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderTranscribeOutput } from '../src/output/transcribe.js';
import type { ProviderTranscribeResult } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((d) => rm(d, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const d = await mkdtemp(join(tmpdir(), 'marmot-tx-out-'));
  tempDirs.push(d);
  return d;
}

function makeResult(): ProviderTranscribeResult {
  return {
    provider: 'openai',
    model: 'whisper-1',
    text: 'Hello world. This is a test.',
    language: 'en',
    duration: 4.2,
    segments: [
      { start: 0, end: 2.1, text: 'Hello world.' },
      { start: 2.1, end: 4.2, text: ' This is a test.' },
    ],
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

describe('renderTranscribeOutput', () => {
  it('JSON envelope is the default', async () => {
    const out = await renderTranscribeOutput({
      result: makeResult(),
      format: 'json',
      textOnly: false,
      now: () => new Date('2026-04-30T08:00:00.000Z'),
    });
    const parsed = JSON.parse(out.stdoutBody);
    expect(parsed.ok).toBe(true);
    expect(parsed.text).toBe('Hello world. This is a test.');
    expect(parsed.language).toBe('en');
    expect(parsed.segments).toHaveLength(2);
  });

  it('--text flag drops the envelope (raw text on stdout)', async () => {
    const out = await renderTranscribeOutput({
      result: makeResult(),
      format: 'json',
      textOnly: true,
      now: () => new Date(),
    });
    expect(out.stdoutBody).toBe('Hello world. This is a test.');
  });

  it('format=text emits raw text', async () => {
    const out = await renderTranscribeOutput({
      result: makeResult(),
      format: 'text',
      textOnly: false,
      now: () => new Date(),
    });
    expect(out.stdoutBody).toBe('Hello world. This is a test.');
  });

  it('format=srt produces a subtitle block', async () => {
    const out = await renderTranscribeOutput({
      result: makeResult(),
      format: 'srt',
      textOnly: false,
      now: () => new Date(),
    });
    expect(out.stdoutBody).toContain('1\n00:00:00,000 --> 00:00:02,100');
    expect(out.stdoutBody).toContain('Hello world.');
    expect(out.stdoutBody).toContain('2\n00:00:02,100 --> 00:00:04,200');
  });

  it('format=vtt starts with WEBVTT', async () => {
    const out = await renderTranscribeOutput({
      result: makeResult(),
      format: 'vtt',
      textOnly: false,
      now: () => new Date(),
    });
    expect(out.stdoutBody.startsWith('WEBVTT')).toBe(true);
    expect(out.stdoutBody).toContain('00:00:00.000 --> 00:00:02.100');
  });

  it('format=verbose-json includes raw provider response', async () => {
    const result = { ...makeResult(), raw: '{"original":"payload"}' };
    const out = await renderTranscribeOutput({
      result,
      format: 'verbose-json',
      textOnly: false,
      now: () => new Date(),
    });
    const parsed = JSON.parse(out.stdoutBody);
    expect(parsed.raw).toBe('{"original":"payload"}');
  });

  it('writes the body to --output when given', async () => {
    const cwd = await fixture();
    const out = await renderTranscribeOutput({
      result: makeResult(),
      format: 'srt',
      textOnly: false,
      outputPath: './subs.srt',
      cwd,
      now: () => new Date(),
    });
    expect(out.filePath).toBe(`${cwd}/subs.srt`);
    const onDisk = await readFile(out.filePath!, 'utf8');
    expect(onDisk).toContain('00:00:00,000 --> 00:00:02,100');
  });
});
