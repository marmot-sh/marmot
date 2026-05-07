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
  type WebProviderSlug,
  type WebResearchInput,
  type WebTaskStatus,
} from '@marmot-sh/core';

import {
  assertProviderSupportsVerb,
  getWebProviderAdapter,
} from '../providers/web-index.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';
import {
  mergeQueries,
  readQueryStdin,
  writeEnvelope,
  type DataVerbDependencies,
} from '../lib/data-verb-io.js';
import { withPreset } from '../lib/with-preset.js';
import { categorizeError, finishCall } from '../lib/usage-recorder.js';

export type ResearchCommandOptions = {
  provider?: string;
  apiKey?: string;
  schema?: string;
  schemaFile?: string;
  depth?: 'basic' | 'standard' | 'deep';
  instructions?: string;
  wait?: boolean;
  async?: boolean;
  pollInterval?: string;
  maxWait?: string | number;
  raw?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  preset?: string;
};

export type ResearchCommandDependencies = DataVerbDependencies & {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

function parsePositiveSeconds(value: string | number, label: string): number {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new AICliError(
      'validation',
      `--${label} must be a positive integer (got "${value}").`,
    );
  }
  return n;
}

/**
 * Build a poll schedule (in ms) from a `--poll-interval` value. Accepts
 * a single integer ("5" → repeat 5s) or a csv ("5,10,30" → 5s, 10s, then
 * 30s repeating) so users can shape their own backoff.
 */
function buildSchedule(raw: string): number[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new AICliError('validation', '--poll-interval must not be empty.');
  }
  return parts.map((p, i) => parsePositiveSeconds(p, `poll-interval[${i}]`) * 1_000);
}

async function loadSchema(
  options: ResearchCommandOptions,
): Promise<unknown | undefined> {
  if (options.schema) {
    try {
      return JSON.parse(options.schema);
    } catch (error) {
      throw new AICliError('validation', '--schema is not valid JSON.', { cause: error });
    }
  }
  if (options.schemaFile) {
    const { readFile } = await import('node:fs/promises');
    let raw: string;
    try {
      raw = await readFile(options.schemaFile, 'utf8');
    } catch (error) {
      throw new AICliError('io', `Failed to read schema file "${options.schemaFile}".`, { cause: error });
    }
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new AICliError('validation', `Schema file "${options.schemaFile}" is not valid JSON.`, { cause: error });
    }
  }
  return undefined;
}

