import { Command } from 'commander';

import {
  AICliError,
  assertProviderEnabled,
  readMarmotConfig,
  resolveProviderAuth,
  resolveRetryOptions,
  resolveWebVerbDefaults,
  runWithRetries,
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
import type { StdinReader } from '@marmot-sh/core';

export type SearchCommandOptions = {
  provider?: string;
  apiKey?: string;
  limit?: string;
  depth?: 'basic' | 'standard' | 'deep';
  freshness?: 'day' | 'week' | 'month' | 'year';
  includeDomains?: string;
  excludeDomains?: string;
  includeContent?: boolean;
  raw?: boolean;
  json?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string;
  timeout?: string;
  output?: string;
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

function parseLimit(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
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
  const query = mergeQueries(deps, queryParts.join(' '), piped, 'Search');

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

  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'search', retries);
  const input: WebSearchInput = {
    query,
    limit: parseLimit(options.limit),
    depth: options.depth,
    freshness: options.freshness,
    includeDomains: csvToList(options.includeDomains),
    excludeDomains: csvToList(options.excludeDomains),
    includeContent: options.includeContent,
    apiKey,
    fetchFn,
  };

  const { response: result, cached } = await withSpinner(
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
        refresh: options.refresh,
        fetcher: () =>
          runWithRetries(
            (abortSignal) => adapter.search!({ ...input, abortSignal }),
            { retries, timeoutMs, onRetry },
          ),
      }),
    { stream: stderr, env },
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

  await writeEnvelope(stdout, options.output, envelope);
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
    .option('--freshness <range>', 'Freshness window: day, week, month, year.')
    .option('--include-domains <csv>', 'Comma-separated domains to include.')
    .option('--exclude-domains <csv>', 'Comma-separated domains to exclude.')
    .option('--include-content', 'Inline full page content where supported.')
    .option('--raw', "Emit the provider's native response under `raw` instead of normalized data.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .action(async (queryParts: string[], options: SearchCommandOptions) => {
      await handleSearchCommand(queryParts, options, deps);
    });
  return cmd;
}
