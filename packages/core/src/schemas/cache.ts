import { z } from 'zod';

import { PROVIDERS } from '../lib/constants.js';

export const providerModelPricingSchema = z.object({
  prompt: z.string().nullable(),
  completion: z.string().nullable(),
  request: z.string().nullable(),
  image: z.string().nullable(),
});

export const providerModelCacheEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  contextLength: z.number().int().positive().nullable(),
  pricing: providerModelPricingSchema.nullable(),
  inputModalities: z.array(z.string()),
  outputModalities: z.array(z.string()),
  updatedAt: z.string().datetime().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

export const providerCacheSchema = z.object({
  version: z.literal(1),
  provider: z.enum(PROVIDERS),
  defaultModel: z.string().min(1),
  fetchedAt: z.string().datetime(),
  models: z.array(providerModelCacheEntrySchema),
});