export async function handleResearchCommand(
  queryParts: string[],
  options: ResearchCommandOptions,
  deps: ResearchCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  if (options.wait && options.async) {
    throw new AICliError(
      'validation',
      '--wait and --async are mutually exclusive.',
    );
  }

  const piped = await readQueryStdin(deps);
  const query = mergeQueries(deps, queryParts.join(' '), piped, 'Research');

  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('research', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('research', provider);
  assertProviderEnabled(provider, config);
  const adapter = getWebProviderAdapter(provider);
  if (!adapter.research || !adapter.getTask) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" lacks research or getTask method.`,
    );
  }

  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'research', retries);
  const schema = await loadSchema(options);

  const input: WebResearchInput = {
    query,
    schema,
    depth: options.depth,
    instructions: options.instructions,
    apiKey,
    fetchFn,
  };

  const usageFlags: Record<string, string | number | boolean> = {};
  if (options.depth) usageFlags.depth = options.depth;
  const usagePresence = {
    query: true,
    schema: Boolean(schema),
    instructions: Boolean(options.instructions),
  };
  const usageSensitive = {
    query,
    ...(schema ? { schema: typeof schema === 'string' ? schema : JSON.stringify(schema) } : {}),
    ...(options.instructions ? { flags: { instructions: options.instructions } } : {}),
  };

  const startedAtMs = Date.now();
  let submission: Awaited<ReturnType<NonNullable<typeof adapter.research>>>;
  try {
    submission = await withSpinner(
      `Submitting research to ${provider}…`,
      () =>
        runWithRetries(
          (abortSignal) => adapter.research!({ ...input, abortSignal }),
          { retries, timeoutMs, onRetry },
        ),
      { stream: stderr, env },
    );
  } catch (error) {
    await finishCall(config, {
      verb: 'research', provider, preset: options.preset,
      flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
      startedAtMs, cached: false, exit: 'error',
      error_category: categorizeError(error),
    }, env);
    throw error;
  }
  await appendTaskRecord(
    {
      taskId: submission.taskId,
      provider: provider as WebProviderSlug,
      verb: 'research',
      status: 'queued',
      label: query.slice(0, 256),
    },
    env,
  );

  // --async: return immediately.
  if (options.async) {
    await finishCall(config, {
      verb: 'research', provider, preset: options.preset,
      flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
      call_id: submission.taskId,
      startedAtMs, cached: false,
      quantity: { tasks: 1 },
      cost: null,
    }, env);
    const envelope = {
      ok: true as const,
      provider,
      verb: 'research' as const,
      taskId: submission.taskId,
      status: 'queued' as const,
      createdAt: new Date().toISOString(),
      next: `marmot get ${submission.taskId} --provider ${provider}`,
    };
    await writeEnvelope(stdout, options.output, envelope);
    return;
  }

  // --wait (default): poll until done.
  const pollSchedule = options.pollInterval
    ? buildSchedule(options.pollInterval)
    : undefined;
  const maxWaitMs = options.maxWait
    ? parsePositiveSeconds(options.maxWait, 'max-wait') * 1_000
    : undefined;
  let finalStatus: WebTaskStatus;
  try {
    finalStatus = await withSpinner(
      `Researching via ${provider} (${submission.taskId})…`,
      () =>
        runWithPolling<WebTaskStatus>({
          schedule: pollSchedule,
          maxWaitMs,
          poll: async () => {
            const status = await adapter.getTask!({
              taskId: submission.taskId,
              verb: 'research',
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
  } catch (error) {
    await finishCall(config, {
      verb: 'research', provider, preset: options.preset,
      flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
      call_id: submission.taskId,
      startedAtMs, cached: false, exit: 'error',
      error_category: categorizeError(error),
    }, env);
    throw error;
  }
  await finishCall(config, {
    verb: 'research', provider, preset: options.preset,
    flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
    call_id: submission.taskId,
    startedAtMs, cached: false,
    quantity: { tasks: 1 },
    cost: null,
    exit: finalStatus.status === 'done' ? 'ok' : 'error',
    error_category: finalStatus.status === 'done' ? undefined : 'provider',
  }, env);

  const envelope = {
    ok: finalStatus.status === 'done',
    provider,
    verb: 'research' as const,
    taskId: submission.taskId,
    status: finalStatus.status,
    data: options.raw ? null : finalStatus.data ?? null,
    raw: options.raw ? finalStatus.raw ?? null : null,
    error: finalStatus.error ?? null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope);
}

export function buildResearchCommand(
  deps: ResearchCommandDependencies = {},
): Command {
  return new Command('research')
    .description('Run a deep-research task. Async — blocks by default until done.')
    .argument('[query...]', 'Research question. Falls back to stdin when omitted; merges with stdin when both are provided.')
    .option('--provider <slug>', 'Web provider: exa, firecrawl, parallel, tavily.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--schema <json>', 'Inline JSON Schema for structured output.')
    .option('--schema-file <path>', 'Path to a JSON Schema file.')
    .option('--depth <tier>', 'Depth: basic, standard (default), deep.')
    .option('--instructions <text>', 'Optional system instructions.')
    .option('--wait', 'Block until done (default).')
    .option('--async', 'Return the task id immediately and exit.')
    .option('--poll-interval <s>', 'Override the poll cadence in seconds (advanced). Single value or csv (e.g. "5,10,30") for backoff steps.')
    .option('--max-wait <s>', 'Maximum total wait time in seconds. Default 900 (15 minutes).')
    .option('--raw', "Emit the provider's native response under `raw` (only on completion).")
    .option('--retries <count>', 'Retry the initial submission up to N times (default: 0). Polling is unaffected.')
    .option('--timeout <seconds>', 'Per-attempt submit timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('--preset <name>', 'Apply a saved research preset as defaults (explicit flags still win). Shorthand: @name.')
    .action(async (queryParts: string[], options: ResearchCommandOptions) => {
      const merged = await withPreset(options, 'research');
      await handleResearchCommand(queryParts, merged, deps);
    });
}
