import { AICliError } from '@marmot-sh/core';

/**
 * Known top-level marmot commands. Mirrors the registrations in cli.ts.
 * Includes the names a user would plausibly type instead of `marmot
 * "their prompt"`. Aliases (e.g. nothing for now) can be added later.
 */
const KNOWN_COMMANDS: ReadonlySet<string> = new Set([
  'run', 'image', 'speak', 'transcribe',
  'search', 'scrape', 'answer', 'map', 'crawl', 'research', 'findall',
  'enrich', 'lookup', 'verify',
  'get', 'tasks',
  'cache', 'preset', 'session',
  'setup', 'config', 'providers', 'models',
  'completions', 'about', 'api', 'help',
]);

/**
 * Catch the case where a user types `marmot search` (or `marmot serach`)
 * intending to invoke a command, but commander's default text action accepts
 * any positional and runs it as a prompt — silently burning tokens.
 *
 * Heuristic: the prompt is a single short word with no whitespace, looks
 * command-shaped (lowercase + dashes), and either matches a known command
 * exactly or is one edit away from one. Long, multi-word, or punctuated
 * prompts are clearly intentional and pass through.
 *
 * Throws an `AICliError('validation')` with a hint pointing at the right
 * invocation. The user can quote their prompt to opt out:
 * `marmot 'search'`.
 */
export function assertNoCommandConfusion(
  promptParts: string[],
  hasOtherPromptInput: boolean,
): void {
  if (hasOtherPromptInput) return;
  if (promptParts.length !== 1) return;
  const word = promptParts[0]?.trim() ?? '';
  if (word.length < 3 || word.length > 20) return;
  if (!/^[a-z][a-z0-9-]*$/.test(word)) return;

  if (KNOWN_COMMANDS.has(word)) {
    throw new AICliError(
      'validation',
      `"${word}" is a marmot command, not a prompt. Run \`marmot ${word} --help\` for usage. To send "${word}" as a prompt, quote it: \`marmot '${word}'\`.`,
    );
  }

  for (const cmd of KNOWN_COMMANDS) {
    if (Math.abs(cmd.length - word.length) > 1) continue;
    if (editDistanceAtMostOne(word, cmd)) {
      throw new AICliError(
        'validation',
        `"${word}" looks like a typo of marmot command "${cmd}". Did you mean \`marmot ${cmd}\`? To send "${word}" as a prompt, quote it: \`marmot '${word}'\`.`,
      );
    }
  }
}

/**
 * True iff `a` and `b` are within Damerau–Levenshtein distance 1 — meaning
 * one insertion, one deletion, one substitution, OR one adjacent
 * transposition (swap of two neighboring characters). Catches the most
 * common typo shapes including `serach` → `search`. Inputs bounded to
 * ~20 chars by the caller, so the full DP matrix is fine.
 */
function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return false;

  // Damerau–Levenshtein DP with adjacent-transposition support.
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        v = Math.min(v, dp[i - 2]![j - 2]! + cost);
      }
      dp[i]![j] = v;
      if (v < rowMin) rowMin = v;
    }
    // Early-exit pruning: if the whole row exceeds 1, no further cell can drop below 2.
    if (rowMin > 1) return false;
  }
  return dp[m]![n]! <= 1;
}
