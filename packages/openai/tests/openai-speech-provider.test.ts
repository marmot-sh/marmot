import { describe, expect, it, vi } from 'vitest';

import { openAIAdapter } from '../src/index.js';

describe('openAIAdapter speech capabilities', () => {
  it('declares speech and transcription support with sensible defaults', () => {
    expect(openAIAdapter.capabilities.speech).toBe(true);
    expect(openAIAdapter.capabilities.transcription).toBe(true);
    expect(openAIAdapter.defaultSpeechModel).toBe('tts-1');
    expect(openAIAdapter.defaultTranscriptionModel).toBe('whisper-1');
  });

  it('exposes generateSpeech / refreshSpeechModels / transcribe / refreshTranscriptionModels', () => {
    expect(typeof openAIAdapter.generateSpeech).toBe('function');
    expect(typeof openAIAdapter.refreshSpeechModels).toBe('function');
    expect(typeof openAIAdapter.transcribe).toBe('function');
    expect(typeof openAIAdapter.refreshTranscriptionModels).toBe('function');
  });
});

describe('openAIAdapter.refreshSpeechModels', () => {
  it('returns the curated speech model list', async () => {
    const result = await openAIAdapter.refreshSpeechModels!({
      apiKey: 'sk-test',
      now: () => new Date('2026-04-30T08:00:00.000Z'),
    });
    expect(result.provider).toBe('openai');
    expect(result.defaultModel).toBe('tts-1');
    expect(result.models.map((m) => m.id)).toEqual([
      'tts-1',
      'tts-1-hd',
      'gpt-4o-mini-tts',
    ]);
    const tts1 = result.models.find((m) => m.id === 'tts-1');
    expect(tts1?.voices).toContain('alloy');
    expect(tts1?.voices).toContain('nova');
  });

  it('rejects without an api key', async () => {
    await expect(
      openAIAdapter.refreshSpeechModels!({}),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });
});

describe('openAIAdapter.refreshTranscriptionModels', () => {
  it('returns the curated transcription model list', async () => {
    const result = await openAIAdapter.refreshTranscriptionModels!({
      apiKey: 'sk-test',
      now: () => new Date(),
    });
    expect(result.models.map((m) => m.id)).toEqual([
      'gpt-4o-transcribe',
      'gpt-4o-mini-transcribe',
      'whisper-1',
    ]);
  });
});

describe('openAIAdapter.generateSpeech', () => {
  it('rejects without an api key', async () => {
    await expect(
      openAIAdapter.generateSpeech!({
        model: 'tts-1',
        text: 'hi',
      }),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('hits /audio/speech with bearer auth and returns audio bytes', async () => {
    const fake = new Uint8Array([0xff, 0xfb, 0x90, 0x44]);
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toContain('/audio/speech');
      const headers = new Headers(init?.headers as HeadersInit);
      expect(headers.get('authorization')).toBe('Bearer sk-test');
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      expect(body.model).toBe('tts-1');
      expect(body.input).toBe('hello');
      expect(body.voice).toBe('alloy');
      return new Response(fake, {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      });
    });

    const result = await openAIAdapter.generateSpeech!({
      model: 'tts-1',
      text: 'hello',
      voice: 'alloy',
      apiKey: 'sk-test',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.provider).toBe('openai');
    expect(result.voice).toBe('alloy');
    expect(result.audio.data).toEqual(fake);
    expect(result.audio.mimeType).toMatch(/audio\/mpeg/);
  });
});

describe('openAIAdapter.transcribe', () => {
  it('rejects without an api key', async () => {
    await expect(
      openAIAdapter.transcribe!({
        model: 'whisper-1',
        audio: new Uint8Array([0]),
      }),
    ).rejects.toThrowError(/OPENAI_API_KEY/);
  });

  it('returns text from a mocked /audio/transcriptions response', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const target = typeof url === 'string' ? url : url.toString();
      expect(target).toContain('/audio/transcriptions');
      return new Response(
        JSON.stringify({
          text: 'Hello world from whisper.',
          language: 'en',
          duration: 2.4,
          task: 'transcribe',
          segments: [
            {
              id: 0,
              seek: 0,
              start: 0,
              end: 2.4,
              text: 'Hello world from whisper.',
              tokens: [1, 2, 3],
              temperature: 0,
              avg_logprob: -0.1,
              compression_ratio: 1.0,
              no_speech_prob: 0.01,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await openAIAdapter.transcribe!({
      model: 'whisper-1',
      audio: new Uint8Array([0xff, 0xfb, 0x90, 0x44]),
      apiKey: 'sk-test',
      language: 'en',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.text).toBe('Hello world from whisper.');
    expect(result.language).toBe('en');
    expect(result.duration).toBeCloseTo(2.4);
    expect(result.segments).toHaveLength(1);
    expect(result.segments![0]!.text).toContain('Hello world');
  });
});
