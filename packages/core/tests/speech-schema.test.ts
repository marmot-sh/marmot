import { describe, expect, it } from 'vitest';

import { resolveSpeechRunInput } from '../src/schemas/speech.js';

describe('resolveSpeechRunInput', () => {
  it('accepts text + sane defaults', () => {
    const r = resolveSpeechRunInput({ inlineText: 'hello' });
    expect(r.text).toBe('hello');
    expect(r.binary).toBe(false);
    expect(r.b64).toBe(false);
    expect(r.retries).toBe(0);
  });

  it('rejects --binary with --b64', () => {
    expect(() =>
      resolveSpeechRunInput({ inlineText: 'x', binary: true, b64: true }),
    ).toThrowError(/only one of --binary or --b64/);
  });

  it('rejects empty text', () => {
    expect(() => resolveSpeechRunInput({})).toThrowError(/Provide text/);
  });

  it('merges inline + file + stdin', () => {
    const r = resolveSpeechRunInput({
      inlineText: 'A',
      promptFileContent: 'B',
      stdinContent: 'C',
    });
    expect(r.text).toBe('A\n\nB\n\nC');
  });

  it('coerces speed to a number and clamps range', () => {
    expect(resolveSpeechRunInput({ inlineText: 'x', speed: '1.5' }).speed).toBe(1.5);
    expect(() =>
      resolveSpeechRunInput({ inlineText: 'x', speed: 5 }),
    ).toThrowError();
    expect(() =>
      resolveSpeechRunInput({ inlineText: 'x', speed: 0.1 }),
    ).toThrowError();
  });

  it('rejects --play with --b64 (but allows --play with --binary so audio plays AND streams to stdout)', () => {
    expect(() =>
      resolveSpeechRunInput({ inlineText: 'x', play: true, b64: true }),
    ).toThrowError(/--play cannot combine with --b64/);
    // --play + --binary is intentionally allowed: audio plays through speakers
    // and the same bytes are also written to stdout for downstream piping.
    const r = resolveSpeechRunInput({ inlineText: 'x', play: true, binary: true });
    expect(r.play).toBe(true);
    expect(r.binary).toBe(true);
  });

  it('accepts --play with default file mode', () => {
    const r = resolveSpeechRunInput({ inlineText: 'x', play: true });
    expect(r.play).toBe(true);
    expect(r.binary).toBe(false);
    expect(r.b64).toBe(false);
    expect(r.wait).toBe(false);
  });

  it('accepts --play --wait', () => {
    const r = resolveSpeechRunInput({ inlineText: 'x', play: true, wait: true });
    expect(r.play).toBe(true);
    expect(r.wait).toBe(true);
  });

  it('rejects --wait without --play', () => {
    expect(() =>
      resolveSpeechRunInput({ inlineText: 'x', wait: true }),
    ).toThrowError(/--wait only makes sense with --play/);
  });

  it('passes through voice / format / instructions', () => {
    const r = resolveSpeechRunInput({
      inlineText: 'x',
      voice: 'alloy',
      format: 'mp3',
      instructions: 'cheerful',
    });
    expect(r.voice).toBe('alloy');
    expect(r.format).toBe('mp3');
    expect(r.instructions).toBe('cheerful');
  });
});
