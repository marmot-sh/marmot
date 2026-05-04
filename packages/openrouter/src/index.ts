import {
  extractJsonMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { z } from 'zod';

import { Buffer } from 'node:buffer';

import {
  OPENROUTER_BASE_URL,
  OPENROUTER_MODELS_URL,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
  PROVIDER_SPEECH_DEFAULT_MODELS,
  PROVIDER_TRANSCRIPTION_DEFAULT_MODELS,
} from '@marmot-sh/core';
import { AICliError, toAICliError } from '@marmot-sh/core';
import { buildUserMessages } from '@marmot-sh/core';
import { normalizeOpenRouterUsage } from '@marmot-sh/core';
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

const OPENROUTER_DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image-preview';
const OPENROUTER_DEFAULT_SPEECH_MODEL = 'openai/tts-1';
const OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL = 'openai/whisper-1';
const OPENROUTER_AUDIO_SPEECH_URL = `${OPENROUTER_BASE_URL}/audio/speech`;
const OPENROUTER_AUDIO_TRANSCRIPTIONS_URL = `${OPENROUTER_BASE_URL}/audio/transcriptions`;

const AUDIO_MIME_TO_FORMAT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/aac': 'aac',
};

function inferAudioFormat(mimeType: string | undefined): string {
  if (!mimeType) return 'wav';
  const lower = mimeType.toLowerCase().split(';')[0]!.trim();
  return AUDIO_MIME_TO_FORMAT[lower] ?? 'wav';
}

const openRouterModelSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  canonical_slug: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  created: z.number().int().optional(),
  context_length: z.number().int().positive().optional(),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z.object({
    input_modalities: z.array(z.string()).nullable().optional(),
    output_modalities: z.array(z.string()).nullable().optional(),
    tokenizer: z.string().nullable().optional(),
    instruct_type: z.string().nullable().optional(),
  }).nullable().optional(),
  top_provider: z.object({
    context_length: z.number().int().positive().nullable().optional(),
    max_completion_tokens: z.number().int().positive().nullable().optional(),
    is_moderated: z.boolean().nullable().optional(),
  }).nullable().optional(),
  pricing: z.object({
    prompt: z.string().nullable().optional(),
    completion: z.string().nullable().optional(),
    request: z.string().nullable().optional(),
    image: z.string().nullable().optional(),
  }).nullable().optional(),
});

const openRouterModelsResponseSchema = z.object({
  data: z.array(openRouterModelSchema),
});

