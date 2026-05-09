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
  type WebAnswerInput,
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

export type AnswerCommandOptions = {
  provider?: string;
  apiKey?: string;
  query?: string;
  maxCitations?: string | number;
  includeSearch?: boolean;
  raw?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  preset?: string;
  preset_id?: string;
  session?: string;
};

export type AnswerCommandDependencies = DataVerbDependencies & {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleAnswerCommand(
  queryParts: string[],
  options: AnswerCommandOptions,
  deps: AnswerCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  const piped = await readQueryStdin(deps);
  const positionalQuery = queryParts.join(' ');
  const inlineQuery = options.query
    ? [options.query, positionalQuery].filter((s) => s.trim().length > 0).join('\n\n')
    : positionalQuery;
  const query = mergeQueries(deps, inlineQuery, piped, 'Answer');

  const sessionBinding = await resolveSessionBinding(options, env);
  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('answer', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('answer', provider);
  assertProviderEnabled(provider, config);

  const adapter = getWebProviderAdapter(provider);
  if (!adapter.answer) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares answer support but the method is missing.`,
    );
  }

  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'answer', retries);
  const maxCitations = options.maxCitations !== undefined && options.maxCitations !== ''
    ? (typeof options.maxCitations === 'number'
        ? options.maxCitations
        : Number.parseInt(options.maxCitations, 10))
    : undefined;
  const input: WebAnswerInput = {
    query,
    maxCitations,
    includeSearch: options.includeSearch,
    apiKey,
    fetchFn,
  };

  const flags: Record<string, string | number | boolean> = {};
  if (maxCitations !== undefined) flags.max_citations = maxCitations;
  if (options.includeSearch) flags.include_search = true;

  if (isDryRun(env)) {
    emitDryRun(
      {
        verb: 'answer',
        provider,
        request: {
          query_chars: query.length,
          max_citations: maxCitations,
          include_search: Boolean(options.includeSearch),
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
      verb: 'answer',
      provider,
      preset_id: options.preset_id,
      flags,
      flag_presence: { query: true },
      session: sessionBinding?.name ?? null,
      sensitive: { query },
    },
    async () => {
      const out = await withSpinner(
        `Asking ${provider}…`,
        () =>
          withResponseCache({
            provider,
            verb: 'answer',
            input,
            query,
            config,
            env,
            noCache: options.cache === false,
            refresh: options.refresh,
            fetcher: () =>
              runWithRetries(
                (abortSignal) => adapter.answer!({ ...input, abortSignal }),
                { retries, timeoutMs, onRetry },
              ),
          }),
        { stream: stderr, env },
      );
      return {
        result: out.response,
        cached: out.cached,
        quantity: {
          citations: out.response.data?.citations?.length ?? 0,
          ...(out.response.data?.results ? { results: out.response.data.results.length } : {}),
        },
        cost: null,
      };
    },
    env,
  );
  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'answer' as const,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope);
}

export function buildAnswerCommand(
  deps: AnswerCommandDependencies = {},
): Command {
  return new Command('answer')
    .description('Get an LLM-generated answer with citations.')
    .argument('[query...]', 'Question to answer. Falls back to stdin when omitted; merges with stdin when both are provided.')
    .option('--provider <slug>', 'Web provider: brave, exa, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--max-citations <n>', 'Cap citations included (default 8).')
    .option('--include-search', 'Also return underlying search results alongside the answer.')
    .option('--no-include-search', 'Disable include-search (overrides preset includeSearch: true).')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--no-raw', 'Disable raw envelope (overrides preset raw: true).')
    .option('--cache', 'Use the response cache (default; overrides a preset that sets cache: false).')
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--no-refresh', 'Disable refresh (overrides preset refresh: true).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('--preset <name>', 'Apply a saved answer preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session so it appears in `marmot session show <name>` and filters by session in usage reports.')
    .action(async (queryParts: string[], options: AnswerCommandOptions) => {
      const merged = await withPreset(options, 'answer');
      await handleAnswerCommand(queryParts, merged, deps);
    });
}
