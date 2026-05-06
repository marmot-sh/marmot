import { AICliError } from '@marmot-sh/core';

/** Coerce a CLI flag (string from commander) or preset value (number from
 *  zod) into a number. Returns undefined for empty/missing input. Throws
 *  AICliError on non-finite results so the user gets a clear flag-name
 *  attribution instead of NaN propagating into a request body. */
export function parseIntFlag(
  flag: string,
  value: string | number | undefined | null,
): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new AICliError('validation', `--${flag} must be an integer (got "${value}").`);
  }
  return n;
}
