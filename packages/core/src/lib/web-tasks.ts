import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AICliError } from './errors.js';
import { getWebTasksPath } from './paths.js';
import {
  TERMINAL_STATUSES,
  webTasksFileSchema,
  type WebTaskRecord,
  type WebTasksFile,
  type WebTaskRecordStatus,
} from '../schemas/web-tasks.js';

function nowIso(): string {
  return new Date().toISOString();
}

const EMPTY_FILE: WebTasksFile = { version: 1, tasks: [] };

async function readTasksFile(
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebTasksFile> {
  const path = getWebTasksPath(env);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return { ...EMPTY_FILE };
    throw new AICliError('io', `Failed to read tasks index "${path}".`, { cause: error });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new AICliError(
      'cache',
      `Tasks index "${path}" contains invalid JSON. Move or delete it to start fresh.`,
      { cause: error },
    );
  }

  const parsed = webTasksFileSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AICliError(
      'cache',
      `Tasks index "${path}" did not match the expected schema. Move or delete it to start fresh.`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

async function writeTasksFile(
  file: WebTasksFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = getWebTasksPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const validated = webTasksFileSchema.parse(file);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export type AppendTaskInput = {
  taskId: string;
  provider: WebTaskRecord['provider'];
  verb: WebTaskRecord['verb'];
  status?: WebTaskRecordStatus;
  label?: string;
};

/**
 * Append a new task record. If a record with the same {provider, taskId} pair
 * already exists, it is replaced (idempotent — safe to call on retries).
 */
export async function appendTaskRecord(
  input: AppendTaskInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebTaskRecord> {
  const file = await readTasksFile(env);
  const record: WebTaskRecord = {
    taskId: input.taskId,
    provider: input.provider,
    verb: input.verb,
    status: input.status ?? 'queued',
    createdAt: nowIso(),
    lastCheckedAt: null,
    completedAt: null,
    ...(input.label ? { label: input.label.slice(0, 256) } : {}),
  };

  const filtered = file.tasks.filter(
    (t) => !(t.provider === record.provider && t.taskId === record.taskId),
  );
  filtered.push(record);
  await writeTasksFile({ ...file, tasks: filtered }, env);
  return record;
}

export type UpdateTaskInput = {
  taskId: string;
  provider: WebTaskRecord['provider'];
  status?: WebTaskRecordStatus;
  completedAt?: string | null;
};

/**
 * Update fields on an existing task record. Sets lastCheckedAt to now() and
 * stamps completedAt automatically when transitioning to a terminal status.
 * No-op if the record is not in the index.
 */
export async function updateTaskRecord(
  input: UpdateTaskInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebTaskRecord | null> {
  const file = await readTasksFile(env);
  const idx = file.tasks.findIndex(
    (t) => t.provider === input.provider && t.taskId === input.taskId,
  );
  if (idx === -1) return null;

  const existing = file.tasks[idx]!;
  const newStatus = input.status ?? existing.status;
  const completedAt =
    input.completedAt !== undefined
      ? input.completedAt
      : existing.completedAt ??
        (input.status && TERMINAL_STATUSES.includes(input.status) ? nowIso() : null);

  const updated: WebTaskRecord = {
    ...existing,
    status: newStatus,
    lastCheckedAt: nowIso(),
    completedAt,
  };
  file.tasks[idx] = updated;
  await writeTasksFile(file, env);
  return updated;
}

export type ListTasksFilter = {
  provider?: WebTaskRecord['provider'];
  verb?: WebTaskRecord['verb'];
  status?: WebTaskRecordStatus;
  limit?: number;
};

export async function listTaskRecords(
  filter: ListTasksFilter = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebTaskRecord[]> {
  const file = await readTasksFile(env);
  let result = file.tasks;
  if (filter.provider) result = result.filter((t) => t.provider === filter.provider);
  if (filter.verb) result = result.filter((t) => t.verb === filter.verb);
  if (filter.status) result = result.filter((t) => t.status === filter.status);

  // Newest first by createdAt.
  result = [...result].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (filter.limit !== undefined && result.length > filter.limit) {
    return result.slice(0, filter.limit);
  }
  return result;
}

export async function getTaskRecord(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<WebTaskRecord | null> {
  const file = await readTasksFile(env);
  return file.tasks.find((t) => t.taskId === taskId) ?? null;
}

export async function removeTaskRecord(
  taskId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const file = await readTasksFile(env);
  const next = file.tasks.filter((t) => t.taskId !== taskId);
  if (next.length === file.tasks.length) return false;
  await writeTasksFile({ ...file, tasks: next }, env);
  return true;
}

/**
 * Drop terminal-state records older than the cutoff. Returns the number
 * removed. Non-terminal records are never pruned.
 */
export async function pruneTaskRecords(
  options: { olderThanDays?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const days = options.olderThanDays ?? 30;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const file = await readTasksFile(env);
  const survivors: WebTaskRecord[] = [];
  let removed = 0;
  for (const t of file.tasks) {
    if (TERMINAL_STATUSES.includes(t.status)) {
      const ts = t.completedAt ?? t.lastCheckedAt ?? t.createdAt;
      if (new Date(ts).getTime() < cutoffMs) {
        removed += 1;
        continue;
      }
    }
    survivors.push(t);
  }
  if (removed > 0) {
    await writeTasksFile({ ...file, tasks: survivors }, env);
  }
  return removed;
}

export async function tasksFileExists(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  try {
    await stat(getWebTasksPath(env));
    return true;
  } catch {
    return false;
  }
}
