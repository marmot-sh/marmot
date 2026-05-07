import { AICliError } from '../lib/errors.js';

const DURATION_RE = /^(\d+)\s*([hdw])$/i;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/**
 * Parse a duration string like `1h`, `24h`, `7d`, `4w` into milliseconds.
 * Case-insensitive; whitespace between number and unit allowed. Integer
 * counts only — fractional inputs (`1.5d`) are rejected to keep the format
 * unambiguous in log/help output. `m` is intentionally not supported because
 * it's ambiguous between minutes and months.
 *
 * Throws `AICliError('validation', ...)` on malformed or non-positive input.
 */
export function parseDuration(input: string): number {
  const match = DURATION_RE.exec(input.trim());
  if (!match) {
    throw new AICliError(
      'validation',
      `Duration "${input}" must be a positive integer plus h/d/w (e.g. 1h, 24h, 7d, 4w).`,
    );
  }
  const n = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AICliError(
      'validation',
      `Duration "${input}" must be greater than 0.`,
    );
  }
  const unit = match[2]!.toLowerCase();
  const unitMs = unit === 'h' ? HOUR_MS : unit === 'd' ? DAY_MS : WEEK_MS;
  return n * unitMs;
}

/**
 * Validate a `YYYY-MM-DD` date string and return its UTC midnight epoch ms.
 * Used for `--from` / `--to` flags on `marmot usage`. Same semantics as the
 * search verb's date validation (real-date check via UTC round-trip).
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(flag: 'from' | 'to', value: string): number {
  if (!ISO_DATE_RE.test(value)) {
    throw new AICliError(
      'validation',
      `--${flag} must be in YYYY-MM-DD format (got "${value}").`,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AICliError(
      'validation',
      `--${flag} "${value}" is not a real calendar date.`,
    );
  }
  return parsed.getTime();
}
