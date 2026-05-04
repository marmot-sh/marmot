import {
  extractJsonMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';

import { Buffer } from 'node:buffer';

import {
  CLOUDFLARE_API_BASE,
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

const CLOUDFLARE_IMAGE_MODELS = [
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    name: 'FLUX.1 [schnell]',
    description: 'Fast 4-step image generator from Black Forest Labs.',
  },
  {
    id: '@cf/bytedance/stable-diffusion-xl-lightning',
    name: 'SDXL Lightning',
    description: 'Distilled SDXL by ByteDance — 4 steps.',
  },
  {
    id: '@cf/lykon/dreamshaper-8-lcm',
    name: 'DreamShaper 8 LCM',
    description: 'Stylized image generator (Latent Consistency Model).',
  },
  {
    id: '@cf/runwayml/stable-diffusion-v1-5-img2img',
    name: 'Stable Diffusion 1.5 (img2img)',
    description: 'Image-to-image conditioning via SD 1.5.',
  },
] as const;

function imageRunUrl(accountId: string, model: string): string {
  return `${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/run/${model}`;
}

const cloudflareModelSchema = z.object({
  id: z.string(),
  source: z.number().int().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  task: z
    .object({
      id: z.string().nullable().optional(),
      name: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  created_at: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  properties: z
    .array(
      z.object({
        property_id: z.string(),
        value: z.unknown(),
      }),
    )
    .nullable()
    .optional(),
});

const cloudflareModelsResponseSchema = z.object({
  success: z.boolean(),
  errors: z.array(z.unknown()).nullable().optional(),
  messages: z.array(z.unknown()).nullable().optional(),
  result: z.array(cloudflareModelSchema),
});

function chatBaseUrl(accountId: string): string {
  return `${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/v1`;
}

function modelsListUrl(accountId: string, perPage = 200): string {
  const params = new URLSearchParams({
    per_page: String(perPage),
    hide_experimental: 'true',
  });
  return `${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/models/search?${params.toString()}`;
}

function requireCredentials<
  T extends { apiKey?: string; cloudflareAccountId?: string },
>(
  input: T,
): asserts input is T & { apiKey: string; cloudflareAccountId: string } {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Cloudflare Workers AI requires --api-key or CLOUDFLARE_API_TOKEN.',
    );
  }
  if (!input.cloudflareAccountId) {
    throw new AICliError(
      'auth',
      'Cloudflare Workers AI requires CLOUDFLARE_ACCOUNT_ID.',
    );
  }
}

function buildProvider(input: {
  apiKey: string;
  cloudflareAccountId: string;
  fetchFn?: typeof fetch;
}) {
  return createOpenAI({
    apiKey: input.apiKey,
    baseURL: chatBaseUrl(input.cloudflareAccountId),
    fetch: input.fetchFn,
  });
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

const CLOUDFLARE_SPEECH_MODELS = [
  {
    id: '@cf/myshell-ai/melotts',
    name: 'MeloTTS',
    description: 'Multilingual high-quality TTS by MyShell AI.',
    voices: ['default'],
  },
] as const;

const CLOUDFLARE_TRANSCRIPTION_MODELS = [
  {
    id: '@cf/openai/whisper',
    name: 'Whisper',
    description: 'OpenAI Whisper running on Workers AI.',
  },
  {
    id: '@cf/openai/whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    description: 'Faster Whisper variant.',
  },
  {
    id: '@cf/deepgram/nova-3',
    name: 'Deepgram Nova 3',
    description: 'Deepgram\'s flagship transcription model on Workers AI.',
  },
] as const;

export const cloudflareAdapter: ProviderAdapter = {
  slug: 'cloudflare',
  name: 'Cloudflare Workers AI',
  defaultModel: PROVIDER_DEFAULT_MODELS.cloudflare,
  defaultImageModel: '@cf/black-forest-labs/flux-1-schnell',
  defaultSpeechModel: '@cf/myshell-ai/melotts',
  defaultTranscriptionModel: '@cf/openai/whisper-large-v3-turbo',
  requiresApiKey: true,
  capabilities: { text: true, image: true, speech: true, transcription: true },

  async generate(
    input: ProviderGenerateInput,
  ): Promise<ProviderGenerateResult> {
    requireCredentials(input);

    try {
      const provider = buildProvider({
        apiKey: input.apiKey,
        cloudflareAccountId: input.cloudflareAccountId,
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
        provider: 'cloudflare',
        model: input.model,
        text: result.text,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Cloudflare Workers AI generation failed for model "${input.model}".`,
      );
    }
  },

  async generateObject(
    input: ProviderObjectGenerateInput,
  ): Promise<ProviderObjectGenerateResult> {
    requireCredentials(input);

    try {
      const provider = buildProvider({
        apiKey: input.apiKey,
        cloudflareAccountId: input.cloudflareAccountId,
        fetchFn: input.fetchFn,
      });

      const model = wrapLanguageModel({
        model: provider(input.model),
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
        provider: 'cloudflare',
        model: input.model,
        output: result.output,
        usage: normalizeUsage(result.usage),
        finishReason: result.finishReason ?? null,
      };
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Cloudflare Workers AI object generation failed for model "${input.model}".`,
      );
    }
  },

  async stream(input: ProviderGenerateInput): Promise<ProviderStreamResult> {
    requireCredentials(input);

    try {
      const provider = buildProvider({
        apiKey: input.apiKey,
        cloudflareAccountId: input.cloudflareAccountId,
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
            provider: 'cloudflare' as const,
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
        `Cloudflare Workers AI streaming failed for model "${input.model}".`,
      );
    }
  },

  async refreshModels(
    input: RefreshModelsInput,
  ): Promise<ProviderCacheFile> {
    requireCredentials(input);

    const fetchFn = input.fetchFn ?? fetch;
    const headers: HeadersInit = {
      accept: 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    };

    let response: Response;

    try {
      response = await fetchFn(modelsListUrl(input.cloudflareAccountId), {
        headers,
      });
    } catch (error) {
      throw new AICliError(
        'network',
        'Failed to reach the Cloudflare Workers AI models endpoint.',
        { cause: error },
      );
    }

    if (!response.ok) {
      const category =
        response.status === 401 || response.status === 403 ? 'auth' : 'provider';
      throw new AICliError(
        category,
        `Cloudflare Workers AI model refresh failed with status ${response.status}.`,
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new AICliError(
        'cache',
        'Cloudflare returned invalid JSON while refreshing models.',
        { cause: error },
      );
    }

    const parsed = cloudflareModelsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new AICliError(
        'cache',
        'Cloudflare model metadata did not match the expected schema.',
        { cause: parsed.error },
      );
    }

    // Restrict the cache to text-generation models so --model validation
    // matches the OpenAI-compatible chat endpoint we actually call.
    const textGeneration = parsed.data.result.filter((model) =>
      isTextGenerationModel(model),
    );

    return {
      version: 1,
      provider: 'cloudflare',
      defaultModel: PROVIDER_DEFAULT_MODELS.cloudflare,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: textGeneration.map((model) => ({
        id: model.name,
        name: model.name,
        contextLength: null,
        pricing: null,
        inputModalities: ['text'],
        outputModalities: ['text'],
        updatedAt: model.created_at ?? null,
        metadata: {
          description: model.description ?? null,
          task: model.task?.name ?? null,
          tags: model.tags ?? [],
        },
      })),
    };
  },

  async generateImage(
    input: ProviderImageGenerateInput,
  ): Promise<ProviderImageGenerateResult> {
    requireCredentials(input);

    const fetchFn = input.fetchFn ?? fetch;
    const url = imageRunUrl(input.cloudflareAccountId, input.model);
    const body = buildImageRunBody(input);

    const calls = Array.from({ length: input.n }, async () => {
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
          response.status === 401 || response.status === 403 ? 'auth' : 'provider';
        throw new AICliError(
          category,
          `Cloudflare Workers AI image generation failed with status ${response.status}.`,
        );
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();

      if (contentType.startsWith('application/json')) {
        const payload = (await response.json()) as { image?: string; result?: { image?: string } };
        const b64 = payload.image ?? payload.result?.image;
        if (!b64) {
          throw new AICliError(
            'provider',
            'Cloudflare returned a JSON response without an image field.',
          );
        }
        return {
          data: new Uint8Array(Buffer.from(b64, 'base64')),
          mimeType: 'image/png',
        };
      }

      const buffer = await response.arrayBuffer();
      return {
        data: new Uint8Array(buffer),
        mimeType: contentType || 'image/png',
      };
    });

    let images;
    try {
      images = await Promise.all(calls);
    } catch (error) {
      throw toAICliError(
        error,
        'provider',
        `Cloudflare Workers AI image generation failed for model "${input.model}".`,
      );
    }

    return {
      provider: 'cloudflare',
      model: input.model,
      images,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
      finishReason: 'stop',
    };
  },

  async refreshImageModels(
    input: RefreshModelsInput,
  ): Promise<ProviderImageCacheFile> {
    if (!input.apiKey) {
      throw new AICliError(
        'auth',
        'Cloudflare Workers AI requires --api-key or CLOUDFLARE_API_TOKEN.',
      );
    }
    if (!input.cloudflareAccountId) {
      throw new AICliError(
        'auth',
        'Cloudflare Workers AI requires CLOUDFLARE_ACCOUNT_ID.',
      );
    }

    return {
      version: 1,
      provider: 'cloudflare',
      defaultModel: PROVIDER_IMAGE_DEFAULT_MODELS.cloudflare!,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: CLOUDFLARE_IMAGE_MODELS.map((model) => ({
        id: model.id,
        name: model.name,
        metadata: { description: model.description },
      })),
    };
  },

  async generateSpeech(input: ProviderSpeechInput): Promise<ProviderSpeechResult> {
    requireCredentials(input);
    const fetchFn = input.fetchFn ?? fetch;
    const url = imageRunUrl(input.cloudflareAccountId, input.model);

    const body: Record<string, unknown> = { prompt: input.text };
    if (input.voice) body.voice = input.voice;

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
        response.status === 401 || response.status === 403 ? 'auth' : 'provider';
      throw new AICliError(
        category,
        `Cloudflare Workers AI speech generation failed with status ${response.status}.`,
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    let data: Uint8Array;
    let mimeType: string;

    if (contentType.startsWith('application/json')) {
      const payload = (await response.json()) as { audio?: string };
      if (!payload.audio) {
        throw new AICliError(
          'provider',
          'Cloudflare returned a JSON response without an audio field.',
        );
      }
      data = new Uint8Array(Buffer.from(payload.audio, 'base64'));
      mimeType = 'audio/mpeg';
    } else {
      const buffer = await response.arrayBuffer();
      data = new Uint8Array(buffer);
      mimeType = contentType || 'audio/mpeg';
    }

    return {
      provider: 'cloudflare',
      model: input.model,
      voice: input.voice,
      audio: { data, mimeType },
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  },

  async refreshSpeechModels(
    input: RefreshModelsInput,
  ): Promise<ProviderSpeechCacheFile> {
    requireCredentials(input);
    return {
      version: 1,
      provider: 'cloudflare',
      defaultModel: PROVIDER_SPEECH_DEFAULT_MODELS.cloudflare!,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: CLOUDFLARE_SPEECH_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        voices: [...m.voices],
        metadata: { description: m.description },
      })),
    };
  },

  async transcribe(input: ProviderTranscribeInput): Promise<ProviderTranscribeResult> {
    requireCredentials(input);
    const fetchFn = input.fetchFn ?? fetch;
    const url = imageRunUrl(input.cloudflareAccountId, input.model);

    // Cloudflare expects audio bytes as a number[] in JSON body for whisper.
    const audioArray = Array.from(input.audio);
    const body: Record<string, unknown> = { audio: audioArray };
    if (input.language) body.language = input.language;
    if (input.prompt) body.initial_prompt = input.prompt;

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
        response.status === 401 || response.status === 403 ? 'auth' : 'provider';
      throw new AICliError(
        category,
        `Cloudflare Workers AI transcription failed with status ${response.status}.`,
      );
    }

    const payload = (await response.json()) as {
      text?: string;
      result?: { text?: string; language?: string };
      vtt?: string;
      words?: Array<{ word: string; start: number; end: number }>;
    };

    const text = payload.text ?? payload.result?.text ?? '';
    const language = payload.result?.language;

    return {
      provider: 'cloudflare',
      model: input.model,
      text,
      language,
      duration: undefined,
      segments: payload.words?.map((w) => ({
        start: w.start,
        end: w.end,
        text: w.word,
      })),
      raw: payload.vtt,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  },

  async refreshTranscriptionModels(
    input: RefreshModelsInput,
  ): Promise<ProviderTranscriptionCacheFile> {
    requireCredentials(input);
    return {
      version: 1,
      provider: 'cloudflare',
      defaultModel: PROVIDER_TRANSCRIPTION_DEFAULT_MODELS.cloudflare!,
      fetchedAt: (input.now?.() ?? new Date()).toISOString(),
      models: CLOUDFLARE_TRANSCRIPTION_MODELS.map((m) => ({
        id: m.id,
        name: m.name,
        metadata: { description: m.description },
      })),
    };
  },
};

function buildImageRunBody(input: ProviderImageGenerateInput): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (input.size) {
    const [w, h] = input.size.split('x').map((part) => Number(part));
    if (Number.isFinite(w) && Number.isFinite(h)) {
      body.width = w;
      body.height = h;
    }
  }
  if (typeof input.seed === 'number') {
    body.seed = input.seed;
  }
  if (input.negative) {
    body.negative_prompt = input.negative;
  }
  return body;
}

function isTextGenerationModel(model: {
  task?: { name?: string | null } | null;
}): boolean {
  const task = model.task?.name?.toLowerCase() ?? '';
  return task === 'text generation' || task === 'text-generation';
}
