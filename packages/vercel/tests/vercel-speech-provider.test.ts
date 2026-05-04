import { describe, expect, it, vi } from 'vitest';

import { vercelAdapter } from '../src/index.js';

describe('vercelAdapter audio capabilities', () => {
  it('declares speech and transcription via OpenAI-proxy', () => {
    expect(vercelAdapter.capabilities.speech).toBe(true);
    expect(vercelAdapter.capabilities.transcription).toBe(true);
    expect(vercelAdapter.defaultSpeechModel).toBe('openai/tts-1');
    expect(vercelAdapter.defaultTranscriptionModel).toBe('openai/whisper-1');
  });

  it('exposes generateSpeech / refreshSpeechModels / transcribe / refreshTranscriptionModels', () => {
    expect(typeof vercelAdapter.generateSpeech).toBe('function');
    expect(typeof vercelAdapter.refreshSpeechModels).toBe('function');
    expect(typeof vercelAdapter.transcribe).toBe('function');
    expect(typeof vercelAdapter.refreshTranscriptionModels).toBe('function');
  });
});

describe('vercelAdapter.refreshSpeechModels', () => {
  it('returns the curated speech model list (gateway has no audio listing yet)', async () => {
    const result = await vercelAdapter.refreshSpeechModels!({
      apiKey: 'gw_test',
      now: () => new Date('2026-04-30T08:00:00.000Z'),
    });
    expect(result.provider).toBe('vercel');
    expect(result.defaultModel).toBe('openai/tts-1');
    expect(result.models.map((m) => m.id)).toEqual([
      'openai/tts-1',
      'openai/tts-1-hd',
      'openai/gpt-4o-mini-tts',
    ]);
    const tts1 = result.models.find((m) => m.id === 'openai/tts-1');
    expect(tts1?.voices).toContain('alloy');
  });

  it('rejects without an api key', async () => {
    await expect(
      vercelAdapter.refreshSpeechModels!({}),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});

describe('vercelAdapter.refreshTranscriptionModels', () => {
  it('returns the curated transcription model list', async () => {
    const result = await vercelAdapter.refreshTranscriptionModels!({
      apiKey: 'gw_test',
      now: () => new Date(),
    });
    expect(result.models.map((m) => m.id)).toEqual([
      'openai/whisper-1',
      'openai/gpt-4o-transcribe',
      'openai/gpt-4o-mini-transcribe',
    ]);
  });

  it('rejects without an api key', async () => {
    await expect(
      vercelAdapter.refreshTranscriptionModels!({}),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});

describe('vercelAdapter.generateSpeech', () => {
  it('rejects without an api key', async () => {
    await expect(
      vercelAdapter.generateSpeech!({
        model: 'openai/tts-1',
        text: 'hi',
      }),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });

  it('routes through the gateway baseURL and strips the openai/ prefix', async () => {
    const fake = new Uint8Array([0xff, 0xfb, 0x90, 0x44]);
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toContain('ai-gateway.vercel.sh/v1/audio/speech');
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get('authorization')).toBe('Bearer gw_test');
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.model).toBe('tts-1'); // prefix stripped
      expect(body.input).toBe('hello');
      expect(body.voice).toBe('alloy');
      return new Response(fake, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    const result = await vercelAdapter.generateSpeech!({
      model: 'openai/tts-1',
      text: 'hello',
      voice: 'alloy',
      apiKey: 'gw_test',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe('vercel');
    expect(result.audio.data).toEqual(fake);
  });
});

describe('vercelAdapter.transcribe', () => {
  it('rejects without an api key', async () => {
    await expect(
      vercelAdapter.transcribe!({
        model: 'openai/whisper-1',
        audio: new Uint8Array([0]),
      }),
    ).rejects.toThrowError(/AI_GATEWAY_API_KEY/);
  });
});
