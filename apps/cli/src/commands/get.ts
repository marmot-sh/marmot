import { Command } from 'commander';

import {
  AICliError,
  assertProviderEnabled,
  getTaskRecord,
  readMarmotConfig,
  resolveProviderAuth,
  runWithPolling,
  updateTaskRecord,
  withSpinner,
  type StatusStream,
  type WebProviderSlug,
  type WebTaskStatus,
  type WebVerb,
} from '@marmot-sh/core';

import {
  assertProviderSupportsVerb,
  getWebProviderAdapter,
} from '../providers/web-index.js';
import { isWebProvider, isWebVerb } from '../providers/web-capabilities.js';
import { finishCall } from '../lib/usage-recorder.js';

export type GetCommandOptions = {
  provider?: string;
  verb?: string;
  apiKey?: string;
  wait?: boolean;
  raw?: boolean;
};

export type GetCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

export async function handleGetCommand(
  taskId: string | undefined,
  options: GetCommandOptions,
  deps: GetCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  if (!taskId) throw new AICliError('validation', 'A task id is required.');

  // Look up the local task index first — it stores `provider` and `verb`
  // for every task that was submitted via marmot. When the user passes
  // just the id, we can recover both fields without forcing them to
  // re-type what they already told us.
  const local = await getTaskRecord(taskId, env);

  const providerSlug = options.provider ?? local?.provider;
  if (!providerSlug) {
    throw new AICliError(
      'validation',
      `\`marmot get\` could not infer the provider for task "${taskId}" from the local task index. Re-run with \`--provider <slug>\` (the provider that issued this id).`,
    );
  }
  if (!isWebProvider(providerSlug)) {
    throw new AICliError('validation', `Unknown web provider "${providerSlug}".`);
  }
  const provider: WebProviderSlug = providerSlug;

  // Resolve verb: explicit --verb, then the local task index.
  let verb: WebVerb | undefined;
  if (options.verb) {
    if (!isWebVerb(options.verb)) {
      throw new AICliError('validation', `Unknown verb "${options.verb}".`);
    }
    verb = options.verb;
  } else if (local && local.provider === provider) {
    verb = local.verb;
  }
  if (!verb) {
    throw new AICliError(
      'validation',
      'Could not infer the task verb. Pass `--verb research|crawl|findall`.',
    );
  }
  assertProviderSupportsVerb(verb, provider);
  const config = await readMarmotConfig(env);
  assertProviderEnabled(provider, config);

  const adapter = getWebProviderAdapter(provider);
  if (!adapter.getTask) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" does not implement getTask.`,
    );
  }
  const { apiKey } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });

  const fetchOnce = async (): Promise<WebTaskStatus> => {
    const status = await adapter.getTask!({
      taskId,
      verb: verb!,
      apiKey,
      fetchFn,
    });
    await updateTaskRecord(
      { taskId, provider, status: status.status },
      env,
    );
    return status;
  };

  // Reload the task record's pre-update state so we can detect whether
  // this `marmot get` invocation needs to log a completion event. The
  // submit-time record already covered "queued"; this writes the
  // terminal-state record so analytics know when async work actually
  // finished and whether it succeeded.
  const recordBeforeFetch = local;

  let final: WebTaskStatus;
  if (options.wait) {
    final = await withSpinner(
      `Polling ${verb} ${taskId} on ${provider}…`,
      () =>
        runWithPolling<WebTaskStatus>({
          poll: async () => {
            const s = await fetchOnce();
            if (s.status === 'done' || s.status === 'failed' || s.status === 'cancelled') {
              return { done: true, value: s };
            }
            return { done: false };
          },
        }),
      { stream: stderr, env },
    );
  } else {
    final = await fetchOnce();
  }

  const isTerminal =
    final.status === 'done' || final.status === 'failed' || final.status === 'cancelled';
  if (isTerminal && !recordBeforeFetch?.usageLogged) {
    const startedAtMs = recordBeforeFetch
      ? Date.parse(recordBeforeFetch.createdAt)
      : Date.now();
    await finishCall(config, {
      verb,
      provider,
      call_id: taskId,
      startedAtMs,
      cached: false,
      cost: null,
      quantity: { tasks: 1 },
      exit: final.status === 'done' ? 'ok' : 'error',
      error_category: final.status === 'done' ? undefined : 'provider',
    }, env);
    await updateTaskRecord({ taskId, provider, usageLogged: true }, env);
  }

  const envelope = {
    ok: final.status === 'done' || final.status === 'queued' || final.status === 'running',
    provider,
    verb,
    taskId,
    status: final.status,
    data: options.raw ? null : final.data ?? null,
    raw: options.raw ? final.raw ?? null : null,
    error: final.error ?? null,
    timestamp: new Date().toISOString(),
  };
  stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function buildGetCommand(
  deps: GetCommandDependencies = {},
): Command {
  return new Command('get')
    .description('Poll/retrieve an async task by id.')
    .argument('<id>', 'Task id (returned by --async).')
    .option('--provider <slug>', 'Provider that issued the task. Inferred from the local task index when present; required only when the task isn\'t in the index.')
    .option('--verb <name>', 'Verb (research, crawl, findall). Inferred from local index when possible.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--wait', 'Block and re-poll until terminal status.')
    .option('--raw', "Emit the provider's native response under `raw`.")
    .action(async (id: string, options: GetCommandOptions) => {
      await handleGetCommand(id, options, deps);
    });
}
