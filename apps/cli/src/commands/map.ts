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
  type WebMapInput,
} from '@marmot-sh/core';

import {
  assertProviderSupportsVerb,
  getWebProviderAdapter,
} from '../providers/web-index.js';
import { withResponseCache } from '../providers/cache-wrap.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';
import { writeEnvelope } from '../lib/data-verb-io.js';

export type MapCommandOptions = {
  provider?: string;
  apiKey?: string;
  search?: string;
  limit?: string;
  raw?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string;
  timeout?: string;
  output?: string;
};

export type MapCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleMapCommand(
  url: string | undefined,
  options: MapCommandOptions,
  deps: MapCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  if (!url) {
    throw new AICliError('validation', 'A URL is required.');
  }

  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('map', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('map', provider);
  assertProviderEnabled(provider, config);

  const adapter = getWebProviderAdapter(provider);
  if (!adapter.map) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares map support but the method is missing.`,
    );
  }

  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'map', retries);
  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  const input: WebMapInput = {
    url,
    search: options.search,
    limit,
    apiKey,
    fetchFn,
  };

  const { response: result, cached } = await withSpinner(
    `Mapping ${url} with ${provider}…`,
    () =>
      withResponseCache({
        provider,
        verb: 'map',
        input,
        query: url,
        config,
        env,
        noCache: options.cache === false,
        refresh: options.refresh,
        fetcher: () =>
          runWithRetries(
            (abortSignal) => adapter.map!({ ...input, abortSignal }),
            { retries, timeoutMs, onRetry },
          ),
      }),
    { stream: stderr, env },
  );
  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'map' as const,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope);
}

export function buildMapCommand(
  deps: MapCommandDependencies = {},
): Command {
  return new Command('map')
    .description('Enumerate URLs on a domain.')
    .argument('<url>', 'Root URL to map.')
    .option('--provider <slug>', 'Web provider: firecrawl, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--search <query>', 'Optional relevance ordering query (Firecrawl).')
    .option('--limit <n>', 'Max URLs returned.')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .action(async (url: string, options: MapCommandOptions) => {
      await handleMapCommand(url, options, deps);
    });
}
