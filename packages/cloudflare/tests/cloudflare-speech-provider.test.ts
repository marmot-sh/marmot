import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

import { cloudflareAdapter } from '../src/index.js';

const baseInput = {
  apiKey: 'cf_test_token',
  cloudflareAccountId: 'acct_test',
};

describe('cloudflareAdapter audio capabilities', () => {
  it('declares speech and transcription with curated defaults', () => {
    expect(cloudflareAdapter.capabilities.speech).toBe(true);
    expect(cloudflareAdapter.capabilities.transcription).toBe(true);
    expect(cloudflareAdapter.defaultSpeechModel).toBe('@cf/myshell-ai/melotts');
    expect(cloudflareAdapter.defaultTranscriptionModel).toBe(
      '@cf/openai/whisper-large-v3-turbo',
    );
  });
});

describe('cloudflareAdapter.refreshSpeechModels', () => {
  it('returns the curated speech model list', async () => {
    const result = await cloudflareAdapter.refreshSpeechModels!({
      ...baseInput,
      now: () => new Date(),
    });
    expect(result.models.map((m) => m.id)).toEqual(['@cf/myshell-ai/melotts']);
  });

  it('rejects without credentials', async () => {
    await expect(
      cloudflareAdapter.refreshSpeechModels!({}),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });
});

describe('cloudflareAdapter.refreshTranscriptionModels', () => {
  it('returns the curated transcription model list', async () => {
    const result = await cloudflareAdapter.refreshTranscriptionModels!({
      ...baseInput,
      now: () => new Date(),
    });
    expect(result.models.map((m) => m.id)).toEqual([
      '@cf/openai/whisper',
      '@cf/openai/whisper-large-v3-turbo',
      '@cf/deepgram/nova-3',
    ]);
  });
});

describe('cloudflareAdapter.generateSpeech', () => {
  const SAMPLE = new Uint8Array([0xff, 0xfb, 0x90, 0x44]);

  it('rejects without credentials', async () => {
    await expect(
      cloudflareAdapter.generateSpeech!({
        model: '@cf/myshell-ai/melotts',
        text: 'hi',
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });

  it('hits /ai/run/<model> with bearer auth and posts the prompt', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toBe(
        'https://api.cloudflare.com/client/v4/accounts/acct_test/ai/run/@cf/myshell-ai/melotts',
      );
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer cf_test_token');
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.prompt).toBe('hello world');
      return new Response(SAMPLE, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    const result = await cloudflareAdapter.generateSpeech!({
      ...baseInput,
      model: '@cf/myshell-ai/melotts',
      text: 'hello world',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.audio.data).toEqual(SAMPLE);
    expect(result.audio.mimeType).toMatch(/audio\/mpeg/);
  });

  it('handles JSON-wrapped base64 audio responses', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ audio: Buffer.from(SAMPLE).toString('base64') }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await cloudflareAdapter.generateSpeech!({
      ...baseInput,
      model: '@cf/myshell-ai/melotts',
      text: 'hi',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.audio.data).toEqual(SAMPLE);
  });
});

describe('cloudflareAdapter.transcribe', () => {
  it('rejects without credentials', async () => {
    await expect(
      cloudflareAdapter.transcribe!({
        model: '@cf/openai/whisper',
        audio: new Uint8Array([0]),
      }),
    ).rejects.toThrowError(/CLOUDFLARE_API_TOKEN/);
  });

  it('serializes audio bytes as a number[] in the JSON body', async () => {
    const sample = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchFn = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.audio).toEqual([1, 2, 3, 4, 5]);
      expect(body.language).toBe('en');
      return new Response(
        JSON.stringify({ text: 'hello world', words: [{ word: 'hello', start: 0, end: 0.5 }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await cloudflareAdapter.transcribe!({
      ...baseInput,
      model: '@cf/openai/whisper',
      audio: sample,
      language: 'en',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.text).toBe('hello world');
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0]!.text).toBe('hello');
  });

  it('falls back to result.text when present', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({ result: { text: 'nested', language: 'en' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await cloudflareAdapter.transcribe!({
      ...baseInput,
      model: '@cf/openai/whisper',
      audio: new Uint8Array([0]),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(result.text).toBe('nested');
    expect(result.language).toBe('en');
  });
});
