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
import { withPreset } from '../lib/with-preset.js';
import { parseIntFlag } from '../lib/parse-numeric.js';
import { categorizeError, finishCall } from '../lib/usage-recorder.js';
import { resolveSessionBinding } from '../lib/session-binding.js';
import { isDryRun, emitDryRun } from '../lib/dry-run.js';

export type FindallCommandOptions = {
  provider?: string;
  apiKey?: string;
  objective?: string;
  limit?: string | number;
  schema?: string;
  schemaFile?: string;
  entityType?: string;
  matchConditions?: string;
  wait?: boolean;
  async?: boolean;
  raw?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  preset?: string;
  preset_id?: string;
  session?: string;
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
  const positionalObjective = objectiveParts.join(' ');
  const inlineObjective = options.objective
    ? [options.objective, positionalObjective].filter((s) => s.trim().length > 0).join('\n\n')
    : positionalObjective;
  const objective = mergeQueries(deps, inlineObjective, piped, 'Findall');

  const sessionBinding = await resolveSessionBinding(options, env);
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

  const limit = parseIntFlag('limit', options.limit);
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

  const usageFlags: Record<string, string | number | boolean> = {};
  if (limit !== undefined) usageFlags.limit = limit;
  if (options.entityType) usageFlags.entity_type = options.entityType;
  const usagePresence = {
    objective: true,
    schema: Boolean(schema),
    matchConditions: Boolean(matchConditions),
  };
  const usageSensitive = {
    query: objective,
    ...(schema ? { schema: JSON.stringify(schema) } : {}),
    ...(options.matchConditions ? { flags: { matchConditions: options.matchConditions } } : {}),
  };

  if (isDryRun(env)) {
    emitDryRun(
      {
        verb: 'findall',
        provider,
        request: {
          objective_chars: objective.length,
          limit,
          entity_type: options.entityType,
          schema: Boolean(schema),
          match_conditions: Boolean(matchConditions),
          mode: options.async ? 'async' : 'wait',
        },
        retries,
        timeoutMs,
      },
      stdout,
    );
    return;
  }

  const startedAtMs = Date.now();
  let submission: Awaited<ReturnType<NonNullable<typeof adapter.findall>>>;
  try {
    submission = await withSpinner(
      `Submitting findall to ${provider}…`,
      () =>
        runWithRetries(
          (abortSignal) => adapter.findall!({ ...input, abortSignal }),
          { retries, timeoutMs, onRetry },
        ),
      { stream: stderr, env },
    );
  } catch (error) {
    await finishCall(config, {
      verb: 'findall', provider, preset_id: options.preset_id,
      flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
      session: sessionBinding?.name ?? null,
      startedAtMs, cached: false, exit: 'error',
      error_category: categorizeError(error),
    }, env);
    throw error;
  }
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
    await finishCall(config, {
      verb: 'findall', provider, preset_id: options.preset_id,
      flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
      session: sessionBinding?.name ?? null,
      request_id: submission.taskId,
      startedAtMs, cached: false,
      quantity: { tasks: 1 },
      cost: null,
    }, env);
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

  let finalStatus: WebTaskStatus;
  try {
    finalStatus = await withSpinner(
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
  } catch (error) {
    await finishCall(config, {
      verb: 'findall', provider, preset_id: options.preset_id,
      flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
      session: sessionBinding?.name ?? null,
      request_id: submission.taskId,
      startedAtMs, cached: false, exit: 'error',
      error_category: categorizeError(error),
    }, env);
    throw error;
  }
  await finishCall(config, {
    verb: 'findall', provider, preset_id: options.preset_id,
    flags: usageFlags, flag_presence: usagePresence, sensitive: usageSensitive,
    session: sessionBinding?.name ?? null,
    request_id: submission.taskId,
    startedAtMs, cached: false,
    quantity: { tasks: 1, entities: (finalStatus.data as { items?: unknown[] } | undefined)?.items?.length ?? 0 },
    cost: null,
    exit: finalStatus.status === 'done' ? 'ok' : 'error',
    error_category: finalStatus.status === 'done' ? undefined : 'provider',
  }, env);
  await updateTaskRecord(
    { taskId: submission.taskId, provider: provider as WebProviderSlug, usageLogged: true },
    env,
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
    .option('--no-wait', 'Disable wait (overrides preset wait: true).')
    .option('--async', 'Return the task id immediately.')
    .option('--no-async', 'Disable async (overrides preset async: true).')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .option('--no-raw', 'Disable raw envelope (overrides preset raw: true).')
    .option('--retries <count>', 'Retry the initial submission up to N times (default: 0). Polling is unaffected.')
    .option('--timeout <seconds>', 'Per-attempt submit timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('--preset <name>', 'Apply a saved findall preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session so it appears in `marmot session show <name>` and filters by session in usage reports.')
    .action(async (objectiveParts: string[], options: FindallCommandOptions) => {
      const merged = await withPreset(options, 'findall');
      await handleFindallCommand(objectiveParts, merged, deps);
    });
}
