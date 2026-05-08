import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { z } from 'zod';

import { AICliError } from '../lib/errors.js';
import { getUsageFilePath } from '../lib/paths.js';
import type { MarmotConfig } from '../schemas/config.js';

/** Resolve whether usage logging is enabled. Default ON. Disabled when
 *  config sets `logging.enabled = false` OR `MARMOT_NO_LOG=1` is set in the
 *  environment. The env var wins so users can suppress logging for one
 *  invocation without rewriting config. */
export function isUsageLoggingEnabled(
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.MARMOT_NO_LOG === '1') return false;
  return config?.logging?.enabled !== false;
}

/** Opt-in audit mode: when true, every usage record includes the
 *  `sensitive` field with prompts, queries, target URLs, and identifier
 *  values. Default false.
 *
 *  Per-call overrides (highest precedence first):
 *  - `MARMOT_REDACT=1` (or `--redact` flag) — force OFF, even when
 *    `logging.recordSensitive: true` is set globally.
 *  - `MARMOT_RECORD_SENSITIVE=1` — force ON for one call without
 *    rewriting config.
 *  - Otherwise: `config.logging.recordSensitive` (default false).
 */
export function shouldRecordSensitive(
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.MARMOT_REDACT === '1') return false;
  if (env.MARMOT_RECORD_SENSITIVE === '1') return true;
  return config?.logging?.recordSensitive === true;
}

/**
 * Privacy-safe usage record. One per metered call, written to
 * `~/.marmot/usage/<YYYY-MM-DD>.jsonl` regardless of session binding.
 *
 * Captures verb shape and outcome, but never prompts, queries, or person
 * identifiers. Sensitive flags (`--include-domains`, `--email`, etc.) are
 * recorded as boolean presence under `flag_presence`, not by value.
 *
 * `quantity` is a verb-aware bag of numeric counts:
 *   - AI verbs: `tokens_input`, `tokens_output`, `tokens_cache_read`,
 *     `tokens_cache_write` (and provider-specific extensions like
 *     `tokens_reasoning`).
 *   - Web verbs: `results`, `pages`, `urls`, `entities`, `citations`, etc.
 *   - Data verbs: `calls`, `entities` for lookup/findall.
 * Aggregators (`marmot usage`) sum any numeric child by key.
 */
