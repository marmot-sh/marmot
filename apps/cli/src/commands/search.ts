import { Command } from 'commander';

import {
  AICliError,
  assertProviderEnabled,
  readMarmotConfig,
  resolveProviderAuth,
  resolveRetryOptions,
  resolveWebVerbDefaults,
  runWithRetries,
  warnText,
  withSpinner,
  type StatusStream,
  type WebSearchInput,
} from '@marmot-sh/core';

import {
  assertProviderSupportsVerb,
  getWebProviderAdapter,
} from '../providers/web-index.js';
import { withResponseCache } from '../providers/cache-wrap.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';
import {
  mergeQueries,
  readQueryStdin,
  writeEnvelope,
  type DataVerbDependencies,
} from '../lib/data-verb-io.js';
import { withPreset } from '../lib/with-preset.js';
import { withUsageLogging } from '../lib/usage-recorder.js';
import { resolveSessionBinding } from '../lib/session-binding.js';
import { isDryRun, emitDryRun } from '../lib/dry-run.js';
import type { StdinReader } from '@marmot-sh/core';

export type SearchCommandOptions = {
  provider?: string;
  apiKey?: string;
  query?: string;
  limit?: string | number;
  depth?: 'basic' | 'standard' | 'deep';
  freshness?: 'day' | 'week' | 'month' | 'year';
  afterDate?: string;
  beforeDate?: string;
  includeDomains?: string;
  excludeDomains?: string;
  includeContent?: boolean;
  raw?: boolean;
  json?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  quiet?: boolean;
  preset?: string;
  preset_id?: string;
  session?: string;
};

export type SearchCommandDependencies = DataVerbDependencies & {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
  stdin?: StdinReader;
};

function csvToList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const parts = s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/** Per-provider feature gaps. Each entry lists the search flags marmot
 *  exposes that this provider's API doesn't honor. When a user passes
 *  one of these, we warn on stderr instead of silently dropping it,
 *  so they don't think their filter worked when it didn't. */
const UNSUPPORTED_SEARCH_FLAGS: Record<string, readonly string[]> = {
  brave: ['includeDomains', 'excludeDomains', 'afterDate', 'beforeDate'],
  tavily: ['afterDate', 'beforeDate'],
  parallel: ['beforeDate'],
};

function warnUnsupportedSearchFlags(
  stderr: StatusStream,
  provider: string,
  options: SearchCommandOptions,
): void {
  const unsupported = UNSUPPORTED_SEARCH_FLAGS[provider] ?? [];
  const passed: string[] = [];
  if (unsupported.includes('includeDomains') && options.includeDomains) passed.push('--include-domains');
  if (unsupported.includes('excludeDomains') && options.excludeDomains) passed.push('--exclude-domains');
  if (unsupported.includes('afterDate') && options.afterDate) passed.push('--after-date');
  if (unsupported.includes('beforeDate') && options.beforeDate) passed.push('--before-date');
  if (passed.length === 0) return;
  const list = passed.join(', ');
  stderr.write(
    `${warnText(`[search] ${provider} doesn't honor ${list}; the flag will be ignored. Try a different provider for this filter.`)}\n`,
  );
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a `YYYY-MM-DD` flag value. Two layers:
 *
 *  1. **Format**: reject strings that don't match the `YYYY-MM-DD`
 *     shape (`2026/05/06`, `5-6-2026`).
 *  2. **Real date**: reject impossible calendar values (`2026-02-30`,
 *     `2026-13-45`, `2026-04-31`, `2026-02-29` in non-leap years).
 *     Format-correct strings can still be nonsense; this catches that
 *     before the API rejects them.
 *
 *  Returns the value unchanged on success; returns `undefined` for
 *  missing input; throws an AICliError otherwise.
 */
export function validateIsoDate(
  flag: 'after-date' | 'before-date',
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  if (!ISO_DATE_RE.test(value)) {
    throw new AICliError(
      'validation',
      `--${flag} must be in YYYY-MM-DD format (got "${value}").`,
    );
  }
  // Real-date check via UTC round-trip. JavaScript silently rolls
  // overflow (Feb 30 → Mar 2), so the only way to detect "this is not
  // a real day" is to parse and compare ISO output back to the input.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AICliError(
      'validation',
      `--${flag} "${value}" is not a real calendar date.`,
    );
  }
  return value;
}

