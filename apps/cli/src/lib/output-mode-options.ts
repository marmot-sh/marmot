/**
 * Shared `--json` / `--markdown` flag wiring + TTY-aware mode resolution
 * for list/show commands.
 */
import type { Command } from 'commander';

import { AICliError } from '@marmot-sh/core';

import type { RenderMode } from './list-renderer.js';

export type OutputModeOptions = {
  json?: boolean;
  markdown?: boolean;
};

/**
 * Append `--json` and `--markdown` to a Command. Mutual exclusivity is
 * checked at resolve time, not at parse time, so the message names the
 * actual command.
 */
export function addOutputModeOptions(command: Command): Command {
  return command
    .option('--json', 'Emit the structured JSON envelope.')
    .option('--markdown', 'Emit a markdown table (for embedding in docs).');
}

/**
 * Resolve the output mode given parsed options and a write stream.
 *
 * Default behavior is TTY-aware: if neither `--json` nor `--markdown` is
 * passed, `human` is used when stdout is a TTY and `json` is used when
 * piped or redirected. This matches `git log`, `gh pr list`, `kubectl get`.
 *
 * @throws AICliError if both flags are passed.
 */
export function resolveOutputMode(
  opts: OutputModeOptions,
  stream: NodeJS.WriteStream = process.stdout,
): RenderMode {
  if (opts.json && opts.markdown) {
    throw new AICliError(
      'validation',
      '--json and --markdown are mutually exclusive. Pass one or neither.',
    );
  }
  if (opts.json) return 'json';
  if (opts.markdown) return 'markdown';
  return stream.isTTY ? 'human' : 'json';
}
