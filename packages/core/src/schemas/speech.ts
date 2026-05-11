import { z } from 'zod';

import { DEFAULT_SPEECH_TIMEOUT_MS } from '../lib/retry.js';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  type ProviderSlug,
} from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';

export const speechProviderSlugSchema = z.enum(PROVIDERS);

const speechRunInputSchema = z.object({
  provider: speechProviderSlugSchema.default(DEFAULT_PROVIDER),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1).optional(),
  outputPath: z.string().trim().min(1).optional(),
  promptFilePath: z.string().trim().min(1).optional(),
  inlineText: z.string().optional(),
  promptFileContent: z.string().optional(),
  stdinContent: z.string().optional(),
  voice: z.string().trim().min(1).optional(),
  format: z.string().trim().min(1).optional(),
  speed: z.coerce.number().min(0.25).max(4.0).optional(),
  instructions: z.string().optional(),
  binary: z.boolean().default(false),
  b64: z.boolean().default(false),
  json: z.boolean().default(false),
  play: z.boolean().default(false),
  wait: z.boolean().default(false),
  quiet: z.boolean().default(false),
  retries: z.coerce.number().int().min(0).max(10).default(0),
  timeoutSeconds: z.coerce.number().int().min(1).max(86_400).default(
    DEFAULT_SPEECH_TIMEOUT_MS / 1_000,
  ),
}).superRefine((value, context) => {
  const hasInline = Boolean(value.inlineText?.trim());
  const hasPromptFile = Boolean(value.promptFileContent?.trim());
  const hasStdin = Boolean(value.stdinContent?.trim());

  if (!hasInline && !hasPromptFile && !hasStdin) {
    context.addIssue({
      code: 'custom',
      message: 'Provide text via argument, --prompt-file, or piped stdin.',
      path: ['inlineText'],
    });
  }

  if (value.binary && value.b64) {
    context.addIssue({
      code: 'custom',
      message: 'Specify only one of --binary or --b64.',
      path: ['binary'],
    });
  }

  if (value.play && value.b64) {
    context.addIssue({
      code: 'custom',
      message: '--play cannot combine with --b64.',
      path: ['play'],
    });
  }

  if (value.wait && !value.play) {
    context.addIssue({
      code: 'custom',
      message: '--wait only makes sense with --play.',
      path: ['wait'],
    });
  }
});

export type RawSpeechRunInput = {
  provider?: string;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  promptFilePath?: string;
  inlineText?: string;
  promptFileContent?: string;
  stdinContent?: string;
  voice?: string;
  format?: string;
  speed?: string | number;
  instructions?: string;
  binary?: boolean;
  b64?: boolean;
  json?: boolean;
  play?: boolean;
  wait?: boolean;
  quiet?: boolean;
  retries?: string | number;
  timeoutSeconds?: string | number;
};

export type ResolvedSpeechRunInput = {
  provider: ProviderSlug;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  promptFilePath?: string;
  text: string;
  voice?: string;
  format?: string;
  speed?: number;
  instructions?: string;
  binary: boolean;
  b64: boolean;
  json: boolean;
  play: boolean;
  wait: boolean;
  quiet: boolean;
  retries: number;
  timeoutMs: number;
};

function mergeSources(...sources: Array<string | undefined>): string {
  return sources.filter((v): v is string => Boolean(v?.trim())).join('\n\n');
}

export function resolveSpeechRunInput(
  raw: RawSpeechRunInput,
): ResolvedSpeechRunInput {
  const parsed = speechRunInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AICliError(
      'validation',
      parsed.error.issues.map((issue) => issue.message).join(' '),
      { cause: parsed.error },
    );
  }

  const text = mergeSources(
    parsed.data.inlineText,
    parsed.data.promptFileContent,
    parsed.data.stdinContent,
  );

  if (!text.trim()) {
    throw new AICliError('validation', 'The resolved speech text is empty.');
  }

  return {
    provider: parsed.data.provider,
    model: parsed.data.model,
    apiKey: parsed.data.apiKey,
    outputPath: parsed.data.outputPath,
    promptFilePath: parsed.data.promptFilePath,
    text,
    voice: parsed.data.voice,
    format: parsed.data.format,
    speed: parsed.data.speed,
    instructions: parsed.data.instructions,
    binary: parsed.data.binary,
    b64: parsed.data.b64,
    json: parsed.data.json,
    play: parsed.data.play,
    wait: parsed.data.wait,
    quiet: parsed.data.quiet,
    retries: parsed.data.retries,
    timeoutMs: parsed.data.timeoutSeconds * 1_000,
  };
}
