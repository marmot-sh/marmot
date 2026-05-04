import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

describe('createProgram — ai image subcommand', () => {
  it('exposes the image subcommand', () => {
    const program = createProgram();
    const imageCommand = program.commands.find((cmd) => cmd.name() === 'image');
    expect(imageCommand).toBeDefined();
  });

  it('lists image-specific options on ai image --help', () => {
    const program = createProgram();
    const imageCommand = program.commands.find((cmd) => cmd.name() === 'image')!;
    const optionNames = imageCommand.options.map((o) => o.long);

    expect(optionNames).toContain('--n');
    expect(optionNames).toContain('--size');
    expect(optionNames).toContain('--quality');
    expect(optionNames).toContain('--style');
    expect(optionNames).toContain('--seed');
    expect(optionNames).toContain('--negative');
    expect(optionNames).toContain('--binary');
    expect(optionNames).toContain('--b64');
    expect(optionNames).toContain('--json');
  });

  it('does NOT expose text-mode-only options on ai image', () => {
    const program = createProgram();
    const imageCommand = program.commands.find((cmd) => cmd.name() === 'image')!;
    const optionNames = imageCommand.options.map((o) => o.long);

    expect(optionNames).not.toContain('--system');
    expect(optionNames).not.toContain('--system-file');
    expect(optionNames).not.toContain('--schema');
    expect(optionNames).not.toContain('--schema-file');
    expect(optionNames).not.toContain('--schema-module');
    expect(optionNames).not.toContain('--stream');
    expect(optionNames).not.toContain('--text');
    expect(optionNames).not.toContain('--markdown');
  });

  it('shares core options with ai run', () => {
    const program = createProgram();
    const imageCommand = program.commands.find((cmd) => cmd.name() === 'image')!;
    const optionNames = imageCommand.options.map((o) => o.long);

    expect(optionNames).toContain('--provider');
    expect(optionNames).toContain('--model');
    expect(optionNames).toContain('--api-key');
    expect(optionNames).toContain('--output');
    expect(optionNames).toContain('--prompt-file');
    expect(optionNames).toContain('--retries');
    expect(optionNames).toContain('--timeout');
  });

  it('accepts a positional [prompt...] argument', () => {
    const program = createProgram();
    const imageCommand = program.commands.find((cmd) => cmd.name() === 'image')!;
    expect(imageCommand.registeredArguments).toHaveLength(1);
    expect(imageCommand.registeredArguments[0]!.variadic).toBe(true);
  });
});
