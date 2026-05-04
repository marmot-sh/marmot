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

export type AnswerCommandOptions = {
  provider?: string;
  apiKey?: string;
  maxCitations?: string;
  includeSearch?: boolean;
  raw?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string;
  timeout?: string;
};

export type AnswerCommandDependencies = {
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

  const query = queryParts.join(' ').trim();
  if (!query) {
    throw new AICliError('validation', 'Query is required.');
  }

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
  const maxCitations = options.maxCitations
    ? Number.parseInt(options.maxCitations, 10)
    : undefined;
  const input: WebAnswerInput = {
    query,
    maxCitations,
    includeSearch: options.includeSearch,
    apiKey,
    fetchFn,
  };

  const { response: result, cached } = await withSpinner(
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
  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'answer' as const,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    timestamp: new Date().toISOString(),
  };
  stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function buildAnswerCommand(
  deps: AnswerCommandDependencies = {},
): Command {
  return new Command('answer')
    .description('Get an LLM-generated answer with citations.')
    .argument('<query...>', 'Question to answer.')
    .option('--provider <slug>', 'Web provider: brave, exa, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--max-citations <n>', 'Cap citations included (default 8).')
    .option('--include-search', 'Also return underlying search results alongside the answer.')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .action(async (queryParts: string[], options: AnswerCommandOptions) => {
      await handleAnswerCommand(queryParts, options, deps);
    });
}
