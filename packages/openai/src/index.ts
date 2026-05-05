import {
  experimental_generateImage as generateImage,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  extractJsonMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

import {
  OPENAI_BASE_URL,
  OPENAI_MODELS_URL,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
} from '@marmot-sh/core';
import { AICliError, readErrorBody, toAICliError } from '@marmot-sh/core';
import { buildUserMessages } from '@marmot-sh/core';
import { normalizeUsage } from '@marmot-sh/core';
import type {
  ProviderCacheFile,
  ProviderGenerateInput,
  ProviderGenerateResult,
  ProviderImageCacheFile,
  ProviderImageGenerateInput,
  ProviderImageGenerateResult,
  ProviderObjectGenerateInput,
  ProviderObjectGenerateResult,
  ProviderSpeechCacheFile,
  ProviderSpeechInput,
  ProviderSpeechResult,
  ProviderStreamResult,
  ProviderTranscribeInput,
  ProviderTranscribeResult,
  ProviderTranscriptionCacheFile,
  RefreshModelsInput,
} from '@marmot-sh/core';
import type { ProviderAdapter } from '@marmot-sh/core';

const OPENAI_IMAGE_MODELS = [
  { id: 'gpt-image-1', name: 'GPT Image 1' },
  { id: 'dall-e-3', name: 'DALL·E 3' },
  { id: 'dall-e-2', name: 'DALL·E 2' },
] as const;

const OPENAI_SPEECH_MODELS = [
  {
    id: 'tts-1',
    name: 'TTS 1',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },
  {
    id: 'tts-1-hd',
    name: 'TTS 1 HD',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },
  {
    id: 'gpt-4o-mini-tts',
    name: 'GPT-4o mini TTS (steerable)',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'],
  },
] as const;

const OPENAI_TRANSCRIPTION_MODELS = [
  { id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe' },
  { id: 'gpt-4o-mini-transcribe', name: 'GPT-4o mini Transcribe' },
  { id: 'whisper-1', name: 'Whisper v1' },
] as const;

const openAIModelSchema = z.object({
  id: z.string(),
  object: z.string().optional(),
  created: z.number().int().optional(),
  owned_by: z.string().optional(),
});

const openAIModelsResponseSchema = z.object({
  object: z.string().optional(),
  data: z.array(openAIModelSchema),
});

export const openAIAdapter: ProviderAdapter = {
  slug: 'openai',
  name: 'OpenAI',
  defaultModel: PROVIDER_DEFAULT_MODELS.openai,
  defaultImageModel: 'gpt-image-1',
  defaultSpeechModel: 'tts-1',
  defaultTranscriptionModel: 'whisper-1',
  requiresApiKey: true,
  capabilities: { text: true, image: true, speech: true, transcription: true },

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI requires --api-key or OPENAI_API_KEY.',
      );
    }

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = await generateText({
        model: provider.chat(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'openai',
        model: input.model,
        text: result.text,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenAI generation failed for model "${input.model}".`,
      );
    }
  },

  async generateObject(
    input: ProviderObjectGenerateInput,
  ): Promise<ProviderObjectGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI requires --api-key or OPENAI_API_KEY.',
      );
    }

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
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
        abortSignal: input.abortSignal,
        maxRetries: 0,
        output: Output.object({
          schema: input.schema,
        }),
      });

      return {
        provider: 'openai',
        model: input.model,
        output: result.output,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenAI object generation failed for model "${input.model}".`,
      );
    }
  },

  async stream(input: ProviderGenerateInput): Promise<ProviderStreamResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI requires --api-key or OPENAI_API_KEY.',
      );
    }

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = streamText({
        model: provider.chat(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        textStream: result.textStream,
        complete: (async () => ({
          provider: 'openai' as const,
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
        `OpenAI streaming failed for model "${input.model}".`,
      );
    }
  },

  async refreshModels(input: RefreshModelsInput): Promise<ProviderCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI model refresh requires OPENAI_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const headers: HeadersInit = {
      accept: 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    };

    let response: Response;

    try {
      response = await fetchFn(OPENAI_MODELS_URL, { headers });
    } catch (error) {
      throw new AICliError(
        'network',
        'Failed to reach the OpenAI models endpoint.',
        { cause: error },
      );
    }

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `OpenAI model refresh failed with status ${response.status}.${await readErrorBody(response)}`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AICliError(
        'cache',
        'OpenAI returned invalid JSON while refreshing models.',
        { cause: error },
      );
    }

    const parsed = openAIModelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'OpenAI model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    return {
      version: 1,
      provider: 'openai',
      defaultModel: PROVIDER_DEFAULT_MODELS.openai,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: parsed.data.data.map((model) => ({
        id: model.id,
        name: model.id,
        contextLength: null,
        pricing: null,
        inputModalities: ['text'],
        outputModalities: ['text'],
        updatedAt: model.created
          ? new Date(model.created * 1000).toISOString()
          : null,
        metadata: {
          ownedBy: model.owned_by ?? null,
          object: model.object ?? null,
        },
      })),
    };
  },

  async generateImage(
    input: ProviderImageGenerateInput,
  ): Promise<ProviderImageGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI requires --api-key or OPENAI_API_KEY.',
      );
    }

    if (input.model === 'dall-e-3' && input.n > 1) {
      throw new AICliError(
        'validation',
        'DALL·E 3 only supports --n 1. Use gpt-image-1 or dall-e-2 for batches.',
      );
    }

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: input.fetchFn,
      });

      const openaiOptions: Record<string, string> = {};
      if (input.quality) openaiOptions.quality = input.quality;
      if (input.style) openaiOptions.style = input.style;

      const result = await generateImage({
        model: provider.image(input.model),
        prompt: input.prompt,
        n: input.n,
        size: input.size as `${number}x${number}` | undefined,
        seed: input.seed,
        providerOptions: { openai: openaiOptions },
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'openai',
        model: input.model,
        images: result.images.map((image) => ({
          data: image.uint8Array,
          mimeType: image.mediaType ?? 'image/png',
        })),
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
        finishReason: 'stop',
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenAI image generation failed for model "${input.model}".`,
      );
    }
  },

  async refreshImageModels(
    input: RefreshModelsInput,
  ): Promise<ProviderImageCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI image-model refresh requires OPENAI_API_KEY.',
      );
    }

    return {
      version: 1,
      provider: 'openai',
      defaultModel: PROVIDER_IMAGE_DEFAULT_MODELS.openai!,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: OPENAI_IMAGE_MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        metadata: {},
      })),
    };
  },

  async generateSpeech(input: ProviderSpeechInput): Promise<ProviderSpeechResult> {
    if (!input.apiKey) {
      throw new AICliError('auth', 'OpenAI requires --api-key or OPENAI_API_KEY.');
    }

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: input.fetchFn,
      });

      const providerOptions: Record<string, string | number> = {};
      if (input.format) providerOptions.response_format = input.format;
      if (typeof input.speed === 'number') providerOptions.speed = input.speed;
      if (input.instructions) providerOptions.instructions = input.instructions;

      const result = await generateSpeech({
        model: provider.speech(input.model),
        text: input.text,
        voice: input.voice,
        providerOptions: { openai: providerOptions },
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'openai',
        model: input.model,
        voice: input.voice,
        audio: {
          data: result.audio.uint8Array,
          mimeType: result.audio.mediaType ?? 'audio/mpeg',
        },
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenAI speech generation failed for model "${input.model}".`,
      );
    }
  },

  async refreshSpeechModels(input: RefreshModelsInput): Promise<ProviderSpeechCacheFile> {
    if (!input.apiKey) {
      throw new AICliError('auth', 'OpenAI speech-model refresh requires OPENAI_API_KEY.');
    }
    return {
      version: 1,
      provider: 'openai',
      defaultModel: 'tts-1',
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: OPENAI_SPEECH_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        voices: [...m.voices],
        metadata: {},
      })),
    };
  },

  async transcribe(input: ProviderTranscribeInput): Promise<ProviderTranscribeResult> {
    if (!input.apiKey) {
      throw new AICliError('auth', 'OpenAI requires --api-key or OPENAI_API_KEY.');
    }

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: input.fetchFn,
      });

      const providerOptions: Record<string, string> = {};
      if (input.language) providerOptions.language = input.language;
      if (input.prompt) providerOptions.prompt = input.prompt;
      if (input.format) providerOptions.response_format = input.format;

      const result = await transcribe({
        model: provider.transcription(input.model),
        audio: input.audio,
        providerOptions: { openai: providerOptions },
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'openai',
        model: input.model,
        text: result.text,
        language: result.language ?? input.language,
        duration: result.durationInSeconds,
        segments: result.segments?.map((s) => ({
          start: s.startSecond,
          end: s.endSecond,
          text: s.text,
        })),
        raw: undefined,
        usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenAI transcription failed for model "${input.model}".`,
      );
    }
  },

  async refreshTranscriptionModels(
    input: RefreshModelsInput,
  ): Promise<ProviderTranscriptionCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenAI transcription-model refresh requires OPENAI_API_KEY.',
      );
    }
    return {
      version: 1,
      provider: 'openai',
      defaultModel: 'whisper-1',
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: OPENAI_TRANSCRIPTION_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        metadata: {},
      })),
    };
  },
};
