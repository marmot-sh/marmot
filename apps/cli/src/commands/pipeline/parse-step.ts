/**
 * Parse a textual `--step '...'` flag into a structured PipelineStep.
 *
 * Three accepted forms:
 *
 *   1. `<verb> [args...]`        e.g. `search ${input}` or `run "summarize…"`
 *   2. `@<preset>`                e.g. `@news-podcast` (optionally followed by args)
 *   3. `pipeline:<name>`          (rejected at parse time for v1; nested
 *                                 pipelines are deferred until cycle
 *                                 detection lands)
 *
 * Quoting: simple shell-like single/double quote handling so an inline
 * verb like `run "summarize this in three paragraphs"` produces one
 * `args` value with internal whitespace preserved. Backslash-escapes are
 * NOT supported — keep the parser tiny; complex substitution belongs in
 * a real shell, not in step strings.
 */
import { AICliError } from '@marmot-sh/core';
import type { PipelineStep } from '@marmot-sh/core';

const KNOWN_VERBS = new Set([
  'run',
  'image',
  'speak',
  'transcribe',
  'video',
  'search',
  'scrape',
  'answer',
  'map',
  'crawl',
  'research',
  'findall',
  'enrich',
  'lookup',
  'verify',
]);

export function parseStep(raw: string): PipelineStep {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new AICliError('validation', 'Step is empty.');
  }

  // Form 3 (rejected for v1).
  if (trimmed.startsWith('pipeline:')) {
    throw new AICliError(
      'validation',
      'Nested pipeline references (pipeline:<name>) are not supported in this release. Use a sequence of explicit verbs or @preset references.',
    );
  }

  // Form 2: @preset reference, optionally with positional args.
  if (trimmed.startsWith('@')) {
    const tokens = tokenize(trimmed);
    const head = tokens[0]!.slice(1); // drop '@'
    if (!head) throw new AICliError('validation', `Step "${raw}" is missing a preset name after "@".`);
    const args = tokens.slice(1).join(' ').trim() || undefined;
    return args ? { preset: head, args } : { preset: head };
  }

  // Form 1: inline verb invocation.
  const tokens = tokenize(trimmed);
  const verb = tokens[0]!;
  if (!KNOWN_VERBS.has(verb)) {
    throw new AICliError(
      'validation',
      `Step "${raw}" doesn't start with a known marmot verb. Known verbs: ${[...KNOWN_VERBS].sort().join(', ')}. To reference a preset, prefix with @ (e.g. "@news-podcast").`,
    );
  }
  const args = tokens.slice(1).join(' ').trim() || undefined;
  return args ? { verb, args } : { verb };
}

/**
 * Minimal whitespace-respecting tokenizer with single/double quote
 * support. Returns one token per quoted run or unquoted whitespace-
 * separated word. Quotes themselves are stripped.
 *
 * Mismatched quotes are reported as validation errors; we don't try to
 * be clever about unterminated strings.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    while (i < n && /\s/.test(input[i]!)) i++;
    if (i >= n) break;
    const ch = input[i]!;
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      const start = i;
      while (i < n && input[i] !== quote) i++;
      if (i >= n) {
        throw new AICliError('validation', `Unterminated ${quote === '"' ? 'double' : 'single'}-quoted string in step.`);
      }
      tokens.push(input.slice(start, i));
      i++; // skip closing quote
    } else {
      const start = i;
      while (i < n && !/\s/.test(input[i]!)) i++;
      tokens.push(input.slice(start, i));
    }
  }
  return tokens;
}
