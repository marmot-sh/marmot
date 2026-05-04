import { z } from 'zod';

import { PROVIDERS } from '../lib/constants.js';

const usageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  costCredits: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().nullable().optional(),
  costSource: z.enum(['provider-cache', 'config-override']).optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
  cacheWriteInputTokens: z.number().int().nonnegative().optional(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  costDetails: z.object({
    upstreamInferenceCostCredits: z.number().nonnegative().optional(),
  }).optional(),
});

export const normalizedRunResultSchema = z.object({
  ok: z.literal(true),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
  text: z.string(),
  usage: usageSchema,
  finishReason: z.string().nullable(),
  cachedModelValidated: z.boolean(),
  outputFile: z.string().nullable(),
  timestamp: z.string().datetime(),
});

export const normalizedObjectRunResultSchema = z.object({
  ok: z.literal(true),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1),
  output: z.unknown(),
  usage: usageSchema,
  finishReason: z.string().nullable(),
  cachedModelValidated: z.boolean(),
  outputFile: z.string().nullable(),
  timestamp: z.string().datetime(),
});
