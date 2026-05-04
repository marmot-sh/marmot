import type { NormalizedObjectRunResult } from '../types.js';
import { normalizedObjectRunResultSchema } from '../schemas/output.js';

export function renderObjectJsonOutput(result: NormalizedObjectRunResult): string {
  return JSON.stringify(normalizedObjectRunResultSchema.parse(result), null, 2);
}
