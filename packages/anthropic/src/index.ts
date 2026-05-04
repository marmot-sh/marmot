import {
  extractJsonMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_BASE_URL,
  ANTHROPIC_MODELS_URL,
  PROVIDER_DEFAULT_MODELS,
} from '@marmot-sh/core';
import { AICliError, toAICliError } from '@marmot-sh/core';
import { buildUserMessages } from '@marmot-sh/core';
import { normalizeAnthropicUsage } from '@marmot-sh/core';

const EPHEMERAL = { type: 'ephemeral' as const };

/**
 * When cache breakpoints are set, attach Anthropic's cacheControl marker to
 * the right places so the next call's prefix can be served from cache.
 *
 * For chat-mode sessions Marmot sets both:
 *   - system: marks the system prompt (cached across all turns)
 *   - lastUserMessage: marks the most recent user content part
 *
 * Returns either:
 *   - { system, messages } when messages exist (history or attachments)
 *   - { system, prompt } otherwise (no caching applies — can't mark a bare
 *     string prompt without converting it to messages, and a single-shot call
 *     with no history isn't worth caching)
 */
function applyAnthropicCacheBreakpoints(
  input: ProviderGenerateInput,
  messages: ReturnType<typeof buildUserMessages>,
): { system: unknown; messages: unknown | null } {
  const breakpoints = input.cacheBreakpoints ?? {};

  // System prompt with optional cache_control. Anthropic accepts an array of
  // text parts, where each part can carry providerOptions.
  let system: unknown = input.system;
  if (input.system && breakpoints.system) {
    system = [
      {
        type: 'text',
        text: input.system,
        providerOptions: { anthropic: { cacheControl: EPHEMERAL } },
      },
    ];
  }

  if (!messages || messages.length === 0) {
    return { system, messages: null };
  }

  if (!breakpoints.lastUserMessage) {
    return { system, messages };
  }

  // Mark the last text part of the last (user) message. We only attach the
  // marker to text parts — image/file parts can carry it too but Marmot keeps
  // history text-only for v1 so this is sufficient.
  const last = messages[messages.length - 1]!;
  let lastTextIndex = -1;
  for (let i = last.content.length - 1; i >= 0; i--) {
    if (last.content[i]!.type === 'text') {
      lastTextIndex = i;
      break;
    }
  }
  const newContent = last.content.map((part, i) =>
    i === lastTextIndex
      ? { ...part, providerOptions: { anthropic: { cacheControl: EPHEMERAL } } }
      : part,
  );
  const augmented = [...messages.slice(0, -1), { ...last, content: newContent }];
  return { system, messages: augmented };
}
import type {
  ProviderCacheFile,
  ProviderGenerateInput,
  ProviderGenerateResult,
  ProviderObjectGenerateInput,
  ProviderObjectGenerateResult,
  ProviderStreamResult,
  RefreshModelsInput,
} from '@marmot-sh/core';
import type { ProviderAdapter } from '@marmot-sh/core';

const anthropicModelSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const anthropicModelsResponseSchema = z.object({
  data: z.array(anthropicModelSchema),
  has_more: z.boolean().optional(),
  first_id: z.string().nullable().optional(),
  last_id: z.string().nullable().optional(),
});

export const anthropicAdapter: ProviderAdapter = {
  slug: 'anthropic',
  name: 'Anthropic',
  defaultModel: PROVIDER_DEFAULT_MODELS.anthropic,
  requiresApiKey: true,
  capabilities: { text: true, image: false, speech: false, transcription: false },

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Anthropic requires --api-key or ANTHROPIC_API_KEY.',
      );
    }

    try {
      const provider = createAnthropic({
        apiKey: input.apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const cached = applyAnthropicCacheBreakpoints(input, messages);
      const result = await generateText({
        model: provider.languageModel(input.model),
        system: cached.system as Parameters<typeof generateText>[0]['system'],
        ...(cached.messages
          ? { messages: cached.messages as NonNullable<Parameters<typeof generateText>[0]['messages']> }
          : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'anthropic',
        model: input.model,
        text: result.text,
        usage: normalizeAnthropicUsage(result.usage, result.providerMetadata),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Anthropic generation failed for model "${input.model}".`,
      );
    }
  },

  async generateObject(
    input: ProviderObjectGenerateInput,
  ): Promise<ProviderObjectGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Anthropic requires --api-key or ANTHROPIC_API_KEY.',
      );
    }

    try {
      const provider = createAnthropic({
        apiKey: input.apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        fetch: input.fetchFn,
      });
      const model = wrapLanguageModel({
        model: provider.languageModel(input.model),
        middleware: extractJsonMiddleware(),
      });

      const messages = buildUserMessages(input);
      const cached = applyAnthropicCacheBreakpoints(input, messages);
      const result = await generateText({
        model,
        system: cached.system as Parameters<typeof generateText>[0]['system'],
        ...(cached.messages
          ? { messages: cached.messages as NonNullable<Parameters<typeof generateText>[0]['messages']> }
          : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
        output: Output.object({
          schema: input.schema,
        }),
      });

      return {
        provider: 'anthropic',
        model: input.model,
        output: result.output,
        usage: normalizeAnthropicUsage(result.usage, result.providerMetadata),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Anthropic object generation failed for model "${input.model}".`,
      );
    }
  },

  async stream(input: ProviderGenerateInput): Promise<ProviderStreamResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Anthropic requires --api-key or ANTHROPIC_API_KEY.',
      );
    }

    try {
      const provider = createAnthropic({
        apiKey: input.apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const cached = applyAnthropicCacheBreakpoints(input, messages);
      const result = streamText({
        model: provider.languageModel(input.model),
        system: cached.system as Parameters<typeof streamText>[0]['system'],
        ...(cached.messages
          ? { messages: cached.messages as NonNullable<Parameters<typeof streamText>[0]['messages']> }
          : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        textStream: result.textStream,
        complete: (async () => ({
          provider: 'anthropic' as const,
          model: input.model,
          text: await result.text,
          usage: normalizeAnthropicUsage(await result.usage, await result.providerMetadata),
          finishReason: (await result.finishReason) ?? null,
        }))(),
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Anthropic streaming failed for model "${input.model}".`,
      );
    }
  },

  async refreshModels(input: RefreshModelsInput): Promise<ProviderCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Anthropic model refresh requires ANTHROPIC_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const headers: HeadersInit = {
      accept: 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    };

    let response: Response;

    try {
      response = await fetchFn(ANTHROPIC_MODELS_URL, { headers });
    } catch (error) {
      throw new AICliError(
        'network',
        'Failed to reach the Anthropic models endpoint.',
        { cause: error },
      );
    }

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `Anthropic model refresh failed with status ${response.status}.`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AICliError(
        'cache',
        'Anthropic returned invalid JSON while refreshing models.',
        { cause: error },
      );
    }

    const parsed = anthropicModelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'Anthropic model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    return {
      version: 1,
      provider: 'anthropic',
      defaultModel: PROVIDER_DEFAULT_MODELS.anthropic,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: parsed.data.data.map((model) => ({
        id: model.id,
        name: model.display_name ?? model.id,
        contextLength: null,
        pricing: null,
        inputModalities: ['text', 'image'],
        outputModalities: ['text'],
        updatedAt: normalizeIsoDate(model.created_at),
        metadata: {
          type: model.type ?? null,
        },
      })),
    };
  },
};

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
}
