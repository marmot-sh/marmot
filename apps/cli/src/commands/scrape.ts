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
  type WebScrapeInput,
} from '@marmot-sh/core';

import {
  assertProviderSupportsVerb,
  getWebProviderAdapter,
} from '../providers/web-index.js';
import { withResponseCache } from '../providers/cache-wrap.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';
import {
  mergeLists,
  readListStdin,
  writeEnvelope,
  type DataVerbDependencies,
} from '../lib/data-verb-io.js';
import { withPreset } from '../lib/with-preset.js';
import { withUsageLogging } from '../lib/usage-recorder.js';
import { resolveSessionBinding } from '../lib/session-binding.js';
import { isDryRun, emitDryRun } from '../lib/dry-run.js';

export type ScrapeCommandOptions = {
  provider?: string;
  apiKey?: string;
  urls?: string[];
  format?: 'markdown' | 'text' | 'html';
  query?: string;
  raw?: boolean;
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

export type ScrapeCommandDependencies = DataVerbDependencies & {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleScrapeCommand(
  positionalUrls: string[],
  options: ScrapeCommandOptions,
  deps: ScrapeCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  // Merge positional URLs with newline-delimited URLs piped on stdin so
  // `marmot map example.com | marmot scrape` is a native idiom (no
  // `xargs` required). Preset-supplied `urls` (list-append rule in engine)
  // are already merged into options.urls upstream; treat them as another
  // source. Dedup preserves preset-first / positional-first order.
  const piped = await readListStdin(deps);
  const presetUrls = options.urls ?? [];
  const urls = mergeLists(deps, [...presetUrls, ...positionalUrls], piped, 'Scrape');
  if (!urls.length) {
    throw new AICliError(
      'validation',
      'At least one URL is required. Pass URLs positionally or pipe them in (one per line).',
    );
  }

  const sessionBinding = await resolveSessionBinding(options, env);
  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('scrape', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('scrape', provider);
  assertProviderEnabled(provider, config);

  const adapter = getWebProviderAdapter(provider);
  if (!adapter.scrape) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares scrape support but the method is missing.`,
    );
  }

  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'scrape', retries);
  const input: WebScrapeInput = {
    urls,
    format: options.format,
    query: options.query,
    apiKey,
    fetchFn,
  };

  const flags: Record<string, string | number | boolean> = { url_count: urls.length };
  if (options.format) flags.format = options.format;

  if (isDryRun(env)) {
    emitDryRun(
      {
        verb: 'scrape',
        provider,
        request: {
          url_count: urls.length,
          format: input.format,
          query: Boolean(input.query),
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
      verb: 'scrape',
      provider,
      preset_id: options.preset_id,
      flags,
      flag_presence: { query: Boolean(options.query) },
      session: sessionBinding?.name ?? null,
      sensitive: {
        urls,
        ...(options.query ? { flags: { query: options.query } } : {}),
      },
    },
    async () => {
      const out = await withSpinner(
        `Scraping ${urls.length} URL${urls.length === 1 ? '' : 's'} with ${provider}…`,
        () =>
          withResponseCache({
            provider,
            verb: 'scrape',
            input,
            query: urls.join(','),
            config,
            env,
            noCache: options.cache === false,
            forceCache: options.cache === true,
            refresh: options.refresh,
            fetcher: () =>
              runWithRetries(
                (abortSignal) => adapter.scrape!({ ...input, abortSignal }),
                { retries, timeoutMs, onRetry },
              ),
          }),
        { stream: stderr, env },
      );
      return {
        result: out.response,
        cached: out.cached,
        quantity: { pages: out.response.data?.pages?.length ?? urls.length },
        cost: null,
      };
    },
    env,
  );
  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'scrape' as const,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope, { quiet: options.quiet });
}

export function buildScrapeCommand(
  deps: ScrapeCommandDependencies = {},
): Command {
  return new Command('scrape')
    .description('Extract markdown/text from one or more URLs.')
    .argument('[urls...]', 'One or more URLs to scrape. Falls back to stdin (newline-delimited URLs) when omitted; merges with stdin when both are provided.')
    .option('--provider <slug>', 'Web provider: exa, firecrawl, parallel, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--format <fmt>', 'Output format: markdown (default), text, html.')
    .option('--query <text>', 'Optional intent for chunk reranking (Tavily-style).')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--no-raw', 'Disable raw envelope (overrides preset raw: true).')
    .option('--cache', 'Use the response cache (default; overrides a preset that sets cache: false).')
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--no-refresh', 'Disable refresh (overrides preset refresh: true).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('-q, --quiet', 'Suppress stdout (file output via -o is still written; stderr status is unaffected).')
    .option('--preset <name>', 'Apply a saved scrape preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session so it appears in `marmot session show <name>` and filters by session in usage reports.')
    .action(async (urls: string[], options: ScrapeCommandOptions) => {
      const merged = await withPreset(options, 'scrape');
      await handleScrapeCommand(urls, merged, deps);
    });
}
