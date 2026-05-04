import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { readStdin, type StdinReader } from '../src/lib/files.js';
import { mergePromptSources, resolveRunInput } from '../src/schemas/cli.js';

function makeStdin(content: string | null): StdinReader {
  if (content === null) {
    return { isTTY: true } as unknown as StdinReader;
  }
  const stream = Readable.from([content]) as unknown as StdinReader;
  Object.assign(stream, { isTTY: false });
  return stream;
}

describe('readStdin', () => {
  it('returns null when stdin is a TTY', async () => {
    const result = await readStdin(makeStdin(null));
    expect(result).toBeNull();
  });

  it('reads piped content when stdin is not a TTY', async () => {
    const result = await readStdin(makeStdin('piped prompt body'));
    expect(result).toBe('piped prompt body');
  });
});

describe('mergePromptSources with stdin', () => {
  it('merges inline + file + stdin in order', () => {
    expect(
      mergePromptSources('inline note', 'file content', 'stdin payload'),
    ).toBe('inline note\n\nfile content\n\nstdin payload');
  });

  it('skips empty sources', () => {
    expect(mergePromptSources(undefined, '', 'only stdin')).toBe('only stdin');
  });
});

describe('resolveRunInput with stdin', () => {
  it('accepts stdinContent as a valid prompt source', () => {
    const resolved = resolveRunInput({
      stdinContent: 'piped data',
    });
    expect(resolved.prompt).toBe('piped data');
  });

  it('combines stdin with inline prompt', () => {
    const resolved = resolveRunInput({
      inlinePrompt: 'summarize',
      stdinContent: 'big body of text',
    });
    expect(resolved.prompt).toBe('summarize\n\nbig body of text');
  });

  it('errors when no prompt source is provided at all', () => {
    expect(() => resolveRunInput({})).toThrowError(
      'Provide a prompt via argument, --prompt-file, or piped stdin.',
    );
  });
});
