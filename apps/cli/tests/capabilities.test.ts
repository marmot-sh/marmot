import { describe, expect, it } from 'vitest';

import { anthropicAdapter } from '@marmot-sh/anthropic';
import { cloudflareAdapter } from '@marmot-sh/cloudflare';
import { ollamaAdapter } from '@marmot-sh/ollama';
import { openAIAdapter } from '@marmot-sh/openai';
import { openRouterAdapter } from '@marmot-sh/openrouter';
import { vercelAdapter } from '@marmot-sh/vercel';
import {
  getProviderCachePath,
  getProviderImageCachePath,
} from '@marmot-sh/core';

describe('provider capabilities', () => {
  const adapters = [
    openRouterAdapter,
    ollamaAdapter,
    anthropicAdapter,
    openAIAdapter,
    vercelAdapter,
    cloudflareAdapter,
  ];

  it('every adapter declares text capability = true', () => {
    for (const adapter of adapters) {
      expect(adapter.capabilities.text).toBe(true);
    }
  });

  it('Anthropic and Ollama have no audio or image capabilities', () => {
    // OpenRouter has image (chat-completions multimodal) but no audio.
    // Anthropic and Ollama are pure text.
    const textOnly = adapters.filter(
      (a) => !a.capabilities.image && !a.capabilities.speech && !a.capabilities.transcription,
    );
    const slugs = textOnly.map((a) => a.slug).sort();
    expect(slugs).toEqual(['anthropic', 'ollama']);
  });

  it('OpenAI claims speech and transcription support', () => {
    const openai = adapters.find((a) => a.slug === 'openai');
    expect(openai?.capabilities.speech).toBe(true);
    expect(openai?.capabilities.transcription).toBe(true);
    expect(openai?.defaultSpeechModel).toBe('tts-1');
    expect(openai?.defaultTranscriptionModel).toBe('whisper-1');
  });

  it('image-capable adapters expose generateImage + refreshImageModels', () => {
    for (const adapter of adapters) {
      if (adapter.capabilities.image) {
        expect(adapter.generateImage).toBeTypeOf('function');
        expect(adapter.refreshImageModels).toBeTypeOf('function');
        expect(adapter.defaultImageModel).toBeTypeOf('string');
      } else {
        expect(adapter.generateImage).toBeUndefined();
        expect(adapter.refreshImageModels).toBeUndefined();
      }
    }
  });

  it('anthropic and ollama remain text-only by design', () => {
    // OpenRouter has image generation via chat-completions multimodal output.
    // Anthropic and Ollama do not generate images at all.
    const textOnly = adapters.filter((a) => !a.capabilities.image);
    const slugs = textOnly.map((a) => a.slug);
    expect(slugs).toContain('anthropic');
    expect(slugs).toContain('ollama');
  });

  it('image-capable providers are openai/vercel/cloudflare', () => {
    const imageCapable = adapters.filter((a) => a.capabilities.image);
    const slugs = imageCapable.map((a) => a.slug).sort();
    // Updated incrementally as #11, #12, #13 land.
    expect(slugs).toContain('openai');
  });
});

describe('image-cache path resolution', () => {
  it('honors MARMOT_HOME', () => {
    const path = getProviderImageCachePath('openai', {
      MARMOT_HOME: '/tmp/marmot-fake-home',
    });
    expect(path).toBe('/tmp/marmot-fake-home/cache/models/images/openai.json');
  });

  it('namespaces image models separately from text models', () => {
    const env = { MARMOT_HOME: '/tmp/marmot-fake-home' };
    expect(getProviderCachePath('openai', env)).toBe(
      '/tmp/marmot-fake-home/cache/models/text/openai.json',
    );
    expect(getProviderImageCachePath('openai', env)).toBe(
      '/tmp/marmot-fake-home/cache/models/images/openai.json',
    );
  });

  it('falls back to <home>/.marmot/cache/models/images when MARMOT_HOME is not set', () => {
    const path = getProviderImageCachePath('openai', {});
    expect(path).toMatch(/\.marmot\/cache\/models\/images\/openai\.json$/);
  });
});
