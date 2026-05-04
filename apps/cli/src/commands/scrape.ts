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

export type ScrapeCommandOptions = {
  provider?: string;
  apiKey?: string;
  format?: 'markdown' | 'text' | 'html';
  query?: string;
  raw?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string;
  timeout?: string;
};

export type ScrapeCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleScrapeCommand(
  urls: string[],
  options: ScrapeCommandOptions,
  deps: ScrapeCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  if (!urls.length) {
    throw new AICliError('validation', 'At least one URL is required.');
  }

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

  const { response: result, cached } = await withSpinner(
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
        refresh: options.refresh,
        fetcher: () =>
          runWithRetries(
            (abortSignal) => adapter.scrape!({ ...input, abortSignal }),
            { retries, timeoutMs, onRetry },
          ),
      }),
    { stream: stderr, env },
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
  stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function buildScrapeCommand(
  deps: ScrapeCommandDependencies = {},
): Command {
  return new Command('scrape')
    .description('Extract markdown/text from one or more URLs.')
    .argument('<urls...>', 'One or more URLs to scrape.')
    .option('--provider <slug>', 'Web provider: exa, firecrawl, parallel, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--format <fmt>', 'Output format: markdown (default), text, html.')
    .option('--query <text>', 'Optional intent for chunk reranking (Tavily-style).')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .action(async (urls: string[], options: ScrapeCommandOptions) => {
      await handleScrapeCommand(urls, options, deps);
    });
}
