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
  type StdinReader,
} from '@marmot-sh/core';

export type DataVerbDependencies = {
  stdin?: StdinReader;
};

/** Read piped stdin as a single text blob. Returns the trimmed contents or
 *  null when stdin is a TTY (no pipe). Used by query verbs that want to
 *  merge a piped query/objective with a positional one. */
export async function readQueryStdin(
  deps: DataVerbDependencies,
): Promise<string | null> {
  const raw = await readStdin(deps.stdin);
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** Read piped stdin as a newline-delimited list. Used by verbs that
 *  operate on a batch of identifiers (URLs, emails, ...). Each line is
 *  trimmed; blank lines and `#`-prefixed comments are dropped so the
 *  same input file works for both `marmot scrape -` style invocations
 *  and human-edited URL lists. */
export async function readListStdin(
  deps: DataVerbDependencies,
): Promise<string[]> {
  const raw = await readStdin(deps.stdin);
  if (raw === null) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** Merge a positional list with a stdin-supplied list, preserving order
 *  (positional first) and de-duplicating. Useful for `scrape <url> [<url>]
 *  | piped urls` style invocations where both can contribute. */
export function mergeLists(positional: string[], piped: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...positional, ...piped]) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Merge a positional query with a stdin-supplied query using `\n\n`,
 *  same convention as run/image/speak's `mergePromptSources`. Returns
 *  the merged string. Throws a validation error when both sides are
 *  empty -- the verb has nothing to act on. */
export function mergeQueries(
  positional: string,
  piped: string | null,
  verbLabel: string,
): string {
  const parts = [positional.trim(), piped?.trim() ?? '']
    .filter((part) => part.length > 0);
  const merged = parts.join('\n\n');
  if (!merged) {
    throw new AICliError(
      'validation',
      `${verbLabel} requires a query. Pass one positionally or via stdin.`,
    );
  }
  return merged;
}

/** Write an envelope to a file (when `outputPath` is set) or stdout.
 *  Centralizing this lets every data/web verb honor `-o` consistently
 *  without each one duplicating the mkdir-then-writeFile dance. */
export async function writeEnvelope(
  stdout: { write(s: string): boolean | void },
  outputPath: string | undefined,
  envelope: unknown,
): Promise<void> {
  const text = `${JSON.stringify(envelope, null, 2)}\n`;
  if (!outputPath) {
    stdout.write(text);
    return;
  }
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
