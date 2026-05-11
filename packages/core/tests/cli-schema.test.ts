import { describe, expect, it } from 'vitest';

import {
  mergePromptSources,
  resolveCacheRefreshTarget,
  resolveRunInput,
} from '../src/schemas/cli.js';

describe('resolveRunInput', () => {
  it('defaults the provider and model', () => {
    const resolved = resolveRunInput({
      inlinePrompt: 'hello world',
    });

    expect(resolved.provider).toBe('openrouter');
    expect(resolved.model).toBe('openai/gpt-oss-120b');
    expect(resolved.prompt).toBe('hello world');
  });

  it('merges inline prompt and prompt file content', () => {
    expect(
      mergePromptSources('Inline prompt', 'Prompt file contents'),
    ).toBe('Inline prompt\n\nPrompt file contents');
  });

  it('merges optional system prompt sources', () => {
    const resolved = resolveRunInput({
      inlinePrompt: 'hello world',
      system: 'System inline',
      systemFileContent: 'System file contents',
    });

    expect(resolved.system).toBe('System inline\n\nSystem file contents');
  });

  it('forces text mode when streaming', () => {
    const resolved = resolveRunInput({
      inlinePrompt: 'hello world',
      stream: true,
    });

    expect(resolved.stream).toBe(true);
    expect(resolved.text).toBe(true);
  });

  it('requires at least one prompt source', () => {
    expect(() => resolveRunInput({})).toThrowError(
      'Provide a prompt (positional arg, --prompt-file, or piped stdin) or a system prompt (--system / --system-file / preset).',
    );
  });

  it('accepts a system prompt as the only prompt source (--system alone)', () => {
    const resolved = resolveRunInput({ system: 'Be brief.' });
    expect(resolved.system).toBe('Be brief.');
    expect(resolved.prompt).toBe('');
  });

  it('accepts a system prompt loaded from --system-file as the only prompt source', () => {
    const resolved = resolveRunInput({ systemFileContent: 'You are a JSON-only bot.' });
    expect(resolved.system).toBe('You are a JSON-only bot.');
  });

  it('accepts a system prompt plus a file attachment (the preset-as-task case)', () => {
    const resolved = resolveRunInput({
      system: 'Convert this PDF to markdown.',
      filePaths: ['./doc.pdf'],
    });
    expect(resolved.system).toBe('Convert this PDF to markdown.');
    expect(resolved.filePaths).toEqual(['./doc.pdf']);
  });

  it('still rejects an attachment-only call with no prompt at all', () => {
    expect(() => resolveRunInput({ filePaths: ['./doc.pdf'] })).toThrowError(
      'Provide a prompt (positional arg, --prompt-file, or piped stdin) or a system prompt (--system / --system-file / preset).',
    );
  });
});

describe('resolveCacheRefreshTarget', () => {
  it('defaults to all', () => {
    expect(resolveCacheRefreshTarget()).toBe('all');
  });

  it('accepts provider slugs', () => {
    expect(resolveCacheRefreshTarget('ollama')).toBe('ollama');
  });

  it('accepts the new anthropic and openai slugs', () => {
    expect(resolveCacheRefreshTarget('anthropic')).toBe('anthropic');
    expect(resolveCacheRefreshTarget('openai')).toBe('openai');
  });
});

describe('resolveRunInput --json flag', () => {
  it('accepts --json by itself', () => {
    const resolved = resolveRunInput({
      inlinePrompt: 'hello world',
      json: true,
    });

    expect(resolved.text).toBe(false);
    expect(resolved.stream).toBe(false);
  });

  it('rejects --json with --text', () => {
    expect(() =>
      resolveRunInput({
        inlinePrompt: 'hello world',
        json: true,
        text: true,
      }),
    ).toThrowError('Specify only one of --json or --text.');
  });

  it('rejects --json with --stream', () => {
    expect(() =>
      resolveRunInput({
        inlinePrompt: 'hello world',
        json: true,
        stream: true,
      }),
    ).toThrowError('--json cannot be combined with --stream.');
  });
});

describe('resolveRunInput --image', () => {
  it('accepts a list of --image paths', () => {
    const r = resolveRunInput({
      inlinePrompt: 'what is in these',
      imagePaths: ['./a.png', './b.jpg'],
    });
    expect(r.imagePaths).toEqual(['./a.png', './b.jpg']);
    expect(r.imageStdin).toBe(false);
  });

  it('accepts --image - (stdin) without other stdin text', () => {
    const r = resolveRunInput({
      inlinePrompt: 'what is this',
      imageStdin: true,
    });
    expect(r.imageStdin).toBe(true);
  });

  it('rejects --image - combined with piped stdin text', () => {
    expect(() =>
      resolveRunInput({
        inlinePrompt: 'x',
        imageStdin: true,
        stdinContent: 'piped text',
      }),
    ).toThrowError(/Only one of text prompt, --image -, or --file -/);
  });

  it('passes through --image-mime override', () => {
    const r = resolveRunInput({
      inlinePrompt: 'x',
      imageStdin: true,
      imageMimeOverride: 'image/webp',
    });
    expect(r.imageMimeOverride).toBe('image/webp');
  });

  it('defaults imagePaths to [] when not provided', () => {
    const r = resolveRunInput({ inlinePrompt: 'x' });
    expect(r.imagePaths).toEqual([]);
    expect(r.imageStdin).toBe(false);
  });
});

describe('resolveRunInput --file', () => {
  it('accepts a list of --file paths', () => {
    const r = resolveRunInput({
      inlinePrompt: 'summarize these',
      filePaths: ['./a.pdf', './b.pdf'],
    });
    expect(r.filePaths).toEqual(['./a.pdf', './b.pdf']);
    expect(r.fileStdin).toBe(false);
  });

  it('accepts --file - (stdin) without other stdin text', () => {
    const r = resolveRunInput({
      inlinePrompt: 'summarize',
      fileStdin: true,
    });
    expect(r.fileStdin).toBe(true);
  });

  it('rejects --file - combined with piped stdin text', () => {
    expect(() =>
      resolveRunInput({
        inlinePrompt: 'x',
        fileStdin: true,
        stdinContent: 'piped text',
      }),
    ).toThrowError(/Only one of text prompt, --image -, or --file -/);
  });

  it('rejects --file - combined with --image -', () => {
    expect(() =>
      resolveRunInput({
        inlinePrompt: 'x',
        fileStdin: true,
        imageStdin: true,
      }),
    ).toThrowError(/Only one of text prompt, --image -, or --file -/);
  });

  it('passes through --file-mime override', () => {
    const r = resolveRunInput({
      inlinePrompt: 'x',
      fileStdin: true,
      fileMimeOverride: 'application/pdf',
    });
    expect(r.fileMimeOverride).toBe('application/pdf');
  });

  it('defaults filePaths to [] when not provided', () => {
    const r = resolveRunInput({ inlinePrompt: 'x' });
    expect(r.filePaths).toEqual([]);
    expect(r.fileStdin).toBe(false);
  });
});
