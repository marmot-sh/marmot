import { Command } from 'commander';

import {
  AICliError,
  parseDuration,
  parseIsoDate,
  pruneUsageOlderThan,
  readUsageRecords,
  warnText,
  writeLine,
  type OutputWriter,
  type UsageRecord,
} from '@marmot-sh/core';

export type UsageCommandOptions = {
  since?: string;
  from?: string;
  to?: string;
  by?: 'provider' | 'verb' | 'day' | 'model';
  provider?: string;
  verb?: string;
  failedOnly?: boolean;
  json?: boolean;
};

export type UsageCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: { write(s: string): boolean | void };
};

type GroupedRow = {
  key: string;
  requests: number;
  errors: number;
  cached: number;
  durationTotalMs: number;
  durations: number[];
  costTotal: number;
  requestsWithCost: number;
  requestsWithoutCost: number;
  quantityTotals: Record<string, number>;
};

type Totals = Omit<GroupedRow, 'key' | 'durations'> & {
  errorRate: number;
  cacheHitRate: number;
  durationAvgMs: number;
  durationP50Ms: number;
  durationP95Ms: number;
  costAvgUsd: number;
};

function resolveWindow(options: UsageCommandOptions): { fromMs: number; toMs: number } {
  // --from/--to wins; otherwise --since (default 7d).
  let fromMs: number;
  let toMs: number = Date.now();
  if (options.from || options.to) {
    if (options.from) fromMs = parseIsoDate('from', options.from);
    else fromMs = 0;
    if (options.to) {
      // --to is inclusive at the day level; bump to end of day.
      toMs = parseIsoDate('to', options.to) + 86_400_000;
    }
    if (fromMs > toMs) {
      throw new AICliError(
        'validation',
        `--from (${options.from}) is later than --to (${options.to}); range is empty.`,
      );
    }
  } else {
    const dur = parseDuration(options.since ?? '7d');
    fromMs = toMs - dur;
  }
  return { fromMs, toMs };
}

/** Local-TZ YYYY-MM-DD for `--by day` grouping. Storage day-files are
 *  UTC-named (consistent file boundaries) but human-facing day groups
 *  honor the user's wall clock so "yesterday" matches expectations. */
function localDayKey(ts: string): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function aggregate(records: UsageRecord[], by: UsageCommandOptions['by']): { totals: Totals; rows: GroupedRow[] } {
  const groups = new Map<string, GroupedRow>();
  let totalDurations: number[] = [];
  for (const r of records) {
    const key =
      by === 'verb'
        ? r.verb
        : by === 'day'
          ? localDayKey(r.ts)
          : by === 'model'
            ? r.model ?? '(no-model)'
            : r.provider;
    let row = groups.get(key);
    if (!row) {
      row = {
        key,
        requests: 0,
        errors: 0,
        cached: 0,
        durationTotalMs: 0,
        durations: [],
        costTotal: 0,
        requestsWithCost: 0,
        requestsWithoutCost: 0,
        quantityTotals: {},
      };
      groups.set(key, row);
    }
    row.requests += 1;
    if (r.exit === 'error') row.errors += 1;
    if (r.cached) row.cached += 1;
    row.durationTotalMs += r.duration_ms;
    row.durations.push(r.duration_ms);
    totalDurations.push(r.duration_ms);
    if (typeof r.cost === 'number') {
      row.costTotal += r.cost;
      row.requestsWithCost += 1;
    } else {
      row.requestsWithoutCost += 1;
    }
    if (r.quantity) {
      for (const [k, v] of Object.entries(r.quantity)) {
        row.quantityTotals[k] = (row.quantityTotals[k] ?? 0) + v;
      }
    }
  }

  const rows = Array.from(groups.values()).sort((a, b) => b.requests - a.requests);
  const totals = combineRows(rows, totalDurations);
  return { totals, rows };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function combineRows(rows: GroupedRow[], durations: number[]): Totals {
  const requests = rows.reduce((acc, r) => acc + r.requests, 0);
  const errors = rows.reduce((acc, r) => acc + r.errors, 0);
  const cached = rows.reduce((acc, r) => acc + r.cached, 0);
  const durationTotalMs = rows.reduce((acc, r) => acc + r.durationTotalMs, 0);
  const costTotal = rows.reduce((acc, r) => acc + r.costTotal, 0);
  const requestsWithCost = rows.reduce((acc, r) => acc + r.requestsWithCost, 0);
  const requestsWithoutCost = rows.reduce((acc, r) => acc + r.requestsWithoutCost, 0);
  const quantityTotals: Record<string, number> = {};
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.quantityTotals)) {
      quantityTotals[k] = (quantityTotals[k] ?? 0) + v;
    }
  }
  return {
    requests,
    errors,
    cached,
    durationTotalMs,
    costTotal,
    requestsWithCost,
    requestsWithoutCost,
    quantityTotals,
    errorRate: requests > 0 ? errors / requests : 0,
    cacheHitRate: requests > 0 ? cached / requests : 0,
    durationAvgMs: requests > 0 ? Math.round(durationTotalMs / requests) : 0,
    durationP50Ms: percentile(durations, 50),
    durationP95Ms: percentile(durations, 95),
    costAvgUsd: requestsWithCost > 0 ? costTotal / requestsWithCost : 0,
  };
}

