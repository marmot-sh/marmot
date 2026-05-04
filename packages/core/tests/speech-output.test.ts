import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderSpeechBinaryOutput } from '../src/output/speech-binary.js';
import {
  renderSpeechB64EnvelopeJson,
  renderSpeechB64Output,
} from '../src/output/speech-b64.js';
import {
  renderSpeechFileEnvelopeJson,
  renderSpeechFileOutput,
} from '../src/output/speech-file.js';
import type { ProviderSpeechResult } from '../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-speech-out-'));
  tempDirs.push(dir);
  return dir;
}

const SAMPLE = new Uint8Array([0xff, 0xfb, 0x90, 0x44]); // mp3-ish header bytes

function makeResult(mimeType = 'audio/mpeg'): ProviderSpeechResult {
  return {
    provider: 'openai',
    model: 'tts-1',
    voice: 'alloy',
    audio: { data: SAMPLE, mimeType },
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
  };
}

describe('renderSpeechFileOutput', () => {
  it('writes a default timestamped filename in cwd', async () => {
    const cwd = await fixture();
    const rendered = await renderSpeechFileOutput({
      result: makeResult(),
      provider: 'openai',
      cwd,
      now: () => new Date('2026-04-30T08:35:12.000Z'),
    });
    expect(rendered.audio.path).toMatch(
      new RegExp(`${cwd}/speak-openai-\\d{14}\\.mp3$`),
    );
    expect(await readFile(rendered.audio.path!)).toEqual(Buffer.from(SAMPLE));
    expect(rendered.audio.bytes).toBe(SAMPLE.length);
    expect(rendered.audio.voice).toBe('alloy');
  });

  it('honors a literal -o path', async () => {
    const cwd = await fixture();
    const rendered = await renderSpeechFileOutput({
      result: makeResult(),
      provider: 'openai',
      outputPath: './hello.mp3',
      cwd,
      now: () => new Date(),
    });
    expect(rendered.audio.path).toBe(`${cwd}/hello.mp3`);
  });

  it('uses formatHint extension over mime detection', async () => {
    const cwd = await fixture();
    const rendered = await renderSpeechFileOutput({
      result: makeResult('audio/wav'),
      provider: 'openai',
      formatHint: 'wav',
      cwd,
      now: () => new Date(),
    });
    expect(rendered.audio.format).toBe('wav');
    expect(rendered.audio.path!.endsWith('.wav')).toBe(true);
  });

  it('serializes envelope as JSON', async () => {
    const cwd = await fixture();
    const rendered = await renderSpeechFileOutput({
      result: makeResult(),
      provider: 'openai',
      cwd,
      now: () => new Date('2026-04-30T08:35:12.000Z'),
    });
    const parsed = JSON.parse(renderSpeechFileEnvelopeJson(rendered));
    expect(parsed.ok).toBe(true);
    expect(parsed.audio.format).toBe('mp3');
    expect(parsed.audio.bytes).toBe(SAMPLE.length);
  });
});

describe('renderSpeechBinaryOutput', () => {
  it('writes raw bytes to the supplied writer', () => {
    const captured: Uint8Array[] = [];
    renderSpeechBinaryOutput(makeResult(), {
      write(chunk) {
        captured.push(chunk);
        return true;
      },
    });
    expect(captured).toHaveLength(1);
    expect(Buffer.from(captured[0]!)).toEqual(Buffer.from(SAMPLE));
  });

  it('throws when there are no audio bytes', () => {
    expect(() =>
      renderSpeechBinaryOutput(
        { ...makeResult(), audio: { data: new Uint8Array(), mimeType: 'audio/mpeg' } },
        { write: () => true },
      ),
    ).toThrowError(/no audio/);
  });
});

describe('renderSpeechB64Output', () => {
  it('round-trips bytes through base64', () => {
    const r = makeResult();
    const rendered = renderSpeechB64Output({ result: r, now: () => new Date() });
    const decoded = Buffer.from(rendered.audio.b64!, 'base64');
    expect(decoded).toEqual(Buffer.from(SAMPLE));
  });

  it('serializes as JSON with no path', () => {
    const r = makeResult();
    const rendered = renderSpeechB64Output({ result: r, now: () => new Date() });
    const parsed = JSON.parse(renderSpeechB64EnvelopeJson(rendered));
    expect(parsed.audio.b64).toBeTypeOf('string');
    expect(parsed.audio.path).toBeUndefined();
  });
});