/** Reject inverted date ranges before any API call. `afterDate` and
 *  `beforeDate` are both `YYYY-MM-DD` strings, which sort
 *  lexicographically the same as chronologically — no parsing needed.
 *  `afterDate === beforeDate` is allowed (same-day window). */
export function assertDateRangeCoherent(
  afterDate: string | undefined,
  beforeDate: string | undefined,
): void {
  if (afterDate && beforeDate && afterDate > beforeDate) {
    throw new AICliError(
      'validation',
      `--after-date (${afterDate}) is later than --before-date (${beforeDate}). The range is inverted and matches no results.`,
    );
  }
}

function parseLimit(s: string | number | undefined): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const n = typeof s === 'number' ? s : Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AICliError('validation', `--limit must be a positive integer (got "${s}").`);
  }
  return n;
}

export async function handleSearchCommand(
  queryParts: string[],
  options: SearchCommandOptions,
  deps: SearchCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  const piped = await readQueryStdin(deps);
  // Preset-supplied `query` (concat rule in engine) prepends positional args.
  const positionalQuery = queryParts.join(' ');
  const inlineQuery = options.query
    ? [options.query, positionalQuery].filter((s) => s.trim().length > 0).join('\n\n')
    : positionalQuery;
  const query = mergeQueries(deps, inlineQuery, piped, 'Search');

  const sessionBinding = await resolveSessionBinding(options, env);
  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('search', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('search', provider);
  assertProviderEnabled(provider, config);

  const adapter = getWebProviderAdapter(provider);
  if (!adapter.search) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares search support but the method is missing.`,
    );
  }

  // Per-provider unsupported-flag warnings. Surface the silent drops
  // before the call so the user knows the flag isn't going to do
  // anything, instead of seeing unfiltered results and wondering why.
  warnUnsupportedSearchFlags(stderr, provider, options);

  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'search', retries);
  const afterDate = validateIsoDate('after-date', options.afterDate);
  const beforeDate = validateIsoDate('before-date', options.beforeDate);
  assertDateRangeCoherent(afterDate, beforeDate);

  const input: WebSearchInput = {
    query,
    limit: parseLimit(options.limit),
    depth: options.depth,
    freshness: options.freshness,
    afterDate,
    beforeDate,
    includeDomains: csvToList(options.includeDomains),
    excludeDomains: csvToList(options.excludeDomains),
    includeContent: options.includeContent,
    apiKey,
    fetchFn,
  };

  // Privacy-safe usage metadata. Sensitive flags (queries, domain lists)
  // are recorded as boolean presence; non-sensitive ones (limit, depth,
  // freshness) by value. See ~/.marmot/usage/<UTC-DATE>.jsonl.
  const flags: Record<string, string | number | boolean> = {};
  if (input.limit !== undefined) flags.limit = input.limit;
  if (options.depth) flags.depth = options.depth;
  if (options.freshness) flags.freshness = options.freshness;
  if (options.includeContent) flags.include_content = true;

  if (isDryRun(env)) {
    emitDryRun(
      {
        verb: 'search',
        provider,
        request: {
          query_chars: query.length,
          limit: input.limit,
          depth: input.depth,
          freshness: input.freshness,
          afterDate: input.afterDate,
          beforeDate: input.beforeDate,
          includeDomains: Boolean(input.includeDomains),
          excludeDomains: Boolean(input.excludeDomains),
          includeContent: Boolean(input.includeContent),
        },
        retries,
        timeoutMs,
      },
      stdout,
    );
    return;
  }

  const { result, cached } = await withUsageLogging(
    config,
    {
      verb: 'search',
      provider,
      preset_id: options.preset_id,
      flags,
      flag_presence: {
        includeDomains: Boolean(options.includeDomains),
        excludeDomains: Boolean(options.excludeDomains),
        afterDate: Boolean(options.afterDate),
        beforeDate: Boolean(options.beforeDate),
      },
      session: sessionBinding?.name ?? null,
      sensitive: {
        query,
        flags: {
          ...(options.includeDomains ? { includeDomains: options.includeDomains } : {}),
          ...(options.excludeDomains ? { excludeDomains: options.excludeDomains } : {}),
          ...(options.afterDate ? { afterDate: options.afterDate } : {}),
          ...(options.beforeDate ? { beforeDate: options.beforeDate } : {}),
        },
      },
    },
    async () => {
      const out = await withSpinner(
        `Searching with ${provider}…`,
        () =>
          withResponseCache({
            provider,
            verb: 'search',
            input,
            query,
            config,
            env,
            noCache: options.cache === false,
            forceCache: options.cache === true,
            refresh: options.refresh,
            fetcher: () =>
              runWithRetries(
                (abortSignal) => adapter.search!({ ...input, abortSignal }),
                { retries, timeoutMs, onRetry },
              ),
          }),
        { stream: stderr, env },
      );
      return {
        result: out.response,
        cached: out.cached,
        quantity: { results: out.response.data?.results?.length ?? 0 },
        // Search providers don't currently report cost; leave null.
        cost: null,
      };
    },
    env,
  );

  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'search' as const,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    usage: result.usage ?? null,
    timestamp: new Date().toISOString(),
  };

  await writeEnvelope(stdout, options.output, envelope, { quiet: options.quiet });
}

export function buildSearchCommand(
  deps: SearchCommandDependencies = {},
): Command {
  const cmd = new Command('search')
    .description('Search the web via a configured provider.')
    .argument('[query...]', 'Search query. Falls back to stdin when omitted; merges with stdin when both are provided.')
    .option(
      '--provider <slug>',
      'Web provider: brave, exa, firecrawl, parallel, tavily.',
    )
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--limit <n>', 'Max results (capped per provider).')
    .option('--depth <tier>', 'Search depth: basic, standard, deep.')
    .option('--freshness <range>', 'Relative freshness window: day, week, month, year. Mapped per provider (Brave/Tavily native, Exa/Firecrawl emulated, Parallel ignored — use --after-date instead).')
    .option('--after-date <YYYY-MM-DD>', 'Lower bound for absolute date filtering. Honored by Exa, Firecrawl, Parallel; ignored by Brave and Tavily.')
    .option('--before-date <YYYY-MM-DD>', 'Upper bound for absolute date filtering. Honored by Exa and Firecrawl; ignored by Brave, Tavily, and Parallel.')
    .option('--include-domains <csv>', 'Comma-separated domains to include.')
    .option('--exclude-domains <csv>', 'Comma-separated domains to exclude.')
    .option('--include-content', 'Inline full page content where supported.')
    .option('--no-include-content', 'Disable include-content (overrides preset includeContent: true).')
    .option('--raw', "Emit the provider's native response under `raw` instead of normalized data.")
    .option('--no-raw', 'Disable raw envelope (overrides preset raw: true).')
    .option('--cache', 'Use the response cache (default; overrides a preset that sets cache: false).')
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--no-refresh', 'Disable refresh (overrides preset refresh: true).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('-q, --quiet', 'Suppress stdout (file output via -o is still written; stderr status is unaffected).')
    .option('--preset <name>', 'Apply a saved search preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session so it appears in `marmot session show <name>` and filters by session in usage reports.')
    .action(async (queryParts: string[], options: SearchCommandOptions) => {
      const merged = await withPreset(options, 'search');
      await handleSearchCommand(queryParts, merged, deps);
    });
  return cmd;
}
