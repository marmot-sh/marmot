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
import { withPreset } from '../lib/with-preset.js';
import { withUsageLogging } from '../lib/usage-recorder.js';
import { resolveSessionBinding } from '../lib/session-binding.js';
import { isDryRun, emitDryRun } from '../lib/dry-run.js';

export type MapCommandOptions = {
  provider?: string;
  apiKey?: string;
  url?: string;
  search?: string;
  limit?: string | number;
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

  // Fall back to preset's `url` field if the positional was not given.
  const resolvedUrl = url ?? options.url;
  if (!resolvedUrl) {
    throw new AICliError('validation', 'A URL is required.');
  }

  const sessionBinding = await resolveSessionBinding(options, env);
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
  const limit = options.limit !== undefined && options.limit !== ''
    ? (typeof options.limit === 'number'
        ? options.limit
        : Number.parseInt(options.limit, 10))
    : undefined;
  const input: WebMapInput = {
    url: resolvedUrl,
    search: options.search,
    limit,
    apiKey,
    fetchFn,
  };

  const flags: Record<string, string | number | boolean> = {};
  if (limit !== undefined) flags.limit = limit;

  if (isDryRun(env)) {
    emitDryRun(
      {
        verb: 'map',
        provider,
        request: {
          url: resolvedUrl,
          limit,
          search: Boolean(options.search),
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
      verb: 'map',
      provider,
      preset_id: options.preset_id,
      flags,
      flag_presence: { search: Boolean(options.search) },
      session: sessionBinding?.name ?? null,
      sensitive: {
        urls: [resolvedUrl],
        ...(options.search ? { flags: { search: options.search } } : {}),
      },
    },
    async () => {
      const out = await withSpinner(
        `Mapping ${resolvedUrl} with ${provider}…`,
        () =>
          withResponseCache({
            provider,
            verb: 'map',
            input,
            query: resolvedUrl,
            config,
            env,
            noCache: options.cache === false,
            forceCache: options.cache === true,
            refresh: options.refresh,
            fetcher: () =>
              runWithRetries(
                (abortSignal) => adapter.map!({ ...input, abortSignal }),
                { retries, timeoutMs, onRetry },
              ),
          }),
        { stream: stderr, env },
      );
      return {
        result: out.response,
        cached: out.cached,
        quantity: { urls: out.response.data?.urls?.length ?? 0 },
        cost: null,
      };
    },
    env,
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
  await writeEnvelope(stdout, options.output, envelope, { quiet: options.quiet });
}

export function buildMapCommand(
  deps: MapCommandDependencies = {},
): Command {
  return new Command('map')
    .description('Enumerate URLs on a domain.')
    .argument('[url]', 'Root URL to map. Optional when a preset supplies it.')
    .option('--provider <slug>', 'Web provider: firecrawl, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--search <query>', 'Optional relevance ordering query (Firecrawl).')
    .option('--limit <n>', 'Max URLs returned.')
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
    .option('--preset <name>', 'Apply a saved map preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session so it appears in `marmot session show <name>` and filters by session in usage reports.')
    .action(async (url: string | undefined, options: MapCommandOptions) => {
      const merged = await withPreset(options, 'map');
      await handleMapCommand(url, merged, deps);
    });
}
