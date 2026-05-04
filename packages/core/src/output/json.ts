import type { NormalizedRunResult } from '../types.js';
import { normalizedRunResultSchema } from '../schemas/output.js';

export function renderJsonOutput(result: NormalizedRunResult): string {
  return JSON.stringify(normalizedRunResultSchema.parse(result), null, 2);
}
