import { z } from 'zod';

import { DEFAULT_TEXT_TIMEOUT_MS } from '../lib/retry.js';
import {
  DEFAULT_PROVIDER,
  PROVIDER_DEFAULT_MODELS,
  PROVIDERS,
  type ProviderSlug,
} from '../lib/constants.js';
import { AICliError } from '../lib/errors.js';
import type { SchemaSource } from '../types.js';

export const providerSlugSchema = z.enum(PROVIDERS);

const runInputSchema = z.object({
  provider: providerSlugSchema.default(DEFAULT_PROVIDER),
  model: z.string().trim().min(1).optional(),
  apiKey: z.string().trim().min(1).optional(),
  outputPath: z.string().trim().min(1).optional(),
  schema: z.string().trim().min(1).optional(),
  schemaFilePath: z.string().trim().min(1).optional(),
  schemaModulePath: z.string().trim().min(1).optional(),
  system: z.string().optional(),
  systemFilePath: z.string().trim().min(1).optional(),
  systemFileContent: z.string().optional(),
  promptFilePath: z.string().trim().min(1).optional(),
  inlinePrompt: z.string().optional(),
  promptFileContent: z.string().optional(),
  stdinContent: z.string().optional(),
  imagePaths: z.array(z.string().trim().min(1)).default([]),
  imageStdin: z.boolean().default(false),
  imageMimeOverride: z.string().trim().min(1).optional(),
  filePaths: z.array(z.string().trim().min(1)).default([]),
  fileStdin: z.boolean().default(false),
  fileMimeOverride: z.string().trim().min(1).optional(),
  temperature: z.coerce.number().min(0).max(2).optional(),
  maxOutputTokens: z.coerce.number().int().min(1).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  seed: z.coerce.number().int().optional(),
  stopSequences: z.array(z.string().min(1)).optional(),
  reasoning: z.enum(['low', 'medium', 'high']).optional(),
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  text: z.boolean().default(false),
  json: z.boolean().default(false),
  stream: z.boolean().default(false),
  retries: z.coerce.number().int().min(0).max(10).default(0),
  timeoutSeconds: z.coerce.number().int().min(1).max(86_400).default(
    DEFAULT_TEXT_TIMEOUT_MS / 1_000,
  ),
}).superRefine((value, context) => {
  const hasInlinePrompt = Boolean(value.inlinePrompt?.trim());
  const hasPromptFile = Boolean(value.promptFileContent?.trim());
  const hasStdin = Boolean(value.stdinContent?.trim());
  // A system prompt (via --system or --system-file) is sufficient on its
  // own: presets like `pdf-to-md` carry the full instruction in `system`
  // and the user just supplies an attachment. Attachments alone do NOT
  // satisfy the requirement — there must be at least one prompt for the
  // model to act on.
  const hasSystem = Boolean(value.system?.trim() || value.systemFileContent?.trim());
  const schemaSources = [
    value.schema,
    value.schemaFilePath,
    value.schemaModulePath,
  ].filter(Boolean);

  // Stdin can be only one of: text prompt, binary image, binary file.
  const stdinSources = [
    hasStdin,
    value.imageStdin,
    value.fileStdin,
  ].filter(Boolean).length;
  if (stdinSources > 1) {
    context.addIssue({
      code: 'custom',
      message: 'Only one of text prompt, --image -, or --file - may be piped through stdin. Use --prompt-file or pass the prompt as an argument when reading binary input from stdin.',
      path: ['fileStdin'],
    });
  }

  if (!hasInlinePrompt && !hasPromptFile && !hasStdin && !hasSystem) {
    context.addIssue({
      code: 'custom',
      message: 'Provide a prompt (positional arg, --prompt-file, or piped stdin) or a system prompt (--system / --system-file / preset).',
      path: ['inlinePrompt'],
    });
  }

  if (schemaSources.length > 1) {
    context.addIssue({
      code: 'custom',
      message: 'Specify only one of --schema, --schema-file, or --schema-module.',
      path: ['schema'],
    });
  }

  if (schemaSources.length === 1 && value.stream) {
    context.addIssue({
      code: 'custom',
      message: 'Object mode does not support --stream.',
      path: ['stream'],
    });
  }

  if (schemaSources.length === 1 && value.text) {
    context.addIssue({
      code: 'custom',
      message: 'Object mode does not support --text.',
      path: ['text'],
    });
  }

  if (value.json && value.text) {
    context.addIssue({
      code: 'custom',
      message: 'Specify only one of --json or --text.',
      path: ['json'],
    });
  }

  if (value.json && value.stream) {
    context.addIssue({
      code: 'custom',
      message: '--json cannot be combined with --stream.',
      path: ['json'],
    });
  }
});

