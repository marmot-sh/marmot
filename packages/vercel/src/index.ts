import {
  createGateway,
  experimental_generateImage as generateImage,
  experimental_generateSpeech as generateSpeech,
  experimental_transcribe as transcribe,
  generateText,
  Output,
  streamText,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
  PROVIDER_SPEECH_DEFAULT_MODELS,
  PROVIDER_TRANSCRIPTION_DEFAULT_MODELS,
} from '@marmot-sh/core';
import { AICliError, toAICliError } from '@marmot-sh/core';
import { buildUserMessages } from '@marmot-sh/core';
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

const VERCEL_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

const VERCEL_SPEECH_MODELS = [
  {
    id: 'openai/tts-1',
    name: 'OpenAI TTS-1 (via Vercel)',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },
  {
    id: 'openai/tts-1-hd',
    name: 'OpenAI TTS-1 HD (via Vercel)',
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  },
  {
    id: 'openai/gpt-4o-mini-tts',
    name: 'OpenAI GPT-4o mini TTS (via Vercel)',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'],
  },
] as const;

const VERCEL_TRANSCRIPTION_MODELS = [
  { id: 'openai/whisper-1', name: 'OpenAI Whisper v1 (via Vercel)' },
  { id: 'openai/gpt-4o-transcribe', name: 'OpenAI GPT-4o Transcribe (via Vercel)' },
  { id: 'openai/gpt-4o-mini-transcribe', name: 'OpenAI GPT-4o mini Transcribe (via Vercel)' },
] as const;

function stripProviderPrefix(model: string): string {
  // Vercel routes audio through OpenAI's `/audio/*` endpoints, which expect
  // the bare model id ("whisper-1") not the provider-prefixed slug
  // ("openai/whisper-1"). Strip the prefix when present.
  const slash = model.indexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
}

function buildGateway(input: { apiKey: string; fetchFn?: typeof fetch }) {
  return createGateway({
    apiKey: input.apiKey,
    fetch: input.fetchFn,
  });
}

function requireApiKey(apiKey?: string): asserts apiKey is string {
  if (!apiKey) {
    throw new AICliError(
      'auth',
      'Vercel AI Gateway requires --api-key or AI_GATEWAY_API_KEY.',
    );
  }
}

function normalizeUsage(
  usage: Awaited<ReturnType<typeof generateText>>['usage'],
) {
  return {
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
  };
}

