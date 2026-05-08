import { Command } from 'commander';

import {
  AICliError,
  getPresetById,
  parseDuration,
  parseIsoDate,
  readUsageRecords,
  writeLine,
  type OutputWriter,
  type UsageRecord,
} from '@marmot-sh/core';

import { formatHistoryLine } from './usage.js';

export type HistoryCommandOptions = {
  since?: string;
  from?: string;
  to?: string;
  provider?: string;
  verb?: string;
  failedOnly?: boolean;
  limit?: string | number;
  json?: boolean;
};

export type HistoryCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 1000;

function resolveWindow(options: HistoryCommandOptions): { fromMs: number; toMs: number } {
  let fromMs: number;
  let toMs: number = Date.now();
  if (options.from || options.to) {
    fromMs = options.from ? parseIsoDate('from', options.from) : 0;
    if (options.to) {
      toMs = parseIsoDate('to', options.to) + 86_400_000;
    }
    if (fromMs > toMs) {
      throw new AICliError(
        'validation',
        `--from (${options.from}) is later than --to (${options.to}); range is empty.`,
      );
    }
  } else if (options.since) {
    fromMs = toMs - parseDuration(options.since);
  } else {
    // Default window for `history`: 7 days. The `--limit` cap (default
    // 10) is what usually trims the output; the window keeps a hard
    // ceiling on how far back we'll scan disk.
    fromMs = toMs - 7 * 86_400_000;
  }
  return { fromMs, toMs };
}

function parseLimit(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AICliError(
      'validation',
      `--limit must be a positive integer (got "${value}").`,
    );
  }
  if (n > MAX_LIMIT) {
    throw new AICliError(
      'validation',
      `--limit ${n} exceeds the per-call cap of ${MAX_LIMIT}.`,
    );
  }
  return n;
}

/** Resolve `preset_id` UUIDs on each record to their current slug for
 *  display. Renames since the call won't break the lookup; missing
 *  presets fall back to `(preset:<short-id>)` so the row stays
 *  informative without raising. */
async function attachPresetSlugs(
  records: UsageRecord[],
  env: NodeJS.ProcessEnv,
): Promise<Array<UsageRecord & { preset_slug?: string }>> {
  const ids = new Set<string>();
  for (const r of records) {
    if (r.preset_id) ids.add(r.preset_id);
  }
  const cache = new Map<string, string>();
  for (const id of ids) {
    const found = await getPresetById(id, env).catch(() => null);
    cache.set(id, found?.slug ?? `(preset:${id.slice(0, 8)})`);
  }
  return records.map((r) => ({
    ...r,
    ...(r.preset_id ? { preset_slug: cache.get(r.preset_id) } : {}),
  }));
}

export async function handleHistoryCommand(
  options: HistoryCommandOptions,
  dependencies: HistoryCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const limit = parseLimit(options.limit);
  const { fromMs, toMs } = resolveWindow(options);

  let records = await readUsageRecords(
    {
      fromIso: new Date(fromMs).toISOString(),
      toIso: new Date(toMs).toISOString(),
    },
    env,
  );

  if (options.provider) {
    records = records.filter((r) => r.provider === options.provider);
  }
  if (options.verb) {
    records = records.filter((r) => r.verb === options.verb);
  }
  if (options.failedOnly) {
    records = records.filter((r) => r.exit === 'error');
  }

  // Newest first, then trim to the requested limit.
  records.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
  records = records.slice(0, limit);

  const enriched = await attachPresetSlugs(records, env);

  if (options.json) {
    writeLine(
      stdout,
      JSON.stringify(
        {
          ok: true,
          window: {
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString(),
          },
          limit,
          count: enriched.length,
          records: enriched,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (enriched.length === 0) {
    writeLine(stdout, 'No usage records in this window.');
    return;
  }

  for (const r of enriched) {
    writeLine(stdout, formatHistoryLine(r));
  }
}

export function buildHistoryCommand(deps: HistoryCommandDependencies = {}): Command {
  return new Command('history')
    .description('List individual recent calls (newest first). Default last 10. Filters compose with --since / --from / --to.')
    .option('--since <duration>', 'Time window: Nh, Nd, or Nw (default 7d).')
    .option('--from <YYYY-MM-DD>', 'Window lower bound (overrides --since).')
    .option('--to <YYYY-MM-DD>', 'Window upper bound (inclusive).')
    .option('--provider <slug>', 'Filter to one provider.')
    .option('--verb <name>', 'Filter to one verb.')
    .option('--failed-only', 'Only error records.')
    .option('--limit <n>', `Max records to return (default ${DEFAULT_LIMIT}, cap ${MAX_LIMIT}).`)
    .option('--json', 'Emit a structured envelope.')
    .action(async (options: HistoryCommandOptions) => {
      await handleHistoryCommand(options, deps);
    });
}
