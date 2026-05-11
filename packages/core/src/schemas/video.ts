import { z } from 'zod';

import { DEFAULT_VIDEO_TIMEOUT_MS } from '../lib/retry.js';
import { DEFAULT_PROVIDER, PROVIDERS, type ProviderSlug } from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';

export const videoProviderSlugSchema = z.enum(PROVIDERS);

const aspectPattern = /^\d+:\d+$/;
const resolutionPattern = /^(\d+p|4k|\d+x\d+)$/i;

const videoRunInputSchema = z.object({
  provider: videoProviderSlugSchema.default(DEFAULT_PROVIDER),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1).optional(),
  outputPath: z.string().trim().min(1).optional(),
  promptFilePath: z.string().trim().min(1).optional(),
  inlinePrompt: z.string().optional(),
  promptFileContent: z.string().optional(),
  stdinContent: z.string().optional(),
  aspect: z
    .string()
    .trim()
    .regex(aspectPattern, 'Aspect must be in W:H form, e.g. "16:9".')
    .optional(),
  resolution: z
    .string()
    .trim()
    .regex(
      resolutionPattern,
      'Resolution must be a label like 720p, 1080p, 4k, or a WxH like 1280x720.',
    )
    .optional(),
  duration: z.coerce.number().int().min(1).max(60).optional(),
  fps: z.coerce.number().int().min(1).max(120).optional(),
  audio: z.boolean().optional(),
  imagePaths: z.array(z.string().trim().min(1)).default([]),
  n: z.coerce.number().int().min(1).max(4).default(1),
  seed: z.coerce.number().int().optional(),
  binary: z.boolean().default(false),
  b64: z.boolean().default(false),
  json: z.boolean().default(false),
  quiet: z.boolean().default(false),
  retries: z.coerce.number().int().min(0).max(10).default(0),
  timeoutSeconds: z
    .coerce.number()
    .int()
    .min(1)
    .max(86_400)
    // Video generation is async and can take minutes — default longer than
    // text/image. The provider-side polling timeout is also bumped via
    // providerOptions to keep up with this.
    .default(DEFAULT_VIDEO_TIMEOUT_MS / 1_000),
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
      message: '--binary is only valid with --n 1. Use --output ./out-{i}.mp4 for multiple clips.',
      path: ['binary'],
    });
  }

  if (value.imagePaths.length > 2) {
    context.addIssue({
      code: 'custom',
      message: '--image accepts at most two paths (first-frame, last-frame).',
      path: ['imagePaths'],
    });
  }
});

export type RawVideoRunInput = {
  provider?: string;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  promptFilePath?: string;
  inlinePrompt?: string;
  promptFileContent?: string;
  stdinContent?: string;
  aspect?: string;
  resolution?: string;
  duration?: string | number;
  fps?: string | number;
  audio?: boolean;
  imagePaths?: string[];
  n?: string | number;
  seed?: string | number;
  binary?: boolean;
  b64?: boolean;
  json?: boolean;
  quiet?: boolean;
  retries?: string | number;
  timeoutSeconds?: string | number;
};

export type ResolvedVideoRunInput = {
  provider: ProviderSlug;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  promptFilePath?: string;
  prompt: string;
  aspect?: string;
  resolution?: string;
  duration?: number;
  fps?: number;
  audio?: boolean;
  imagePaths: string[];
  n: number;
  seed?: number;
  binary: boolean;
  b64: boolean;
  json: boolean;
  quiet: boolean;
  retries: number;
  timeoutMs: number;
};

function mergePromptSources(...sources: Array<string | undefined>): string {
  return sources
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n');
}

export function resolveVideoRunInput(rawInput: RawVideoRunInput): ResolvedVideoRunInput {
  const parsed = videoRunInputSchema.safeParse(rawInput);

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
    throw new AICliError('validation', 'The resolved video prompt is empty.');
  }

  return {
    provider: parsed.data.provider,
    model: parsed.data.model,
    apiKey: parsed.data.apiKey,
    outputPath: parsed.data.outputPath,
    promptFilePath: parsed.data.promptFilePath,
    prompt,
    aspect: parsed.data.aspect,
    resolution: parsed.data.resolution,
    duration: parsed.data.duration,
    fps: parsed.data.fps,
    audio: parsed.data.audio,
    imagePaths: parsed.data.imagePaths,
    n: parsed.data.n,
    seed: parsed.data.seed,
    binary: parsed.data.binary,
    b64: parsed.data.b64,
    json: parsed.data.json,
    quiet: parsed.data.quiet,
    retries: parsed.data.retries,
    timeoutMs: parsed.data.timeoutSeconds * 1_000,
  };
}