// Audio note: Vercel AI Gateway doesn't expose `speechModel()` /
// `transcriptionModel()` in the AI SDK gateway shape, but it DOES proxy
// OpenAI's `/v1/audio/*` endpoints under `https://ai-gateway.vercel.sh/v1/`.
// We route through `createOpenAI({ baseURL })` with the gateway URL +
// AI_GATEWAY_API_KEY for speech and transcription.
export const vercelAdapter: ProviderAdapter = {
  slug: 'vercel',
  name: 'Vercel AI Gateway',
  defaultModel: PROVIDER_DEFAULT_MODELS.vercel,
  defaultImageModel: 'openai/dall-e-3',
  defaultSpeechModel: 'openai/tts-1',
  defaultTranscriptionModel: 'openai/whisper-1',
  requiresApiKey: true,
  capabilities: { text: true, image: true, speech: true, transcription: true },

  async generate(
    input: ProviderGenerateInput,
  ): Promise<ProviderGenerateResult> {
    requireApiKey(input.apiKey);

    try {
      const provider = buildGateway({
        apiKey: input.apiKey,
        fetchFn: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = await generateText({
        model: provider(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'vercel',
        model: input.model,
        text: result.text,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Vercel AI Gateway generation failed for model "${input.model}".`,
      );
    }
  },

  async generateObject(
    input: ProviderObjectGenerateInput,
  ): Promise<ProviderObjectGenerateResult> {
    requireApiKey(input.apiKey);

    try {
      const provider = buildGateway({
        apiKey: input.apiKey,
        fetchFn: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = await generateText({
        model: provider(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
        output: Output.object({
          schema: input.schema,
        }),
      });

      return {
        provider: 'vercel',
        model: input.model,
        output: result.output,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Vercel AI Gateway object generation failed for model "${input.model}".`,
      );
    }
  },

  async stream(input: ProviderGenerateInput): Promise<ProviderStreamResult> {
    requireApiKey(input.apiKey);

    try {
      const provider = buildGateway({
        apiKey: input.apiKey,
        fetchFn: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = streamText({
        model: provider(input.model),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        textStream: result.textStream,
        complete: (async () => {
          const [text, usage, finishReason] = await Promise.all([
            result.text,
            result.usage,
            result.finishReason,
          ]);

          return {
            provider: 'vercel' as const,
            model: input.model,
            text,
            usage: normalizeUsage(usage),
            finishReason: finishReason ?? null,
          };
        })(),
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Vercel AI Gateway streaming failed for model "${input.model}".`,
      );
    }
  },

  async refreshModels(
    input: RefreshModelsInput,
  ): Promise<ProviderCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Vercel AI Gateway requires --api-key or AI_GATEWAY_API_KEY.',
      );
    }

    try {
      const provider = buildGateway({
        apiKey: input.apiKey,
        fetchFn: input.fetchFn,
      });

      const response = await provider.getAvailableModels();
      const languageModels = response.models.filter(isLanguageModel);

      return {
        version: 1,
        provider: 'vercel',
        defaultModel: PROVIDER_DEFAULT_MODELS.vercel,
        fetchedAt: (input.now?.() ?? new Date()).toISOString(),
        models: languageModels.map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          contextLength: null,
          pricing: null,
          inputModalities: ['text'],
          outputModalities: ['text'],
          updatedAt: null,
          metadata: {
            description: model.description ?? null,
            pricing: model.pricing ?? null,
          },
        })),
      };
    } catch (error) {
      throw toAICliError(
        error,
        'cache',
        'Failed to refresh the Vercel AI Gateway model list.',
      );
    }
  },

  async generateImage(
    input: ProviderImageGenerateInput,
  ): Promise<ProviderImageGenerateResult> {
    requireApiKey(input.apiKey);

    try {
      const provider = buildGateway({
        apiKey: input.apiKey,
        fetchFn: input.fetchFn,
      });

      const result = await generateImage({
        model: provider.imageModel(input.model),
        prompt: input.prompt,
        n: input.n,
        size: input.size as `${number}x${number}` | undefined,
        seed: input.seed,
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'vercel',
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
        `Vercel AI Gateway image generation failed for model "${input.model}".`,
      );
    }
  },

  async refreshImageModels(
    input: RefreshModelsInput,
  ): Promise<ProviderImageCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Vercel AI Gateway requires --api-key or AI_GATEWAY_API_KEY.',
      );
    }

    try {
      const provider = buildGateway({
        apiKey: input.apiKey,
        fetchFn: input.fetchFn,
      });

      const response = await provider.getAvailableModels();
      const imageModels = response.models.filter(isImageModel);

      return {
        version: 1,
        provider: 'vercel',
        defaultModel: PROVIDER_IMAGE_DEFAULT_MODELS.vercel!,
        fetchedAt: (input.now?.() ?? new Date()).toISOString(),
        models: imageModels.map((model) => ({
          id: model.id,
          name: model.name ?? model.id,
          metadata: {
            description: model.description ?? null,
            pricing: model.pricing ?? null,
          },
        })),
      };
    } catch (error) {
      throw toAICliError(
        error,
        'cache',
        'Failed to refresh the Vercel AI Gateway image model list.',
      );
    }
  },

  async generateSpeech(input: ProviderSpeechInput): Promise<ProviderSpeechResult> {
    requireApiKey(input.apiKey);

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: VERCEL_GATEWAY_BASE_URL,
        fetch: input.fetchFn,
      });

      const providerOptions: Record<string, string | number> = {};
      if (input.format) providerOptions.response_format = input.format;
      if (typeof input.speed === 'number') providerOptions.speed = input.speed;
      if (input.instructions) providerOptions.instructions = input.instructions;

      const result = await generateSpeech({
        model: provider.speech(stripProviderPrefix(input.model)),
        text: input.text,
        voice: input.voice,
        providerOptions: { openai: providerOptions },
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'vercel',
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
        `Vercel AI Gateway speech generation failed for model "${input.model}".`,
      );
    }
  },

  async refreshSpeechModels(
    input: RefreshModelsInput,
  ): Promise<ProviderSpeechCacheFile> {
    requireApiKey(input.apiKey);

    // Vercel's `getAvailableModels()` schema doesn't include audio models yet.
    // We expose the OpenAI-routed audio models that work via the gateway's
    // OpenAI-compat proxy. Update when Vercel adds first-class audio listing.
    return {
      version: 1,
      provider: 'vercel',
      defaultModel: PROVIDER_SPEECH_DEFAULT_MODELS.vercel!,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: VERCEL_SPEECH_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        voices: [...m.voices],
        metadata: {},
      })),
    };
  },

  async transcribe(input: ProviderTranscribeInput): Promise<ProviderTranscribeResult> {
    requireApiKey(input.apiKey);

    try {
      const provider = createOpenAI({
        apiKey: input.apiKey,
        baseURL: VERCEL_GATEWAY_BASE_URL,
        fetch: input.fetchFn,
      });

      const providerOptions: Record<string, string> = {};
      if (input.language) providerOptions.language = input.language;
      if (input.prompt) providerOptions.prompt = input.prompt;
      if (input.format) providerOptions.response_format = input.format;

      const result = await transcribe({
        model: provider.transcription(stripProviderPrefix(input.model)),
        audio: input.audio,
        providerOptions: { openai: providerOptions },
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'vercel',
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
        `Vercel AI Gateway transcription failed for model "${input.model}".`,
      );
    }
  },

  async refreshTranscriptionModels(
    input: RefreshModelsInput,
  ): Promise<ProviderTranscriptionCacheFile> {
    requireApiKey(input.apiKey);

    return {
      version: 1,
      provider: 'vercel',
      defaultModel: PROVIDER_TRANSCRIPTION_DEFAULT_MODELS.vercel!,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: VERCEL_TRANSCRIPTION_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        metadata: {},
      })),
    };
  },
};

type GatewayModelLike = {
  modelType?: string | null;
};

function isLanguageModel(model: GatewayModelLike): boolean {
  // Treat unknown modelType as language for backwards compat.
  return !model.modelType || model.modelType === 'language';
}

function isImageModel(model: GatewayModelLike): boolean {
  return model.modelType === 'image';
}
