import { Command } from 'commander';

import {
  AICliError,
  getTaskRecord,
  listTaskRecords,
  pruneTaskRecords,
  removeTaskRecord,
  type WebProviderSlug,
  type WebVerb,
} from '@marmot-sh/core';

import { isWebProvider, isWebVerb } from '../../providers/web-capabilities.js';

export type TasksCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
};

type ListOptions = {
  provider?: string;
  verb?: string;
  status?: string;
  limit?: string;
};

async function handleList(
  options: ListOptions,
  deps: TasksCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  let provider: WebProviderSlug | undefined;
  if (options.provider) {
    if (!isWebProvider(options.provider)) {
      throw new AICliError('validation', `Unknown web provider "${options.provider}".`);
    }
    provider = options.provider;
  }
  let verb: WebVerb | undefined;
  if (options.verb) {
    if (!isWebVerb(options.verb)) {
      throw new AICliError('validation', `Unknown verb "${options.verb}".`);
    }
    verb = options.verb;
  }
  const validStatuses = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
  let status: (typeof validStatuses)[number] | undefined;
  if (options.status) {
    if (!(validStatuses as readonly string[]).includes(options.status)) {
      throw new AICliError(
        'validation',
        `Unknown status "${options.status}". Valid: ${validStatuses.join(', ')}.`,
      );
    }
    status = options.status as typeof status;
  }

  const limit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  const tasks = await listTaskRecords({ provider, verb, status, limit }, env);
  const envelope = {
    ok: true,
    data: { tasks, count: tasks.length },
  };
  stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

async function handleShow(
  taskId: string | undefined,
  deps: TasksCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  if (!taskId) throw new AICliError('validation', 'A task id is required.');
  const record = await getTaskRecord(taskId, env);
  if (!record) {
    throw new AICliError('validation', `No local task record for "${taskId}".`);
  }
  const envelope = { ok: true, data: record };
  stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

async function handleRemove(
  taskId: string | undefined,
  deps: TasksCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  if (!taskId) throw new AICliError('validation', 'A task id is required.');
  const ok = await removeTaskRecord(taskId, env);
  if (!ok) {
    throw new AICliError('validation', `No local task record for "${taskId}".`);
  }
  stdout.write(
    `${JSON.stringify({ ok: true, data: { removed: taskId } }, null, 2)}\n`,
  );
}

async function handlePrune(
  options: { olderThan?: string },
  deps: TasksCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const days = options.olderThan ? Number.parseInt(options.olderThan, 10) : undefined;
  const removed = await pruneTaskRecords({ olderThanDays: days }, env);
  stdout.write(
    `${JSON.stringify({ ok: true, data: { removed } }, null, 2)}\n`,
  );
}

export function buildTasksCommand(
  deps: TasksCommandDependencies = {},
): Command {
  const cmd = new Command('tasks').description('Manage the local async-task index.');

  cmd
    .command('list')
    .description('List tracked tasks.')
    .option('--provider <slug>', 'Filter by provider.')
    .option('--verb <name>', 'Filter by verb.')
    .option('--status <name>', 'Filter by status.')
    .option('--limit <n>', 'Cap rows returned.')
    .action(async (options: ListOptions) => handleList(options, deps));

  cmd
    .command('show')
    .description('Show one task record.')
    .argument('<id>', 'Task id.')
    .action(async (id: string) => handleShow(id, deps));

  cmd
    .command('remove')
    .description('Drop a task record from the local index. Does NOT cancel on the provider.')
    .argument('<id>', 'Task id.')
    .action(async (id: string) => handleRemove(id, deps));

  cmd
    .command('prune')
    .description('Remove terminal-state records older than the cutoff.')
    .option('--older-than <days>', 'Cutoff in days (default 30).')
    .action(async (options: { olderThan?: string }) => handlePrune(options, deps));

  return cmd;
}
