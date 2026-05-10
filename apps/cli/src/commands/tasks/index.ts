import { Command } from 'commander';

import {
  AICliError,
  getTaskRecord,
  listTaskRecords,
  parseDuration,
  pruneTaskRecords,
  removeTaskRecord,
  type WebProviderSlug,
  type WebVerb,
} from '@marmot-sh/core';

import { isWebProvider, isWebVerb } from '../../providers/web-capabilities.js';
import { renderList, renderRecord, type Column, type Section } from '../../lib/list-renderer.js';
import { resolveOutputMode, addOutputModeOptions, type OutputModeOptions } from '../../lib/output-mode-options.js';

export type TasksCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
};

type ListOptions = OutputModeOptions & {
  provider?: string;
  verb?: string;
  status?: string;
  limit?: string;
  since?: string;
};

type TaskRow = {
  taskId: string;
  verb: string;
  provider: string;
  status: string;
  createdAt: string;
  label?: string;
};

const TASK_COLUMNS: Column<TaskRow>[] = [
  { key: 'taskId', header: 'TASK ID', format: (r) => r.taskId.slice(0, 12) },
  { key: 'verb', header: 'VERB' },
  { key: 'provider', header: 'PROVIDER' },
  { key: 'status', header: 'STATUS' },
  { key: 'createdAt', header: 'CREATED' },
];

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

  const DEFAULT_LIMIT = 20;
  const MAX_LIMIT = 1000;
  const requestedLimit = options.limit ? Number.parseInt(options.limit, 10) : undefined;
  if (requestedLimit !== undefined && (!Number.isFinite(requestedLimit) || requestedLimit < 1)) {
    throw new AICliError('validation', '--limit must be a positive integer.');
  }
  if (requestedLimit !== undefined && requestedLimit > MAX_LIMIT) {
    throw new AICliError('validation', `--limit cannot exceed ${MAX_LIMIT}.`);
  }

  // Pull the unfiltered set first so we can report total vs returned.
  const allMatching = await listTaskRecords({ provider, verb, status }, env);
  let filtered = allMatching;
  if (options.since) {
    const sinceMs = Date.now() - parseDuration(options.since);
    filtered = filtered.filter((t) => new Date(t.createdAt).getTime() >= sinceMs);
  }
  const total = filtered.length;
  const effectiveLimit = requestedLimit ?? DEFAULT_LIMIT;
  const tasks = filtered.slice(0, effectiveLimit);
  const returned = tasks.length;

  const renderMode = resolveOutputMode(options, stdout as NodeJS.WriteStream);

  // JSON keeps the today-style envelope shape exactly: { ok, data: { tasks, count } }.
  if (renderMode === 'json') {
    const envelope = {
      ok: true,
      data: { tasks, count: returned, total, limit: effectiveLimit },
    };
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  const rows: TaskRow[] = tasks.map((t) => ({
    taskId: t.taskId,
    verb: t.verb,
    provider: t.provider,
    status: t.status,
    createdAt: t.createdAt,
    label: t.label,
  }));
  const footer =
    total > returned
      ? `Showing ${returned} of ${total} tasks. Pass --limit ${MAX_LIMIT} or filters (--since, --status, --verb, --provider) to narrow.`
      : returned === 0
        ? undefined
        : `${returned} task${returned === 1 ? '' : 's'}.`;
  stdout.write(
    renderList({
      rows,
      columns: TASK_COLUMNS,
      mode: renderMode,
      envelopeKey: 'tasks',
      emptyMessage: 'No tasks match the filters.',
      footer,
    }) + '\n',
  );
}

async function handleShow(
  taskId: string | undefined,
  options: OutputModeOptions = {},
  deps: TasksCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  if (!taskId) throw new AICliError('validation', 'A task id is required.');
  const record = await getTaskRecord(taskId, env);
  if (!record) {
    throw new AICliError('validation', `No local task record for "${taskId}".`);
  }
  const renderMode = resolveOutputMode(options, stdout as NodeJS.WriteStream);
  if (renderMode === 'json') {
    stdout.write(`${JSON.stringify({ ok: true, data: record }, null, 2)}\n`);
    return;
  }
  const flat: Record<string, unknown> = { ...record };
  const sections: Section<typeof flat>[] = [
    { title: 'Identity', keys: ['taskId', 'provider', 'verb', 'label'] },
    { title: 'Status', keys: ['status', 'usageLogged'] },
    { title: 'Timestamps', keys: ['createdAt', 'lastCheckedAt', 'completedAt'] },
  ];
  stdout.write(
    renderRecord({
      record: flat,
      mode: renderMode,
      envelopeKey: 'task',
      sections,
      title: `Task ${taskId.slice(0, 12)}`,
    }) + '\n',
  );
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

  addOutputModeOptions(
    cmd
      .command('list')
      .description('List tracked tasks. Default: human-readable on TTY, JSON when piped.')
      .option('--provider <slug>', 'Filter by provider.')
      .option('--verb <name>', 'Filter by verb.')
      .option('--status <name>', 'Filter by status (queued, running, done, failed, cancelled).')
      .option('--since <duration>', 'Only show tasks created within this window (e.g. 1h, 24h, 7d).')
      .option('--limit <n>', 'Cap rows returned (default 20, max 1000).'),
  ).action(async (options: ListOptions) => handleList(options, deps));

  addOutputModeOptions(
    cmd
      .command('show')
      .description('Show one task record.')
      .argument('<id>', 'Task id.'),
  ).action(async (id: string, options: OutputModeOptions) => handleShow(id, options, deps));

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
