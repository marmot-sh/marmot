import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { getUsageDir } from '../lib/paths.js';
import { usageRecordSchema, type UsageRecord } from './record.js';

const USAGE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** List the dated usage files on disk. Returns ordered ascending by date. */
export async function listUsageFiles(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ date: string; path: string }[]> {
  const dir = getUsageDir(env);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }
  const dated = entries
    .map((name) => {
      const m = USAGE_FILE_RE.exec(name);
      return m ? { date: m[1]!, path: join(dir, name) } : null;
    })
    .filter((x): x is { date: string; path: string } => x !== null);
  dated.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return dated;
}

export type ReadUsageOptions = {
  /** Inclusive lower bound on record `ts` (ISO string). */
  fromIso?: string;
  /** Exclusive upper bound on record `ts` (ISO string). */
  toIso?: string;
};

/** Read all usage records from disk, optionally bounded by an ISO timestamp
 *  range. Skips records that fail schema validation rather than throwing —
 *  malformed lines from older releases or hand-edits shouldn't break the
 *  summary. */
export async function readUsageRecords(
  options: ReadUsageOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<UsageRecord[]> {
  const files = await listUsageFiles(env);
  const fromMs = options.fromIso ? Date.parse(options.fromIso) : -Infinity;
  const toMs = options.toIso ? Date.parse(options.toIso) : Infinity;

  // Skip files whose date is entirely outside the window, by lexical
  // comparison on the YYYY-MM-DD prefix. Cheap when the user asks for "last
  // 24h" against a hundred-day archive.
  const fromDate = options.fromIso ? options.fromIso.slice(0, 10) : '';
  const toDate = options.toIso ? options.toIso.slice(0, 10) : '';

  const records: UsageRecord[] = [];
  for (const file of files) {
    if (fromDate && file.date < fromDate) continue;
    if (toDate && file.date > toDate) continue;
    const raw = await readFile(file.path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const result = usageRecordSchema.safeParse(parsed);
      if (!result.success) continue;
      const tsMs = Date.parse(result.data.ts);
      if (tsMs < fromMs || tsMs >= toMs) continue;
      records.push(result.data);
    }
  }
  return records;
}

export type PruneResult = {
  filesDeleted: number;
  bytesFreed: number;
};

/** Delete usage files whose date is older than the given cutoff. Returns
 *  count + bytes freed for reporting. */
export async function pruneUsageOlderThan(
  cutoffIso: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PruneResult> {
  const cutoffDate = cutoffIso.slice(0, 10);
  const files = await listUsageFiles(env);
  let filesDeleted = 0;
  let bytesFreed = 0;
  for (const file of files) {
    if (file.date >= cutoffDate) continue;
    try {
      const s = await stat(file.path);
      bytesFreed += s.size;
    } catch {
      /* ignore */
    }
    try {
      await rm(file.path, { force: true });
      filesDeleted += 1;
    } catch {
      /* ignore */
    }
  }
  return { filesDeleted, bytesFreed };
}
