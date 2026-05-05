import { Command } from 'commander';

import {
  AICliError,
  appendTaskRecord,
  assertProviderEnabled,
  readMarmotConfig,
  resolveProviderAuth,
  resolveRetryOptions,
  resolveWebVerbDefaults,
  runWithPolling,
  runWithRetries,
  updateTaskRecord,
  withSpinner,
  type StatusStream,
  type WebCrawlInput,
  type WebProviderSlug,
  type WebTaskStatus,
} from '@marmot-sh/core';

import {
  assertProviderSupportsVerb,
  getWebProviderAdapter,
} from '../providers/web-index.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';
import { writeEnvelope } from '../lib/data-verb-io.js';

export type CrawlCommandOptions = {
  provider?: string;
  apiKey?: string;
  maxPages?: string;
  maxDepth?: string;
  instructions?: string;
  includePaths?: string;
  excludePaths?: string;
  allowExternal?: boolean;
  wait?: boolean;
  async?: boolean;
  raw?: boolean;
  retries?: string;
  timeout?: string;
  output?: string;
};

export type CrawlCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

function csv(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

export async function handleCrawlCommand(
  url: string | undefined,
  options: CrawlCommandOptions,
  deps: CrawlCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  if (!url) throw new AICliError('validation', 'A URL is required.');
  if (options.wait && options.async) {
    throw new AICliError('validation', '--wait and --async are mutually exclusive.');
  }

  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('crawl', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('crawl', provider);
  assertProviderEnabled(provider, config);
  const adapter = getWebProviderAdapter(provider);
  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'crawl', retries);

  const input: WebCrawlInput = {
    url,
    maxPages: options.maxPages ? Number.parseInt(options.maxPages, 10) : undefined,
    maxDepth: options.maxDepth ? Number.parseInt(options.maxDepth, 10) : undefined,
    instructions: options.instructions,
    includePaths: csv(options.includePaths),
    excludePaths: csv(options.excludePaths),
    allowExternal: options.allowExternal,
    apiKey,
    fetchFn,
  };

  // Tavily is sync; Firecrawl is async.
  if (adapter.crawl) {
    const result = await withSpinner(
      `Crawling ${url} with ${provider}…`,
      () =>
        runWithRetries(
          (abortSignal) => adapter.crawl!({ ...input, abortSignal }),
          { retries, timeoutMs, onRetry },
        ),
      { stream: stderr, env },
    );
    const envelope = {
      ok: true,
      provider: result.provider,
      verb: 'crawl' as const,
      data: options.raw ? null : result.data,
      raw: options.raw ? (result.raw ?? null) : null,
      timestamp: new Date().toISOString(),
    };
    await writeEnvelope(stdout, options.output, envelope);
    return;
  }

  if (!adapter.crawlSubmit || !adapter.getTask) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" lacks crawlSubmit or getTask method.`,
    );
  }
  const submission = await withSpinner(
    `Submitting crawl to ${provider}…`,
    () =>
      runWithRetries(
        (abortSignal) => adapter.crawlSubmit!({ ...input, abortSignal }),
        { retries, timeoutMs, onRetry },
      ),
    { stream: stderr, env },
  );
  await appendTaskRecord(
    {
      taskId: submission.taskId,
      provider: provider as WebProviderSlug,
      verb: 'crawl',
      status: 'queued',
      label: url.slice(0, 256),
    },
    env,
  );

  if (options.async) {
    const envelope = {
      ok: true,
      provider,
      verb: 'crawl' as const,
      taskId: submission.taskId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      next: `marmot get ${submission.taskId} --provider ${provider}`,
    };
    await writeEnvelope(stdout, options.output, envelope);
    return;
  }

  const finalStatus = await withSpinner(
    `Crawling ${url} via ${provider} (${submission.taskId})…`,
    () =>
      runWithPolling<WebTaskStatus>({
        poll: async () => {
          const status = await adapter.getTask!({
            taskId: submission.taskId,
            verb: 'crawl',
            apiKey,
            fetchFn,
          });
          await updateTaskRecord(
            {
              taskId: submission.taskId,
              provider: provider as WebProviderSlug,
              status: status.status,
            },
            env,
          );
          if (status.status === 'done' || status.status === 'failed' || status.status === 'cancelled') {
            return { done: true, value: status };
          }
          return { done: false };
        },
      }),
    { stream: stderr, env },
  );
  const envelope = {
    ok: finalStatus.status === 'done',
    provider,
    verb: 'crawl' as const,
    taskId: submission.taskId,
    status: finalStatus.status,
    data: options.raw ? null : finalStatus.data ?? null,
    raw: options.raw ? finalStatus.raw ?? null : null,
    error: finalStatus.error ?? null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope);
}

export function buildCrawlCommand(
  deps: CrawlCommandDependencies = {},
): Command {
  return new Command('crawl')
    .description('Crawl a domain. Firecrawl is async (polls); Tavily is sync (capped at 150s).')
    .argument('<url>', 'Root URL to crawl.')
    .option('--provider <slug>', 'Web provider: firecrawl, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--max-pages <n>', 'Cap pages crawled.')
    .option('--max-depth <n>', 'Discovery depth.')
    .option('--instructions <text>', 'Natural-language guidance (Tavily; doubles cost).')
    .option('--include-paths <csv>', 'Regex patterns of paths to include.')
    .option('--exclude-paths <csv>', 'Regex patterns of paths to exclude.')
    .option('--allow-external', 'Follow off-domain links.')
    .option('--wait', 'Block until done (default for Firecrawl).')
    .option('--async', 'Return the task id immediately (Firecrawl only).')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--retries <count>', 'Retry the initial submission up to N times (default: 0). Polling is unaffected.')
    .option('--timeout <seconds>', 'Per-attempt submit timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .action(async (url: string, options: CrawlCommandOptions) => {
      await handleCrawlCommand(url, options, deps);
    });
}
