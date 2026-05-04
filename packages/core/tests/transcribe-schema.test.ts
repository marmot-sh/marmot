import { describe, expect, it } from 'vitest';

import { resolveTranscribeRunInput } from '../src/schemas/transcription.js';

describe('resolveTranscribeRunInput', () => {
  it('defaults to format=text (so plain pipes work without jq)', () => {
    const r = resolveTranscribeRunInput({});
    expect(r.format).toBe('text');
    expect(r.text).toBe(false);
  });

  it('accepts srt / vtt / verbose-json', () => {
    expect(resolveTranscribeRunInput({ format: 'srt' }).format).toBe('srt');
    expect(resolveTranscribeRunInput({ format: 'vtt' }).format).toBe('vtt');
    expect(
      resolveTranscribeRunInput({ format: 'verbose-json' }).format,
    ).toBe('verbose-json');
  });

  it('rejects --text with a subtitle format', () => {
    expect(() =>
      resolveTranscribeRunInput({ text: true, format: 'srt' }),
    ).toThrowError(/--text only works with --format json or text/);
  });

  it('allows --text with format=text', () => {
    const r = resolveTranscribeRunInput({ text: true, format: 'text' });
    expect(r.text).toBe(true);
    expect(r.format).toBe('text');
  });

  it('rejects unknown formats', () => {
    expect(() =>
      resolveTranscribeRunInput({ format: 'csv' as unknown as string }),
    ).toThrowError();
  });

  it('passes through language and prompt', () => {
    const r = resolveTranscribeRunInput({
      language: 'en',
      prompt: 'technical interview',
    });
    expect(r.language).toBe('en');
    expect(r.prompt).toBe('technical interview');
  });
});