const cacheRefreshTargetSchema = z.union([
  providerSlugSchema,
  z.literal('all'),
]);

export type RawRunInput = {
  provider?: string;
  model?: string;
  apiKey?: string;
  outputPath?: string;
  schema?: string;
  schemaFilePath?: string;
  schemaModulePath?: string;
  system?: string;
  systemFilePath?: string;
  systemFileContent?: string;
  promptFilePath?: string;
  inlinePrompt?: string;
  promptFileContent?: string;
  stdinContent?: string;
  imagePaths?: string[];
  imageStdin?: boolean;
  imageMimeOverride?: string;
  filePaths?: string[];
  fileStdin?: boolean;
  fileMimeOverride?: string;
  temperature?: string | number;
  maxOutputTokens?: string | number;
  topP?: string | number;
  seed?: string | number;
  stopSequences?: string[];
  reasoning?: 'low' | 'medium' | 'high';
  providerOptions?: Record<string, unknown>;
  text?: boolean;
  json?: boolean;
  stream?: boolean;
  retries?: string | number;
  timeoutSeconds?: string | number;
};

export type ResolvedRunInput = {
  provider: ProviderSlug;
  model: string;
  apiKey?: string;
  outputPath?: string;
  schemaSource?: SchemaSource;
  system?: string;
  systemFilePath?: string;
  promptFilePath?: string;
  prompt: string;
  imagePaths: string[];
  imageStdin: boolean;
  imageMimeOverride?: string;
  filePaths: string[];
  fileStdin: boolean;
  fileMimeOverride?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  seed?: number;
  stopSequences?: string[];
  reasoning?: 'low' | 'medium' | 'high';
  providerOptions?: Record<string, unknown>;
  text: boolean;
  json: boolean;
  stream: boolean;
  retries: number;
  timeoutMs: number;
};

export function mergePromptSources(
  ...sources: Array<string | undefined>
): string {
  return sources
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n\n');
}

export function resolveRunInput(rawInput: RawRunInput): ResolvedRunInput {
  const parsed = runInputSchema.safeParse(rawInput);

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
  const system = mergePromptSources(
    parsed.data.system,
    parsed.data.systemFileContent,
  );

  // System prompt alone is sufficient. If the user provided neither a
  // user prompt nor a system prompt, the superRefine above already
  // surfaced the message — we won't reach this branch.
  if (!prompt.trim() && !system.trim()) {
    throw new AICliError('validation', 'The resolved prompt is empty.');
  }

  const schemaSource = parsed.data.schema
    ? { kind: 'inline' as const, value: parsed.data.schema }
    : parsed.data.schemaFilePath
      ? { kind: 'file' as const, path: parsed.data.schemaFilePath }
      : parsed.data.schemaModulePath
        ? { kind: 'module' as const, path: parsed.data.schemaModulePath }
        : undefined;

  return {
    provider: parsed.data.provider,
    model: parsed.data.model ?? PROVIDER_DEFAULT_MODELS[parsed.data.provider],
    apiKey: parsed.data.apiKey,
    outputPath: parsed.data.outputPath,
    schemaSource,
    system: system.trim() ? system : undefined,
    systemFilePath: parsed.data.systemFilePath,
    promptFilePath: parsed.data.promptFilePath,
    prompt,
    imagePaths: parsed.data.imagePaths,
    imageStdin: parsed.data.imageStdin,
    imageMimeOverride: parsed.data.imageMimeOverride,
    filePaths: parsed.data.filePaths,
    fileStdin: parsed.data.fileStdin,
    fileMimeOverride: parsed.data.fileMimeOverride,
    temperature: parsed.data.temperature,
    maxOutputTokens: parsed.data.maxOutputTokens,
    topP: parsed.data.topP,
    seed: parsed.data.seed,
    stopSequences: parsed.data.stopSequences,
    reasoning: parsed.data.reasoning,
    providerOptions: parsed.data.providerOptions,
    // Plain text is the default; --json opts into the structured envelope.
    // Streaming always forces text (envelope makes no sense for incremental output).
    // Object mode (--schema) overrides text rendering — handled at the call site.
    text: parsed.data.stream || !parsed.data.json,
    json: parsed.data.json,
    stream: parsed.data.stream,
    retries: parsed.data.retries,
    timeoutMs: parsed.data.timeoutSeconds * 1_000,
  };
}

export function resolveCacheRefreshTarget(input?: string): ProviderSlug | 'all' {
  const parsed = cacheRefreshTargetSchema.safeParse(input ?? 'all');

  if (!parsed.success) {
    throw new AICliError(
      'validation',
      `Cache refresh target must be "all" or one of: ${PROVIDERS.join(', ')}.`,
      { cause: parsed.error },
    );
  }

  return parsed.data;
}
