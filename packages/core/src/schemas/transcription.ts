import { z } from 'zod';

import { DEFAULT_TRANSCRIPTION_TIMEOUT_MS } from '../lib/retry.js';
import {
  DEFAULT_PROVIDER,
  PROVIDERS,
  type ProviderSlug,
} from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';

const TRANSCRIBE_FORMATS = [
  'json',
  'text',
  'srt',
  'vtt',
  'verbose-json',
] as const;
export type TranscribeFormat = (typeof TRANSCRIBE_FORMATS)[number];

export const transcribeProviderSlugSchema = z.enum(PROVIDERS);

const transcribeRunInputSchema = z.object({
  provider: transcribeProviderSlugSchema.default(DEFAULT_PROVIDER),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1).optional(),
  audioPath: z.string().trim().min(1).optional(),
  outputPath: z.string().trim().min(1).optional(),
  language: z.string().trim().min(2).max(10).optional(),
  prompt: z.string().optional(),
  // Default to plain text — the natural pipe-friendly representation. Use
  // --format json (or its alias --json) for the structured envelope.
  format: z.enum(TRANSCRIBE_FORMATS).default('text'),
  text: z.boolean().default(false),
  quiet: z.boolean().default(false),
  retries: z.coerce.number().int().min(0).max(10).default(0),
  timeoutSeconds: z.coerce.number().int().min(1).max(86_400).default(
    DEFAULT_TRANSCRIPTION_TIMEOUT_MS / 1_000,
  ),
}).superRefine((value, context) => {
  // Audio source (path) must be set OR stdin must have bytes — checked at command layer.
  // Schema can't see stdin so we only validate the optional fields here.
  if (value.text && value.format !== 'json' && value.format !== 'text') {
    context.addIssue({
      code: 'custom',
      message: '--text only works with --format json or text.',
      path: ['text'],
    });
  }
});

export type RawTranscribeRunInput = {
  provider?: string;
  model?: string;
  apiKey?: string;
  audioPath?: string;
  outputPath?: string;
  language?: string;
  prompt?: string;
  format?: string;
  text?: boolean;
  quiet?: boolean;
  retries?: string | number;
  timeoutSeconds?: string | number;
};

export type ResolvedTranscribeRunInput = {
  provider: ProviderSlug;
  model?: string;
  apiKey?: string;
  audioPath?: string;
  outputPath?: string;
  language?: string;
  prompt?: string;
  format: TranscribeFormat;
  text: boolean;
  quiet: boolean;
  retries: number;
  timeoutMs: number;
};

export function resolveTranscribeRunInput(
  raw: RawTranscribeRunInput,
): ResolvedTranscribeRunInput {
  const parsed = transcribeRunInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AICliError(
      'validation',
      parsed.error.issues.map((issue) => issue.message).join(' '),
      { cause: parsed.error },
    );
  }

  return {
    provider: parsed.data.provider,
    model: parsed.data.model,
    apiKey: parsed.data.apiKey,
    audioPath: parsed.data.audioPath,
    outputPath: parsed.data.outputPath,
    language: parsed.data.language,
    prompt: parsed.data.prompt,
    format: parsed.data.format,
    text: parsed.data.text,
    quiet: parsed.data.quiet,
    retries: parsed.data.retries,
    timeoutMs: parsed.data.timeoutSeconds * 1_000,
  };
}
