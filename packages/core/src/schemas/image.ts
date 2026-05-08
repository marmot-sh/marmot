import { z } from 'zod';

import { DEFAULT_IMAGE_TIMEOUT_MS } from '../lib/retry.js';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  type ProviderSlug,
} from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';

export const imageProviderSlugSchema = z.enum(PROVIDERS);

const sizePattern = /^\d+x\d+$/;

const imageRunInputSchema = z.object({
  provider: imageProviderSlugSchema.default(DEFAULT_PROVIDER),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1).optional(),
  outputPath: z.string().trim().min(1).optional(),
  promptFilePath: z.string().trim().min(1).optional(),
  inlinePrompt: z.string().optional(),
  promptFileContent: z.string().optional(),
  stdinContent: z.string().optional(),
  n: z.coerce.number().int().min(1).max(10).default(1),
  size: z
    .string()
    .trim()
    .regex(sizePattern, 'Size must look like 1024x1024.')
    .optional(),
  quality: z.string().trim().min(1).optional(),
  style: z.string().trim().min(1).optional(),
  seed: z.coerce.number().int().optional(),
  negative: z.string().optional(),
  binary: z.boolean().default(false),
  b64: z.boolean().default(false),
  json: z.boolean().default(false),
  retries: z.coerce.number().int().min(0).max(10).default(0),
  timeoutSeconds: z
    .coerce.number()
    .int()
    .min(1)
    .max(86_400)
    .default(DEFAULT_IMAGE_TIMEOUT_MS / 1_000),
}).superRefine((value, context) => {
  const hasInlinePrompt = Boolean(value.inlinePrompt?.trim());
  const hasPromptFile = Boolean(value.promptFileContent?.trim());
  const hasStdin = Boolean(value.stdinContent?.trim());

  if (!hasInlinePrompt && !hasPromptFile && !hasStdin) {
    context.addIssue({
      code: 'custom',
      message: 'Provide a prompt via argument, --prompt-file, or piped stdin.',
      path: ['inlinePrompt'],
    });
  }

  if (value.binary && value.b64) {
    context.addIssue({
      code: 'custom',
      message: 'Specify only one of --binary or --b64.',
      path: ['binary'],
    });
  }

  if (value.binary && value.n > 1) {
    context.addIssue({
      code: 'custom',
      message: '--binary is only valid with --n 1. Use --output ./out-{i}.png for multiple images.',
      path: ['binary'],
    });
  }
});

export type RawImageRunInput = {
  provider?: string;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  promptFilePath?: string;
  inlinePrompt?: string;
  promptFileContent?: string;
  stdinContent?: string;
  n?: string | number;
  size?: string;
  quality?: string;
  style?: string;
  seed?: string | number;
  negative?: string;
  binary?: boolean;
  b64?: boolean;
  json?: boolean;
  retries?: string | number;
  timeoutSeconds?: string | number;
};

export type ResolvedImageRunInput = {
  provider: ProviderSlug;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  promptFilePath?: string;
  prompt: string;
  n: number;
  size?: string;
  quality?: string;
  style?: string;
  seed?: number;
  negative?: string;
  binary: boolean;
  b64: boolean;
  json: boolean;
  retries: number;
  timeoutMs: number;
};

function mergePromptSources(...sources: Array<string | undefined>): string {
  return sources
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n');
}

export function resolveImageRunInput(
  rawInput: RawImageRunInput,
): ResolvedImageRunInput {
  const parsed = imageRunInputSchema.safeParse(rawInput);

  if (!parsed.success) {
    throw new AICliError(
      'validation',
      parsed.error.issues.map((issue) => issue.message).join(' '),
      { cause: parsed.error },
    );
  }

  const prompt = mergePromptSources(
    parsed.data.inlinePrompt,
    parsed.data.promptFileContent,
    parsed.data.stdinContent,
  );

  if (!prompt.trim()) {
    throw new AICliError('validation', 'The resolved image prompt is empty.');
  }

  return {
    provider: parsed.data.provider,
    model: parsed.data.model,
    apiKey: parsed.data.apiKey,
    outputPath: parsed.data.outputPath,
    promptFilePath: parsed.data.promptFilePath,
    prompt,
    n: parsed.data.n,
    size: parsed.data.size,
    quality: parsed.data.quality,
    style: parsed.data.style,
    seed: parsed.data.seed,
    negative: parsed.data.negative,
    binary: parsed.data.binary,
    b64: parsed.data.b64,
    json: parsed.data.json,
    retries: parsed.data.retries,
    timeoutMs: parsed.data.timeoutSeconds * 1_000,
  };
}