export const openRouterAdapter: ProviderAdapter = {
  slug: 'openrouter',
  name: 'OpenRouter',
  defaultModel: PROVIDER_DEFAULT_MODELS.openrouter,
  defaultImageModel: OPENROUTER_DEFAULT_IMAGE_MODEL,
  defaultSpeechModel: OPENROUTER_DEFAULT_SPEECH_MODEL,
  defaultTranscriptionModel: OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL,
  requiresApiKey: true,
  capabilities: { text: true, image: true, speech: true, transcription: true },

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter requires --api-key or OPENROUTER_API_KEY.',
      );
    }

    try {
      const provider = createOpenRouter({
        apiKey: input.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        compatibility: 'strict',
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = await generateText({
        model: provider.chat(input.model, {
          usage: {
            include: true,
          },
        }),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        provider: 'openrouter',
        model: input.model,
        text: result.text,
        usage: normalizeOpenRouterUsage(result.usage, result.providerMetadata),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenRouter generation failed for model "${input.model}".`,
      );
    }
  },

  async generateObject(
    input: ProviderObjectGenerateInput,
  ): Promise<ProviderObjectGenerateResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter requires --api-key or OPENROUTER_API_KEY.',
      );
    }

    try {
      const provider = createOpenRouter({
        apiKey: input.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        compatibility: 'strict',
        fetch: input.fetchFn,
      });
      const model = wrapLanguageModel({
        model: provider.chat(input.model, {
          usage: {
            include: true,
          },
        }),
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
        provider: 'openrouter',
        model: input.model,
        output: result.output,
        usage: normalizeOpenRouterUsage(result.usage, result.providerMetadata),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenRouter object generation failed for model "${input.model}".`,
      );
    }
  },

  async stream(input: ProviderGenerateInput): Promise<ProviderStreamResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter requires --api-key or OPENROUTER_API_KEY.',
      );
    }

    try {
      const provider = createOpenRouter({
        apiKey: input.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        compatibility: 'strict',
        fetch: input.fetchFn,
      });

      const messages = buildUserMessages(input);
      const result = streamText({
        model: provider.chat(input.model, {
          usage: {
            include: true,
          },
        }),
        system: input.system,
        ...(messages ? { messages } : { prompt: input.prompt }),
        abortSignal: input.abortSignal,
        maxRetries: 0,
      });

      return {
        textStream: result.textStream,
        complete: (async () => {
          const [
            text,
            usage,
            providerMetadata,
            finishReason,
          ] = await Promise.all([
            result.text,
            result.usage,
            result.providerMetadata,
            result.finishReason,
          ]);

          return {
            provider: 'openrouter' as const,
            model: input.model,
            text,
            usage: normalizeOpenRouterUsage(usage, providerMetadata),
            finishReason: finishReason ?? null,
          };
        })(),
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenRouter streaming failed for model "${input.model}".`,
      );
    }
  },

  async refreshModels(input: RefreshModelsInput): Promise<ProviderCacheFile> {
    const fetchFn = input.fetchFn ?? fetch;
    const headers: HeadersInit = {
      accept: 'application/json',
    };

    if (input.apiKey) {
      headers.Authorization = `Bearer ${input.apiKey}`;
    }

    let response: Response;

    try {
      response = await fetchFn(OPENROUTER_MODELS_URL, { headers });
    } catch (error) {
      throw new AICliError(
        'network',
        'Failed to reach the OpenRouter models endpoint.',
        { cause: error },
      );
    }

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `OpenRouter model refresh failed with status ${response.status}.`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AICliError(
        'cache',
        'OpenRouter returned invalid JSON while refreshing models.',
        { cause: error },
      );
    }

    const parsed = openRouterModelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'OpenRouter model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    return {
      version: 1,
      provider: 'openrouter',
      defaultModel: PROVIDER_DEFAULT_MODELS.openrouter,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: parsed.data.data.map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        contextLength: model.context_length ?? model.top_provider?.context_length ?? null,
        pricing: model.pricing
          ? {
            prompt: model.pricing.prompt ?? null,
            completion: model.pricing.completion ?? null,
            request: model.pricing.request ?? null,
            image: model.pricing.image ?? null,
          }
          : null,
        inputModalities: model.architecture?.input_modalities ?? ['text'],
        outputModalities: model.architecture?.output_modalities ?? ['text'],
        updatedAt: model.created
          ? new Date(model.created * 1000).toISOString()
          : null,
        metadata: {
          canonicalSlug: model.canonical_slug ?? model.id,
          description: model.description ?? null,
          supportedParameters: model.supported_parameters ?? [],
          topProvider: model.top_provider ?? null,
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
        'OpenRouter requires --api-key or OPENROUTER_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const url = `${OPENROUTER_BASE_URL}/chat/completions`;

    // OpenRouter expresses image generation through chat completions with the
    // `modalities` parameter. We send n requests in parallel because the
    // chat-completions endpoint returns a single response per call.
    const calls = Array.from({ length: input.n }, async () => {
      const body: Record<string, unknown> = {
        model: input.model,
        modalities: ['image', 'text'],
        messages: [{ role: 'user', content: input.prompt }],
      };

      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });

      if (!response.ok) {
        const category =
          response.status === 401 || response.status === 403
            ? 'auth'
            : 'provider';
        throw new AICliError(
          category,
          `OpenRouter image generation failed with status ${response.status}.`,
        );
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            images?: Array<{
              type?: string;
              image_url?: { url?: string };
            }>;
          };
        }>;
      };

      const images = payload.choices?.[0]?.message?.images ?? [];
      if (images.length === 0) {
        throw new AICliError(
          'provider',
          `OpenRouter response for "${input.model}" contained no image output. The model may not support image generation.`,
        );
      }

      const first = images[0]!;
      const dataUrl = first.image_url?.url ?? '';
      const decoded = decodeImageDataUrl(dataUrl);
      if (!decoded) {
        throw new AICliError(
          'provider',
          'OpenRouter returned an unrecognized image payload.',
        );
      }
      return decoded;
    });

    let images;
    try {
      images = await Promise.all(calls);
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `OpenRouter image generation failed for model "${input.model}".`,
      );
    }

    return {
      provider: 'openrouter',
      model: input.model,
      images,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      finishReason: 'stop',
    };
  },

  async generateSpeech(input: ProviderSpeechInput): Promise<ProviderSpeechResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter requires --api-key or OPENROUTER_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const body: Record<string, unknown> = {
      model: input.model,
      input: input.text,
      voice: input.voice ?? 'alloy',
    };
    if (input.format) body.response_format = input.format;
    if (typeof input.speed === 'number') body.speed = input.speed;
    // OpenAI-only passthrough; OpenRouter ignores it for non-OpenAI models.
    if (input.instructions) {
      body.provider = { options: { openai: { instructions: input.instructions } } };
    }

    let response: Response;
    try {
      response = await fetchFn(OPENROUTER_AUDIO_SPEECH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });
    } catch (error) {
      throw toAICliError(
        error,
        'network',
        `OpenRouter speech generation failed for model "${input.model}".`,
      );
    }

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `OpenRouter speech generation failed with status ${response.status}.`,
      );
    }

    const buf = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get('content-type') ?? 'audio/mpeg';

    return {
      provider: 'openrouter',
      model: input.model,
      voice: input.voice,
      audio: { data: buf, mimeType },
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  },

  async refreshSpeechModels(
    input: RefreshModelsInput,
  ): Promise<ProviderSpeechCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter speech-model refresh requires OPENROUTER_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const url = `${OPENROUTER_MODELS_URL}?output_modalities=speech`;
    const response = await fetchFn(url, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
    });
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `OpenRouter speech-model refresh failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as unknown;
    const parsed = openRouterModelsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'OpenRouter model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    return {
      version: 1,
      provider: 'openrouter',
      defaultModel:
        PROVIDER_SPEECH_DEFAULT_MODELS.openrouter ?? OPENROUTER_DEFAULT_SPEECH_MODEL,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: parsed.data.data.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        // Voices vary per model; OpenRouter doesn't enumerate them in the
        // models endpoint, so we leave the list empty and let users discover
        // via the model's own page.
        voices: [],
        metadata: {
          description: m.description ?? null,
          pricing: m.pricing ?? null,
        },
      })),
    };
  },

  async transcribe(input: ProviderTranscribeInput): Promise<ProviderTranscribeResult> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter requires --api-key or OPENROUTER_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const format = inferAudioFormat(input.audioMimeType);
    const data = Buffer.from(input.audio).toString('base64');

    const body: Record<string, unknown> = {
      model: input.model,
      input_audio: { data, format },
    };
    if (input.language) body.language = input.language;

    let response: Response;
    try {
      response = await fetchFn(OPENROUTER_AUDIO_TRANSCRIPTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });
    } catch (error) {
      throw toAICliError(
        error,
        'network',
        `OpenRouter transcription failed for model "${input.model}".`,
      );
    }

    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `OpenRouter transcription failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      text?: string;
      usage?: {
        seconds?: number;
        total_tokens?: number;
        input_tokens?: number;
        output_tokens?: number;
        cost?: number;
      };
    };

    if (typeof payload.text !== 'string') {
      throw new AICliError(
        'provider',
        'OpenRouter transcription response did not include a "text" field.',
      );
    }

    return {
      provider: 'openrouter',
      model: input.model,
      text: payload.text,
      language: input.language,
      duration: payload.usage?.seconds,
      usage: {
        inputTokens: payload.usage?.input_tokens ?? null,
        outputTokens: payload.usage?.output_tokens ?? null,
        totalTokens: payload.usage?.total_tokens ?? null,
      },
    };
  },

  async refreshTranscriptionModels(
    input: RefreshModelsInput,
  ): Promise<ProviderTranscriptionCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter transcription-model refresh requires OPENROUTER_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const url = `${OPENROUTER_MODELS_URL}?output_modalities=transcription`;
    const response = await fetchFn(url, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
    });
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403
        ? 'auth'
        : 'provider';
      throw new AICliError(
        category,
        `OpenRouter transcription-model refresh failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as unknown;
    const parsed = openRouterModelsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'OpenRouter model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    return {
      version: 1,
      provider: 'openrouter',
      defaultModel:
        PROVIDER_TRANSCRIPTION_DEFAULT_MODELS.openrouter
        ?? OPENROUTER_DEFAULT_TRANSCRIPTION_MODEL,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: parsed.data.data.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        metadata: {
          description: m.description ?? null,
          pricing: m.pricing ?? null,
        },
      })),
    };
  },

  async refreshImageModels(
    input: RefreshModelsInput,
  ): Promise<ProviderImageCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'OpenRouter image-model refresh requires OPENROUTER_API_KEY.',
      );
    }

    const fetchFn = input.fetchFn ?? fetch;
    const headers: HeadersInit = {
      accept: 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    };

    const response = await fetchFn(OPENROUTER_MODELS_URL, { headers });
    if (!response.ok) {
      const category =
        response.status === 401 || response.status === 403 ? 'auth' : 'provider';
      throw new AICliError(
        category,
        `OpenRouter image-model refresh failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as unknown;
    const parsed = openRouterModelsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'OpenRouter model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    const imageModels = parsed.data.data.filter((m) =>
      (m.architecture?.output_modalities ?? []).includes('image'),
    );

    return {
      version: 1,
      provider: 'openrouter',
      defaultModel:
        PROVIDER_IMAGE_DEFAULT_MODELS.openrouter ?? OPENROUTER_DEFAULT_IMAGE_MODEL,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: imageModels.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        metadata: {
          description: m.description ?? null,
          pricing: m.pricing ?? null,
          inputModalities: m.architecture?.input_modalities ?? [],
          outputModalities: m.architecture?.output_modalities ?? [],
        },
      })),
    };
  },
};

function decodeImageDataUrl(
  url: string,
): { data: Uint8Array; mimeType: string } | null {
  // Accept "data:image/png;base64,...." or a bare base64 string.
  const match = /^data:([^;]+);base64,(.*)$/.exec(url);
  if (match) {
    const mimeType = match[1] ?? 'image/png';
    const b64 = match[2] ?? '';
    return { data: new Uint8Array(Buffer.from(b64, 'base64')), mimeType };
  }
  if (/^[A-Za-z0-9+/=]+$/.test(url) && url.length > 32) {
    return { data: new Uint8Array(Buffer.from(url, 'base64')), mimeType: 'image/png' };
  }
  return null;
}
