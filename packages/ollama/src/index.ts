import {
  extractJsonMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai';
import { createOllama } from 'ollama-ai-provider-v2';
import { z } from 'zod';

import { getOllamaApiBaseUrl } from '@marmot-sh/core';
import { PROVIDER_DEFAULT_MODELS } from '@marmot-sh/core';
import { AICliError, readErrorBody, toAICliError } from '@marmot-sh/core';
import { buildUserMessages } from '@marmot-sh/core';
import { normalizeUsage } from '@marmot-sh/core';
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

const ollamaTagsResponseSchema = z.object({
  models: z.array(z.object({
    name: z.string(),
    model: z.string().optional(),
    modified_at: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    digest: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  })),
});

/** Ollama doesn't expose reasoning controls; reasoning is silently
 *  ignored. Sampling params and generic providerOptions passthrough
 *  (under the `ollama` key) work normally.
 *
 *  Ollama's AI SDK provider does not implement `stopSequences`. Including
 *  the key (even as undefined) trips an `AI SDK Warning (ollama.responses
 *  / ...): The feature "setting" is not supported. stopSequences` to
 *  stderr on every call. Only set the key when the user actually passes
 *  --stop. (When they do, the warning is appropriate — ollama still
 *  doesn't honor it; the warning tells them the flag won't apply.) */
function buildCommonOllamaArgs(input: ProviderGenerateInput) {
  const userOpts = input.providerOptions ?? {};
  const args: Record<string, unknown> = {
    temperature: input.temperature,
    maxOutputTokens: input.maxOutputTokens,
    topP: input.topP,
    seed: input.seed,
  };
  if (input.stopSequences && input.stopSequences.length > 0) {
    args.stopSequences = input.stopSequences;
  }
  if (Object.keys(userOpts).length > 0) {
    args.providerOptions = { ollama: userOpts } as unknown as Parameters<
      typeof generateText
    >[0]['providerOptions'];
  }
  return args;
}

export const ollamaAdapter: ProviderAdapter = {
  slug: 'ollama',
  name: 'Ollama',
  defaultModel: PROVIDER_DEFAULT_MODELS.ollama,
  requiresApiKey: false,
  capabilities: { text: true, image: false, speech: false, transcription: false },

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    const baseUrl = input.ollamaBaseUrl ?? getOllamaApiBaseUrl();

    try {
      const provider = createOllama({
        baseURL: baseUrl,
        compatibility: 'strict',
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = await generateText({
        model: provider.chat(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        ...buildCommonOllamaArgs(input),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'ollama',
        model: input.model,
        text: result.text,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Ollama generation failed for model "${input.model}".`,
      );
    }
  },

  async generateObject(
    input: ProviderObjectGenerateInput,
  ): Promise<ProviderObjectGenerateResult> {
    const baseUrl = input.ollamaBaseUrl ?? getOllamaApiBaseUrl();

    try {
      const provider = createOllama({
        baseURL: baseUrl,
        compatibility: 'strict',
        fetch: input.fetchFn,
      });
      const model = wrapLanguageModel({
        model: provider.chat(input.model),
        middleware: extractJsonMiddleware(),
      });

      const messages = buildUserMessages(input);
      const result = await generateText({
        model,
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        ...buildCommonOllamaArgs(input),
        abortSignal: input.abortSignal,
        maxRetries: 0,
        output: Output.object({
          schema: input.schema,
        }),
      });

      return {
        provider: 'ollama',
        model: input.model,
        output: result.output,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Ollama object generation failed for model "${input.model}".`,
      );
    }
  },

  async stream(input: ProviderGenerateInput): Promise<ProviderStreamResult> {
    const baseUrl = input.ollamaBaseUrl ?? getOllamaApiBaseUrl();

    try {
      const provider = createOllama({
        baseURL: baseUrl,
        compatibility: 'strict',
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = streamText({
        model: provider.chat(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        ...buildCommonOllamaArgs(input),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        textStream: result.textStream,
        complete: (async () => ({
          provider: 'ollama' as const,
          model: input.model,
          text: await result.text,
          usage: normalizeUsage(await result.usage),
          finishReason: (await result.finishReason) ?? null,
        }))(),
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Ollama streaming failed for model "${input.model}".`,
      );
    }
  },

  async refreshModels(input: RefreshModelsInput): Promise<ProviderCacheFile> {
    const fetchFn = input.fetchFn ?? fetch;
    const baseUrl = input.ollamaBaseUrl ?? getOllamaApiBaseUrl();
    const tagsUrl = `${baseUrl}/tags`;

    let response: Response;

    try {
      response = await fetchFn(tagsUrl, {
        headers: {
          accept: 'application/json',
        },
      });
    } catch (error) {
      throw new AICliError(
        'network',
        'Failed to reach the Ollama tags endpoint.',
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new AICliError(
        'provider',
        `Ollama model refresh failed with status ${response.status}.${await readErrorBody(response)}`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AICliError(
        'cache',
        'Ollama returned invalid JSON while refreshing models.',
        { cause: error },
      );
    }

    const parsed = ollamaTagsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'Ollama model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    return {
      version: 1,
      provider: 'ollama',
      defaultModel: PROVIDER_DEFAULT_MODELS.ollama,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: parsed.data.models.map((model) => ({
        id: model.model ?? model.name,
        name: model.name,
        contextLength: null,
        pricing: null,
        inputModalities: ['text'],
        outputModalities: ['text'],
        updatedAt: normalizeIsoDate(model.modified_at),
        metadata: {
          size: model.size ?? null,
          digest: model.digest ?? null,
          details: model.details ?? {},
        },
      })),
    };
  },
};

function normalizeIsoDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
}
