/**
 * Shared `--quiet` flag wiring + TTY-aware stdout decision for every
 * verb that supports `-o <file>`.
 *
 * The matrix this implements:
 *
 *   -o set | stdout piped | --quiet | emit to stdout?
 *   -------|---------------|---------|-----------------
 *   no     | no            | no      | yes (today)
 *   no     | yes           | no      | yes (today)
 *   yes    | no            | no      | NO  (NEW default)
 *   yes    | yes           | no      | yes (today)
 *   any    | any           | yes     | NO  (--quiet always wins)
 *
 * Stderr (spinners, cache hints, warnings, errors) is unaffected — this
 * helper only governs stdout.
 */
import type { Command } from 'commander';

export type QuietOption = {
  quiet?: boolean;
};

/**
 * Append `-q, --quiet` to a Command.
 */
export function addQuietOption(command: Command): Command {
  return command.option(
    '-q, --quiet',
    'Suppress stdout (file output via -o is still written; stderr status is unaffected).',
  );
}

/**
 * Decide whether to emit the rendered output to stdout.
 *
 * Rules, in order:
 *   1. `--quiet` always wins → false.
 *   2. `-o <file>` set AND stdout is a TTY → false (write file only).
 *   3. Otherwise → true.
 */
export function resolveStdoutEmit(args: {
  outputPath?: string | null | undefined;
  quiet?: boolean;
  stream?: NodeJS.WriteStream;
}): boolean {
  const stream = args.stream ?? process.stdout;
  if (args.quiet) return false;
  if (args.outputPath && stream.isTTY) return false;
  return true;
}
