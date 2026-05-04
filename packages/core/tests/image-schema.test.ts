import { describe, expect, it } from 'vitest';

import { resolveImageRunInput } from '../src/schemas/image.js';

describe('resolveImageRunInput', () => {
  it('accepts a single positional prompt with sensible defaults', () => {
    const result = resolveImageRunInput({
      inlinePrompt: 'a marmot in space',
    });
    expect(result.prompt).toBe('a marmot in space');
    expect(result.n).toBe(1);
    expect(result.binary).toBe(false);
    expect(result.b64).toBe(false);
    expect(result.retries).toBe(0);
    expect(result.timeoutMs).toBe(120_000);
  });

  it('parses --n and clamps to 1–10', () => {
    expect(resolveImageRunInput({ inlinePrompt: 'x', n: 4 }).n).toBe(4);
    expect(() =>
      resolveImageRunInput({ inlinePrompt: 'x', n: 11 }),
    ).toThrowError();
    expect(() =>
      resolveImageRunInput({ inlinePrompt: 'x', n: 0 }),
    ).toThrowError();
  });

  it('validates --size as WxH', () => {
    expect(
      resolveImageRunInput({ inlinePrompt: 'x', size: '1024x1024' }).size,
    ).toBe('1024x1024');
    expect(() =>
      resolveImageRunInput({ inlinePrompt: 'x', size: 'big' }),
    ).toThrowError(/Size must look like 1024x1024/);
  });

  it('rejects --binary with --b64 (mutex)', () => {
    expect(() =>
      resolveImageRunInput({
        inlinePrompt: 'x',
        binary: true,
        b64: true,
      }),
    ).toThrowError(/only one of --binary or --b64/);
  });

  it('rejects --binary when n > 1', () => {
    expect(() =>
      resolveImageRunInput({
        inlinePrompt: 'x',
        binary: true,
        n: 2,
      }),
    ).toThrowError(/--binary is only valid with --n 1/);
  });

  it('requires at least one prompt source', () => {
    expect(() => resolveImageRunInput({})).toThrowError(
      /Provide a prompt via argument/,
    );
  });

  it('merges inline + file + stdin prompts with blank lines', () => {
    const result = resolveImageRunInput({
      inlinePrompt: 'inline',
      promptFileContent: 'file',
      stdinContent: 'stdin',
    });
    expect(result.prompt).toBe('inline\n\nfile\n\nstdin');
  });

  it('coerces seed to int', () => {
    expect(
      resolveImageRunInput({ inlinePrompt: 'x', seed: '42' }).seed,
    ).toBe(42);
  });

  it('passes through quality, style, negative untouched', () => {
    const result = resolveImageRunInput({
      inlinePrompt: 'x',
      quality: 'hd',
      style: 'vivid',
      negative: 'blurry, low quality',
    });
    expect(result.quality).toBe('hd');
    expect(result.style).toBe('vivid');
    expect(result.negative).toBe('blurry, low quality');
  });
});