export const usageRecordSchema = z
  .preprocess((value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      if (obj.request_id === undefined && typeof obj.call_id === 'string') {
        return { ...obj, request_id: obj.call_id };
      }
    }
    return value;
  }, z
  .object({
    /** Unique identifier for this request. For sync calls a fresh UUID.
     *  For async work (research/findall/crawl), equals the provider's
     *  task id so submit/poll/completion records can be joined by
     *  `request_id`. Pre-0.6.0 records used `call_id`; the schema
     *  preprocesses old records by aliasing `call_id` → `request_id` so
     *  the in-memory shape is uniform. */
    request_id: z.string().min(1),
    /** Legacy alias retained on parsed records for trace continuity.
     *  Optional; not written by new records. */
    call_id: z.string().min(1).optional(),
    /** ISO 8601 timestamp. */
    ts: z.string(),
    /** Verb name (search, scrape, run, image, etc.). */
    verb: z.string().min(1),
    /** Provider slug. */
    provider: z.string().min(1),
    /** Model id (AI verbs and some web verbs). */
    model: z.string().optional(),
    /** Stable preset id when a preset was applied. UUID. Display layer
     *  resolves to the current slug at render time via `getPresetById`. */
    preset_id: z.string().uuid().optional(),
    /** Non-sensitive flag values (limit, depth, freshness, format, etc.).
     *  Sensitive flags must NOT appear here — use flag_presence instead. */
    flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** Boolean indicators for sensitive flags whose values aren't recorded.
     *  Keys: includeDomains, excludeDomains, schema, schemaFile, schemaModule,
     *  email, linkedin, phone, firstName, lastName, etc. */
    flag_presence: z.record(z.string(), z.boolean()).optional(),
    /** True when the response came from the local cache (no network call). */
    cached: z.boolean(),
    /** Wall-clock duration in milliseconds. */
    duration_ms: z.number().int().min(0),
    /** Cost in USD when the provider returned it (OpenRouter, AI Gateway).
     *  null when not reported by the provider. */
    cost: z.number().nullable().optional(),
    /** Verb-aware bag of numeric counts. AI: `tokens_input`, `tokens_output`,
     *  `tokens_cache_read`, `tokens_cache_write`. Web: `results`, `pages`,
     *  `urls`, `entities`. Sum-by-key gives `marmot usage` totals. */
    quantity: z.record(z.string(), z.number().int().min(0)).optional(),
    /** Call outcome. */
    exit: z.enum(['ok', 'error']),
    /** Error category (validation/provider/auth/cache/io) when exit=error. */
    error_category: z.string().optional(),
    /** Session name when bound; null otherwise. */
    session: z.string().nullable().optional(),
    /** Opt-in audit payload. Populated only when
     *  `config.logging.recordSensitive = true`. Contains the user's actual
     *  prompts, queries, target URLs, and identifier values that
     *  `flag_presence` flags as present. NEVER recorded by default. */
    sensitive: z
      .object({
        /** Prompt body (run/image/speak verbs). */
        prompt: z.string().optional(),
        /** System prompt (run verb). */
        system: z.string().optional(),
        /** Search/answer query string. */
        query: z.string().optional(),
        /** Schema body when --schema or --schema-file was used. */
        schema: z.string().optional(),
        /** URLs targeted by scrape/map/crawl. */
        urls: z.array(z.string()).optional(),
        /** Verb-specific flag values whose presence is also recorded in
         *  flag_presence. Keys: includeDomains, excludeDomains, email,
         *  linkedin, phone, firstName, lastName, etc. */
        flags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      })
      .strict()
      .optional(),
  })
  .strict());

export type UsageRecord = z.infer<typeof usageRecordSchema>;

/** Inputs accepted by recordUsage. Mirrors UsageRecord with `ts` and
 *  `request_id` optional — both are filled if missing (`ts` from now,
 *  `request_id` from a fresh UUID). */
export type RecordUsageInput = Omit<UsageRecord, 'ts' | 'request_id'> & {
  ts?: string;
  request_id?: string;
};

/** Generate a fresh request id. Wraps Node's randomUUID for testability. */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Append a usage record to today's `~/.marmot/usage/<UTC-DATE>.jsonl` file.
 * Best-effort — failures are swallowed so logging never breaks a real call.
 *
 * Disabled when:
 * - `MARMOT_NO_LOG=1` is set
 * - The record-pre-stripping caller chose not to call recordUsage at all
 *   (caller should consult `isUsageLoggingEnabled` first)
 *
 * The config-level disable (`logging.enabled = false`) is checked by the
 * caller via `isUsageLoggingEnabled`, not here, to avoid re-reading config
 * on every call.
 */
export async function recordUsage(
  input: RecordUsageInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (env.MARMOT_NO_LOG === '1') return;

  let record: UsageRecord;
  try {
    record = usageRecordSchema.parse({
      ...input,
      ts: input.ts ?? new Date().toISOString(),
      request_id: input.request_id ?? newRequestId(),
    });
  } catch (error) {
    // Schema rejection means caller passed something nonconforming. Swallow
    // rather than crash the user's actual call; surface in tests.
    if (env.MARMOT_USAGE_STRICT === '1') {
      throw new AICliError('validation', 'Usage record schema validation failed.', {
        cause: error,
      });
    }
    return;
  }

  const path = getUsageFilePath(new Date(record.ts), env);
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Best-effort. Adapter call already succeeded; logging failure
    // shouldn't poison the response.
  }
}