/** Human-friendly window header. Renders all timestamps in the user's
 *  local TZ (storage stays UTC). Three shapes:
 *
 *  - `--since 1h`  → "Usage — last 1h (May 6 09:14 to 19:14)"
 *  - `--since 7d`  → "Usage — last 7d (May 1 to May 8)"
 *  - `--from/--to` → "Usage — May 1 to May 8"
 *
 *  Sub-day windows include time-of-day; multi-day windows show date only.
 *  When the user typed `--since`, the duration token is echoed back so
 *  they can read the window without doing the math themselves. */
function formatWindowHeader(
  window: { fromMs: number; toMs: number },
  options: UsageCommandOptions,
): string {
  const from = new Date(window.fromMs);
  const to = new Date(window.toMs);
  const subDay = window.toMs - window.fromMs <= 24 * 60 * 60 * 1000;

  const dateOnly: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const timeOnly: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };

  const wasSince = !options.from && !options.to;
  const sinceLabel = wasSince ? `last ${options.since ?? '7d'} ` : '';

  if (subDay) {
    const fromLabel = `${from.toLocaleString(undefined, dateOnly)} ${from.toLocaleString(undefined, timeOnly)}`;
    const toLabel = to.toLocaleString(undefined, timeOnly);
    return `Usage — ${sinceLabel}(${fromLabel} to ${toLabel})`;
  }

  // Inclusive end-of-window day for display: subtract 1ms so the label
  // says "May 7" instead of "May 8" for a window that ends at midnight.
  const inclusiveTo = new Date(window.toMs - 1);
  const fromLabel = from.toLocaleString(undefined, dateOnly);
  const toLabel = inclusiveTo.toLocaleString(undefined, dateOnly);
  if (wasSince) {
    return `Usage — last ${options.since ?? '7d'} (${fromLabel} to ${toLabel})`;
  }
  return `Usage — ${fromLabel} to ${toLabel}`;
}

