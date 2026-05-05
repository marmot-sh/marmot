// Parse repeatable `--provider-option key=value` flags shared across
// every AI verb. Lives outside individual verb handlers so the parsing
// rules and error messages stay consistent.

import { AICliError } from '@marmot-sh/core';

/**
 * Convert raw `["key=value", "k=v"]` flag values into a plain object.
 * Values are kept as strings -- the underlying provider SDKs coerce
 * numbers/booleans where they need to, and string is the safe lossless
 * default for arbitrary key=value pairs. Returns undefined when no
 * options were passed so the schema's optional() field can stay unset.
 */
export function parseProviderOptions(
  raw: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!raw || raw.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const entry of raw) {
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      throw new AICliError(
        'validation',
        `--provider-option must look like key=value (got "${entry}").`,
      );
    }
    const key = entry.slice(0, eq).trim();
    const value = entry.slice(eq + 1);
    if (!key) {
      throw new AICliError(
        'validation',
        `--provider-option key is empty in "${entry}".`,
      );
    }
    out[key] = value;
  }
  return out;
}
