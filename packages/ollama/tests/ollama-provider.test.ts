import { describe, expect, it } from 'vitest';

import { ollamaAdapter } from '../src/index.js';

const baseUrl = 'http://test.local:11434/api';

describe('ollamaAdapter shape', () => {
  it('declares the expected adapter metadata', () => {
    expect(ollamaAdapter.slug).toBe('ollama');
    expect(ollamaAdapter.name).toBe('Ollama');
    expect(ollamaAdapter.requiresApiKey).toBe(false);
    expect(ollamaAdapter.capabilities).toEqual({
      text: true,
      image: false,
      speech: false,
      transcription: false,
    });
    expect(typeof ollamaAdapter.defaultModel).toBe('string');
    expect(ollamaAdapter.defaultModel.length).toBeGreaterThan(0);
  });

  it('does not implement audio or image methods', () => {
    expect(ollamaAdapter.generateImage).toBeUndefined();
    expect(ollamaAdapter.generateSpeech).toBeUndefined();
    expect(ollamaAdapter.transcribe).toBeUndefined();
  });

  it('implements every required method', () => {
    expect(typeof ollamaAdapter.generate).toBe('function');
    expect(typeof ollamaAdapter.generateObject).toBe('function');
    expect(typeof ollamaAdapter.stream).toBe('function');
    expect(typeof ollamaAdapter.refreshModels).toBe('function');
  });
});

describe('ollamaAdapter.refreshModels', () => {
  it('parses the /api/tags payload into cache entries', async () => {
    const payload = {
      models: [
        {
          name: 'llama3.2:latest',
          model: 'llama3.2:latest',
          modified_at: '2026-04-01T12:00:00.000Z',
          size: 2_019_393_189,
          digest: 'sha256:a80c4f17acd55e1d44ba99a4eaf79b4fa5d01e73d7e05f5a6e9e7c5b1b0a0001',
          details: { family: 'llama' },
        },
        {
          name: 'qwen2.5:7b',
          model: 'qwen2.5:7b',
          size: 4_683_087_519,
        },
      ],
    };

    const result = await ollamaAdapter.refreshModels({
      ollamaBaseUrl: baseUrl,
      fetchFn: async (url) => {
        expect(String(url)).toBe(`${baseUrl}/tags`);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      now: () => new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(result.provider).toBe('ollama');
    expect(result.fetchedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toMatchObject({
      id: 'llama3.2:latest',
      name: 'llama3.2:latest',
      inputModalities: ['text'],
      outputModalities: ['text'],
      updatedAt: '2026-04-01T12:00:00.000Z',
    });
    expect(result.models[0]!.metadata).toMatchObject({
      size: 2_019_393_189,
      digest: expect.stringMatching(/^sha256:/),
      details: { family: 'llama' },
    });
    // Second entry is missing modified_at → updatedAt should be null.
    expect(result.models[1]!.updatedAt).toBeNull();
    expect(result.models[1]!.metadata).toMatchObject({
      size: 4_683_087_519,
      digest: null,
      details: {},
    });
  });

  it('returns an empty model list when Ollama has no installed models', async () => {
    const result = await ollamaAdapter.refreshModels({
      ollamaBaseUrl: baseUrl,
      fetchFn: async () =>
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
    });
    expect(result.models).toEqual([]);
  });

  it('throws a network error when the fetch itself fails', async () => {
    await expect(
      ollamaAdapter.refreshModels({
        ollamaBaseUrl: baseUrl,
        fetchFn: async () => {
          throw new TypeError('fetch failed');
        },
      }),
    ).rejects.toThrowError(/Failed to reach the Ollama tags endpoint/);
  });

  it('throws a provider error when Ollama returns a non-2xx status', async () => {
    await expect(
      ollamaAdapter.refreshModels({
        ollamaBaseUrl: baseUrl,
        fetchFn: async () => new Response('upstream blew up', { status: 502 }),
      }),
    ).rejects.toThrowError(/status 502/);
  });

  it('throws a cache error when the body is not valid JSON', async () => {
    await expect(
      ollamaAdapter.refreshModels({
        ollamaBaseUrl: baseUrl,
        fetchFn: async () =>
          new Response('<!doctype html><html>nope</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
      }),
    ).rejects.toThrowError(/invalid JSON/);
  });

  it('throws a cache error when the payload does not match the schema', async () => {
    await expect(
      ollamaAdapter.refreshModels({
        ollamaBaseUrl: baseUrl,
        fetchFn: async () =>
          new Response(JSON.stringify({ wrong: 'shape' }), { status: 200 }),
      }),
    ).rejects.toThrowError(/did not match the expected schema/);
  });

  it('falls back to model.name when model.model is missing', async () => {
    const result = await ollamaAdapter.refreshModels({
      ollamaBaseUrl: baseUrl,
      fetchFn: async () =>
        new Response(
          JSON.stringify({ models: [{ name: 'phi3:mini' }] }),
          { status: 200 },
        ),
    });
    expect(result.models[0]!.id).toBe('phi3:mini');
    expect(result.models[0]!.name).toBe('phi3:mini');
  });

  it('coerces a malformed modified_at into null instead of throwing', async () => {
    const result = await ollamaAdapter.refreshModels({
      ollamaBaseUrl: baseUrl,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            models: [{ name: 'mistral:7b', modified_at: 'not-a-real-date' }],
          }),
          { status: 200 },
        ),
    });
    expect(result.models[0]!.updatedAt).toBeNull();
  });
});