function formatHumanReadable(
  window: { fromMs: number; toMs: number },
  totals: Totals,
  rows: GroupedRow[],
  by: UsageCommandOptions['by'],
  options: UsageCommandOptions,
): string {
  const lines: string[] = [];
  lines.push(formatWindowHeader(window, options));
  lines.push('');

  // Totals
  lines.push('Totals');
  const errPct = (totals.errorRate * 100).toFixed(1);
  lines.push(`  ${totals.requests} requests    ${totals.errors} errors (${errPct}%)    avg ${formatMs(totals.durationAvgMs)}`);
  if (totals.requestsWithCost > 0) {
    lines.push(
      `  $${totals.costTotal.toFixed(4)} reported across ${totals.requestsWithCost} of ${totals.requests} requests (${totals.requestsWithoutCost} without cost data)`,
    );
  } else {
    lines.push(`  cost: not reported by any provider in this window`);
  }
  if (Object.keys(totals.quantityTotals).length > 0) {
    const parts = Object.entries(totals.quantityTotals)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${formatNumber(v)} ${k}`);
    lines.push(`  ${parts.join(' · ')}`);
  }
  lines.push('');

  // Grouped rows
  const groupLabel = by === 'verb' ? 'By verb' : by === 'day' ? 'By day' : by === 'model' ? 'By model' : 'By provider';
  lines.push(groupLabel);
  for (const row of rows) {
    const errLabel = row.errors > 0 ? `  ${row.errors} errors` : '';
    const costLabel = row.requestsWithCost > 0 ? `    $${row.costTotal.toFixed(4)}` : '';
    const qtyLabel = Object.keys(row.quantityTotals).length > 0
      ? '    ' + Object.entries(row.quantityTotals)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${formatNumber(v)} ${k}`)
          .join(' · ')
      : '';
    lines.push(`  ${row.key.padEnd(16)} ${String(row.requests).padStart(5)} requests${qtyLabel}${costLabel}${errLabel}`);
  }
  return lines.join('\n');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export async function handleUsageCommand(
  options: UsageCommandOptions,
  dependencies: UsageCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

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

  const by = options.by ?? 'provider';
  const { totals, rows } = aggregate(records, by);

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
          totals,
          [`by_${by}`]: rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (records.length === 0) {
    writeLine(stdout, 'No usage records in this window.');
    if (env.MARMOT_NO_LOG === '1') {
      stderr.write(
        warnText(
          '[usage] MARMOT_NO_LOG=1 is set in your environment; new calls are not being logged.',
        ) + '\n',
      );
    }
    return;
  }

  writeLine(stdout, formatHumanReadable({ fromMs, toMs }, totals, rows, by, options));
}

export async function handleUsagePruneCommand(
  options: { olderThan: string },
  dependencies: UsageCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const dur = parseDuration(options.olderThan);
  const cutoffIso = new Date(Date.now() - dur).toISOString();
  const result = await pruneUsageOlderThan(cutoffIso, env);

  writeLine(
    stdout,
    JSON.stringify(
      {
        ok: true,
        cutoff: cutoffIso,
        files_deleted: result.filesDeleted,
        bytes_freed: result.bytesFreed,
      },
      null,
      2,
    ),
  );
}

export function buildUsageCommand(deps: UsageCommandDependencies = {}): Command {
  const cmd = new Command('usage')
    .description('Summarize call usage from the local log. Default: last 7 days, grouped by provider.')
    .option('--since <duration>', 'Time window: Nh, Nd, or Nw (default 7d).')
    .option('--from <YYYY-MM-DD>', 'Window lower bound (overrides --since).')
    .option('--to <YYYY-MM-DD>', 'Window upper bound (inclusive).')
    .option('--by <dim>', 'Group by: provider (default), verb, day, model.')
    .option('--provider <slug>', 'Filter to one provider.')
    .option('--verb <name>', 'Filter to one verb.')
    .option('--failed-only', 'Only error records.')
    .option('--json', 'Emit a structured envelope.')
    .action(async (options: UsageCommandOptions) => {
      await handleUsageCommand(options, deps);
    });

  cmd
    .command('prune')
    .description('Delete usage files older than the cutoff.')
    .requiredOption('--older-than <duration>', 'Cutoff age: Nh, Nd, or Nw (e.g. 90d).')
    .action(async (options: { olderThan: string }) => {
      await handleUsagePruneCommand(options, deps);
    });

  return cmd;
}
