/**
 * Covers the 8-row matrix from stdout-mode.ts.
 */
import { describe, expect, it } from 'vitest';

import { resolveStdoutEmit } from '../src/lib/stdout-mode.js';

function mkStream(isTTY: boolean): NodeJS.WriteStream {
  return { isTTY } as unknown as NodeJS.WriteStream;
}

describe('resolveStdoutEmit', () => {
  it('no -o, no pipe, no --quiet → emit', () => {
    expect(resolveStdoutEmit({ stream: mkStream(true) })).toBe(true);
  });

  it('no -o, no pipe, --quiet → silent', () => {
    expect(resolveStdoutEmit({ quiet: true, stream: mkStream(true) })).toBe(false);
  });

  it('no -o, piped, no --quiet → emit (to pipe)', () => {
    expect(resolveStdoutEmit({ stream: mkStream(false) })).toBe(true);
  });

  it('no -o, piped, --quiet → silent (pipe gets nothing)', () => {
    expect(resolveStdoutEmit({ quiet: true, stream: mkStream(false) })).toBe(false);
  });

  it('-o set, no pipe, no --quiet → silent (NEW default)', () => {
    expect(resolveStdoutEmit({ outputPath: '/tmp/out', stream: mkStream(true) })).toBe(false);
  });

  it('-o set, no pipe, --quiet → silent', () => {
    expect(
      resolveStdoutEmit({ outputPath: '/tmp/out', quiet: true, stream: mkStream(true) }),
    ).toBe(false);
  });

  it('-o set, piped, no --quiet → emit AND file (today)', () => {
    expect(resolveStdoutEmit({ outputPath: '/tmp/out', stream: mkStream(false) })).toBe(true);
  });

  it('-o set, piped, --quiet → silent (file only, pipe gets nothing)', () => {
    expect(
      resolveStdoutEmit({ outputPath: '/tmp/out', quiet: true, stream: mkStream(false) }),
    ).toBe(false);
  });

  it('treats falsy outputPath (empty string / null / undefined) as not-set', () => {
    expect(resolveStdoutEmit({ outputPath: '', stream: mkStream(true) })).toBe(true);
    expect(resolveStdoutEmit({ outputPath: null, stream: mkStream(true) })).toBe(true);
    expect(resolveStdoutEmit({ outputPath: undefined, stream: mkStream(true) })).toBe(true);
  });

  it('defaults stream to process.stdout when unspecified', () => {
    // smoke check: without a stream we still get a boolean back.
    const result = resolveStdoutEmit({ outputPath: '/tmp/out' });
    expect(typeof result).toBe('boolean');
  });
});
