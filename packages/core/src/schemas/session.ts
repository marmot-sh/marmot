import { z } from 'zod';

import { PROVIDERS } from '../lib/constants.js';

const providerSlugSchema = z.enum(PROVIDERS);

export const SESSION_MODES = ['stateless', 'chat'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

// Same slug rules as presets — keep them aligned so users only learn one
// naming convention.
export const SESSION_NAME_REGEX = /^[a-z0-9]+([-_][a-z0-9]+)*$/;

export const sessionTotalsSchema = z
  .object({
    calls: z.number().int().min(0).default(0),
    input_tokens: z.number().int().min(0).default(0),
    output_tokens: z.number().int().min(0).default(0),
    cache_read_tokens: z.number().int().min(0).default(0),
    cache_write_tokens: z.number().int().min(0).default(0),
  })
  .strict();

export type SessionTotals = z.infer<typeof sessionTotalsSchema>;

export const sessionMetaSchema = z
  .object({
    name: z.string().regex(SESSION_NAME_REGEX),
    mode: z.enum(SESSION_MODES),
    preset_id: z.string().uuid().optional(),
    label: z.string().optional(),
    record_prompts: z.boolean().default(false),
    auto_compact: z.boolean().default(false),
    created_at: z.string(),
    last_used_at: z.string().optional(),
    totals: sessionTotalsSchema.default(() => ({
      calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    })),
  })
  .strict();

export type SessionMeta = z.infer<typeof sessionMetaSchema>;

export const VERBS = ['run', 'image', 'speak', 'transcribe'] as const;
export type Verb = (typeof VERBS)[number];

const logTokensSchema = z
  .object({
    input: z.number().int().min(0).optional(),
    output: z.number().int().min(0).optional(),
    cache_read: z.number().int().min(0).optional(),
    cache_write: z.number().int().min(0).optional(),
  })
  .strict();

const logInputSchema = z
  .object({
    prompt_chars: z.number().int().min(0).optional(),
    system_chars: z.number().int().min(0).optional(),
    files: z.number().int().min(0).optional(),
    images: z.number().int().min(0).optional(),
  })
  .strict();

export const logRecordSchema = z
  .object({
    ts: z.string(),
    session: z.string(),
    verb: z.enum(VERBS),
    provider: providerSlugSchema,
    model: z.string().optional(),
    preset_id: z.string().uuid().optional(),
    duration_ms: z.number().int().min(0).optional(),
    input: logInputSchema.optional(),
    tokens: logTokensSchema.optional(),
    key_source: z.string().optional(),
    /** Only present when record_prompts is true on the session. */
    prompt: z.string().optional(),
    /** Only present when record_prompts is true on the session. */
    system: z.string().optional(),
    exit: z.enum(['ok', 'error']),
    error_category: z.string().optional(),
    error_message: z.string().optional(),
  })
  .strict();

export type LogRecord = z.infer<typeof logRecordSchema>;

// -- Chat messages ----------------------------------------------------------

export const CHAT_MESSAGE_ROLES = ['user', 'assistant', 'summary'] as const;
export type ChatMessageRole = (typeof CHAT_MESSAGE_ROLES)[number];

export const chatMessageSchema = z
  .object({
    role: z.enum(CHAT_MESSAGE_ROLES),
    content: z.string(),
    ts: z.string(),
    /** Watermark sentinel — set on a "session mark" record. Phase 3. */
    mark: z.string().optional(),
  })
  .strict();

export type ChatMessage = z.infer<typeof chatMessageSchema>;
