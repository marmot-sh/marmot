// Shared input/output helpers used by every data/web verb (search, scrape,
// research, answer, crawl, map, findall, enrich, lookup, verify).
//
// The four AI verbs (run/image/speak/transcribe) get unique-to-each input
// shapes (multimodal stdin sniffing, file paths, etc.). The data/web verbs
// share a much simpler shape: text in (query or URL list), JSON envelope
// out -- so they share these helpers.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  AICliError,
  readStdin,
  resolveUserPath,
  warnText,
  type StdinReader,
} from '@marmot-sh/core';

import { resolveStdoutEmit } from './stdout-mode.js';

export type DataVerbDependencies = {
  stdin?: StdinReader;
  stderr?: { write(s: string): boolean | void };
};

/** Tagged result distinguishing "no pipe attached (TTY)" from "pipe
 *  attached but the upstream sent zero bytes". Lets callers warn when
 *  the empty-pipe case falls back to a positional, since it usually
 *  means an upstream pipeline stage failed. */
export type StdinTextResult =
  | { kind: 'tty' }
  | { kind: 'empty-pipe' }
  | { kind: 'content'; text: string };

export type StdinListResult =
  | { kind: 'tty' }
  | { kind: 'empty-pipe' }
  | { kind: 'content'; items: string[] };

/** Read piped stdin as a single text blob. */
export async function readQueryStdin(
  deps: DataVerbDependencies,
): Promise<StdinTextResult> {
  const raw = await readStdin(deps.stdin);
  if (raw === null) return { kind: 'tty' };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: 'empty-pipe' };
  return { kind: 'content', text: trimmed };
}

/** Read piped stdin as a newline-delimited list. Each line is trimmed;
 *  blank lines and `#`-prefixed comments are dropped so the same input
 *  file works for both `marmot scrape -` style invocations and
 *  human-edited URL lists. */
export async function readListStdin(
  deps: DataVerbDependencies,
): Promise<StdinListResult> {
  const raw = await readStdin(deps.stdin);
  if (raw === null) return { kind: 'tty' };
  const items = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (items.length === 0) return { kind: 'empty-pipe' };
  return { kind: 'content', items };
}

/** Emit a yellow warning to stderr when an upstream pipe came back empty.
 *  Surfacing this is the only signal we can give: Unix pipes don't
 *  propagate the upstream process's exit code, so a piped command that
 *  errored looks identical to a piped command that legitimately had
 *  nothing to say. The warning hints at the former without forcing the
 *  caller to abort. */
function warnEmptyPipe(
  deps: DataVerbDependencies,
  verbLabel: string,
): void {
  const stderr = deps.stderr;
  if (!stderr) return;
  stderr.write(
    `${warnText(`[${verbLabel.toLowerCase()}] stdin was piped but empty (upstream command may have failed). Falling back to positional input.`)}\n`,
  );
}

/** Merge a positional list with a stdin-supplied list, preserving order
 *  (positional first) and de-duplicating. */
export function mergeLists(
  deps: DataVerbDependencies,
  positional: string[],
  piped: StdinListResult,
  verbLabel: string,
): string[] {
  if (piped.kind === 'empty-pipe' && positional.length > 0) {
    warnEmptyPipe(deps, verbLabel);
  }
  const items = piped.kind === 'content' ? piped.items : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...positional, ...items]) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Merge a positional query with a stdin-supplied query using `\n\n`,
 *  same convention as run/image/speak's `mergePromptSources`. Throws a
 *  validation error when both sides are empty. Warns when the pipe was
 *  attached but empty and a positional rescued the call -- a strong
 *  hint that an upstream stage failed. */
export function mergeQueries(
  deps: DataVerbDependencies,
  positional: string,
  piped: StdinTextResult,
  verbLabel: string,
): string {
  const trimmedPos = positional.trim();

  if (piped.kind === 'empty-pipe' && trimmedPos.length > 0) {
    warnEmptyPipe(deps, verbLabel);
  }

  const pipedText = piped.kind === 'content' ? piped.text : '';
  const parts = [trimmedPos, pipedText].filter((part) => part.length > 0);
  const merged = parts.join('\n\n');

  if (!merged) {
    throw new AICliError(
      'validation',
      `${verbLabel} requires a query. Pass one positionally or via stdin.`,
    );
  }
  return merged;
}

/** Write an envelope to stdout, a file, or both, per the project-wide
 *  TTY-aware rules in `stdout-mode.ts`. Centralizing this lets every
 *  data/web verb honor `-o` and `--quiet` consistently. */
export async function writeEnvelope(
  stdout: { write(s: string): boolean | void; isTTY?: boolean },
  outputPath: string | undefined,
  envelope: unknown,
  opts?: { quiet?: boolean },
): Promise<void> {
  const text = `${JSON.stringify(envelope, null, 2)}\n`;
  const emit = resolveStdoutEmit({
    outputPath,
    quiet: opts?.quiet,
    stream: stdout as NodeJS.WriteStream,
  });
  if (emit) {
    stdout.write(text);
  }
  if (!outputPath) return;
  const resolved = resolveUserPath(outputPath);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, text, 'utf8');
  } catch (error) {
    throw new AICliError(
      'io',
      `Failed to write output to "${resolved}".`,
      { cause: error },
    );
  }
}
