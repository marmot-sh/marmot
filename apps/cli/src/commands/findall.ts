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
  type WebFindallInput,
  type WebProviderSlug,
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

export type FindallCommandOptions = {
  provider?: string;
  apiKey?: string;
  limit?: string;
  schema?: string;
  schemaFile?: string;
  entityType?: string;
  matchConditions?: string;
  wait?: boolean;
  async?: boolean;
  raw?: boolean;
  retries?: string;
  timeout?: string;
  output?: string;
};

export type FindallCommandDependencies = DataVerbDependencies & {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleFindallCommand(
  objectiveParts: string[],
  options: FindallCommandOptions,
  deps: FindallCommandDependencies = {},
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
  const objective = mergeQueries(deps, objectiveParts.join(' '), piped, 'Findall');

  const config = await readMarmotConfig(env);
  const { provider } = resolveWebVerbDefaults('findall', config, {
    provider: options.provider,
  });
  assertProviderSupportsVerb('findall', provider);
  assertProviderEnabled(provider, config);
  const adapter = getWebProviderAdapter(provider);
  if (!adapter.findall || !adapter.getTask) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" lacks findall or getTask method.`,
    );
  }
  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'findall', retries);

  let schema: unknown | undefined;
  if (options.schema) {
    try {
      schema = JSON.parse(options.schema);
    } catch (error) {
      throw new AICliError('validation', '--schema is not valid JSON.', { cause: error });
    }
  } else if (options.schemaFile) {
    const { readFile } = await import('node:fs/promises');
    schema = JSON.parse(await readFile(options.schemaFile, 'utf8'));
  }

  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  let matchConditions: WebFindallInput['matchConditions'];
  if (options.matchConditions) {
    try {
      matchConditions = JSON.parse(options.matchConditions);
    } catch (error) {
      throw new AICliError(
        'validation',
        '--match-conditions must be valid JSON (e.g. \'[{"name":"...","description":"..."}]\').',
        { cause: error },
      );
    }
  }
  const input: WebFindallInput = {
    objective,
    limit,
    schema,
    entityType: options.entityType,
    matchConditions,
    apiKey,
    fetchFn,
  };

  const submission = await withSpinner(
    `Submitting findall to ${provider}…`,
    () =>
      runWithRetries(
        (abortSignal) => adapter.findall!({ ...input, abortSignal }),
        { retries, timeoutMs, onRetry },
      ),
    { stream: stderr, env },
  );
  await appendTaskRecord(
    {
      taskId: submission.taskId,
      provider: provider as WebProviderSlug,
      verb: 'findall',
      status: 'queued',
      label: objective.slice(0, 256),
    },
    env,
  );

  if (options.async) {
    const envelope = {
      ok: true,
      provider,
      verb: 'findall' as const,
      taskId: submission.taskId,
      status: 'queued',
      createdAt: new Date().toISOString(),
      next: `marmot get ${submission.taskId} --provider ${provider}`,
    };
    await writeEnvelope(stdout, options.output, envelope);
    return;
  }

  const finalStatus = await withSpinner(
    `Building list via ${provider} (${submission.taskId})…`,
    () =>
      runWithPolling<WebTaskStatus>({
        poll: async () => {
          const status = await adapter.getTask!({
            taskId: submission.taskId,
            verb: 'findall',
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
    verb: 'findall' as const,
    taskId: submission.taskId,
    status: finalStatus.status,
    data: options.raw ? null : finalStatus.data ?? null,
    raw: options.raw ? finalStatus.raw ?? null : null,
    error: finalStatus.error ?? null,
    timestamp: new Date().toISOString(),
  };
  await writeEnvelope(stdout, options.output, envelope);
}

export function buildFindallCommand(
  deps: FindallCommandDependencies = {},
): Command {
  return new Command('findall')
    .description('Build a list of entities matching a natural-language objective.')
    .argument('[objective...]', 'Natural-language description of the list to build. Falls back to stdin when omitted; merges with stdin when both are provided.')
    .option('--provider <slug>', 'Web provider: exa, parallel.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--limit <n>', 'Max items to find.')
    .option('--schema <json>', 'Inline JSON Schema for items.')
    .option('--schema-file <path>', 'Path to a JSON Schema file.')
    .option('--entity-type <name>', 'Entity type for the search (required by Parallel; ignored by Exa).')
    .option('--match-conditions <json>', 'JSON array of {name, description} conditions (Parallel-rich; Exa auto-derives).')
    .option('--wait', 'Block until done (default).')
    .option('--async', 'Return the task id immediately.')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--retries <count>', 'Retry the initial submission up to N times (default: 0). Polling is unaffected.')
    .option('--timeout <seconds>', 'Per-attempt submit timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .action(async (objectiveParts: string[], options: FindallCommandOptions) => {
      await handleFindallCommand(objectiveParts, options, deps);
    });
}
