import { z } from 'zod';

import { WEB_PROVIDERS, WEB_VERBS } from '../lib/constants.js';

export const WEB_TASK_STATUSES = [
  'queued',
  'running',
  'done',
  'failed',
  'cancelled',
] as const;

export type WebTaskRecordStatus = (typeof WEB_TASK_STATUSES)[number];

export const webTaskRecordSchema = z
  .object({
    taskId: z.string().min(1),
    provider: z.enum(WEB_PROVIDERS),
    verb: z.enum(WEB_VERBS),
    status: z.enum(WEB_TASK_STATUSES),
    createdAt: z.string(),
    lastCheckedAt: z.string().nullable().default(null),
    completedAt: z.string().nullable().default(null),
    label: z.string().max(256).optional(),
    usageLogged: z.boolean().optional(),
  })
  .strict();

export type WebTaskRecord = z.infer<typeof webTaskRecordSchema>;

export const webTasksFileSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(webTaskRecordSchema).default(() => []),
  })
  .strict();

export type WebTasksFile = z.infer<typeof webTasksFileSchema>;

export const TERMINAL_STATUSES: readonly WebTaskRecordStatus[] = [
  'done',
  'failed',
  'cancelled',
];

export function isTerminalStatus(status: WebTaskRecordStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
