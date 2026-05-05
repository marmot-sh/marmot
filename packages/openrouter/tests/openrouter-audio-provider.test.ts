import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { openRouterAdapter } from '../src/index.js';

describe('openRouterAdapter capabilities', () => {
  it('declares speech and transcription support', () => {
    expect(openRouterAdapter.capabilities).toEqual({
      text: true,
      image: true,
      speech: true,
      transcription: true,
    });
    expect(openRouterAdapter.defaultSpeechModel).toBe('openai/gpt-4o-mini-tts-2025-12-15');
    expect(openRouterAdapter.defaultTranscriptionModel).toBe('openai/whisper-1');
    expect(typeof openRouterAdapter.generateSpeech).toBe('function');
    expect(typeof openRouterAdapter.refreshSpeechModels).toBe('function');
    expect(typeof openRouterAdapter.transcribe).toBe('function');
    expect(typeof openRouterAdapter.refreshTranscriptionModels).toBe('function');
  });
});

describe('openRouterAdapter.generateSpeech', () => {
  it('POSTs OpenAI-compat body and returns the raw audio bytes', async () => {
    const audioBytes = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00]); // ID3v2 header
    let capturedBody: Record<string, unknown> | undefined;
    let capturedAuth: string | undefined;
    let capturedUrl: string | undefined;

    const result = await openRouterAdapter.generateSpeech!({
      apiKey: 'sk-or-test',
      model: 'openai/tts-1',
      text: 'Hello world.',
      voice: 'nova',
      format: 'mp3',
      speed: 1.2,
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedAuth = (init?.headers as Record<string, string>).Authorization;
        capturedBody = JSON.parse(String(init?.body));
        return new Response(audioBytes, {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        });
      },
    });

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/audio/speech');
    expect(capturedAuth).toBe('Bearer sk-or-test');
    expect(capturedBody).toEqual({
      model: 'openai/tts-1',
      input: 'Hello world.',
      voice: 'nova',
      response_format: 'mp3',
      speed: 1.2,
    });
    expect(result.provider).toBe('openrouter');
    expect(result.audio.data).toBeInstanceOf(Uint8Array);
    expect(result.audio.data).toHaveLength(5);
    expect(result.audio.mimeType).toBe('audio/mpeg');
    expect(result.voice).toBe('nova');
  });

  it('defaults voice to "alloy" when none is given', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    await openRouterAdapter.generateSpeech!({
      apiKey: 'sk-or-test',
      model: 'openai/tts-1',
      text: 'hi',
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(new Uint8Array([1, 2]), { status: 200 });
      },
    });
    expect(capturedBody?.voice).toBe('alloy');
  });

  it('defaults response_format to mp3 when none is given', async () => {
    // Some OpenRouter speech models (e.g. gpt-4o-mini-tts) silently default
    // to raw PCM, which the marmot pipeline (mp3 temp filename, afplay) can't
    // play. The adapter must request mp3 explicitly so output is always
    // playable regardless of the model's silent default.
    let capturedBody: Record<string, unknown> | undefined;
    await openRouterAdapter.generateSpeech!({
      apiKey: 'sk-or-test',
      model: 'openai/gpt-4o-mini-tts-2025-12-15',
      text: 'hi',
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(new Uint8Array([1, 2]), { status: 200 });
      },
    });
    expect(capturedBody?.response_format).toBe('mp3');
  });

  it('wraps instructions inside provider.options.openai (OpenAI passthrough)', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    await openRouterAdapter.generateSpeech!({
      apiKey: 'sk-or-test',
      model: 'openai/tts-1',
      text: 'hi',
      voice: 'nova',
      instructions: 'Speak warmly.',
      fetchFn: async (_url, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return new Response(new Uint8Array([1]), { status: 200 });
      },
    });
    expect(capturedBody?.provider).toEqual({
      options: { openai: { instructions: 'Speak warmly.' } },
    });
  });

  it('throws an auth error when the apiKey is missing', async () => {
    await expect(
      openRouterAdapter.generateSpeech!({
        model: 'openai/tts-1',
        text: 'hi',
      }),
    ).rejects.toThrowError(/OPENROUTER_API_KEY/);
  });

  it('throws an auth error on 401', async () => {
    await expect(
      openRouterAdapter.generateSpeech!({
        apiKey: 'bad',
        model: 'openai/tts-1',
        text: 'hi',
        fetchFn: async () => new Response('', { status: 401 }),
      }),
    ).rejects.toThrowError(/status 401/);
  });

  it('throws a provider error on 5xx', async () => {
    await expect(
      openRouterAdapter.generateSpeech!({
        apiKey: 'sk-or-test',
        model: 'openai/tts-1',
        text: 'hi',
        fetchFn: async () => new Response('boom', { status: 502 }),
      }),
    ).rejects.toThrowError(/status 502/);
  });
});

describe('openRouterAdapter.transcribe', () => {
  it('POSTs base64 audio inside input_audio and parses the response', async () => {
    const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // "RIFF"
    const expectedBase64 = Buffer.from(audio).toString('base64');
    let capturedBody: Record<string, unknown> | undefined;
    let capturedUrl: string | undefined;

    const result = await openRouterAdapter.transcribe!({
      apiKey: 'sk-or-test',
      model: 'openai/whisper-1',
      audio,
      audioMimeType: 'audio/wav',
      language: 'en',
      fetchFn: async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            text: 'Hello world.',
            usage: {
              seconds: 9.2,
              total_tokens: 113,
              input_tokens: 83,
              output_tokens: 30,
              cost: 0.000508,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(capturedBody).toEqual({
      model: 'openai/whisper-1',
      input_audio: { data: expectedBase64, format: 'wav' },
      language: 'en',
    });
    expect(result.provider).toBe('openrouter');
    expect(result.text).toBe('Hello world.');
    expect(result.duration).toBe(9.2);
    expect(result.usage).toEqual({
      inputTokens: 83,
      outputTokens: 30,
      totalTokens: 113,
    });
  });

  it('infers format from common audio mime types', async () => {
    const cases: Array<[string, string]> = [
      ['audio/mpeg', 'mp3'],
      ['audio/mp3', 'mp3'],
      ['audio/flac', 'flac'],
      ['audio/mp4', 'm4a'],
      ['audio/ogg', 'ogg'],
      ['audio/webm', 'webm'],
      ['audio/aac', 'aac'],
      ['audio/wav', 'wav'],
      ['audio/wave', 'wav'],
    ];
    for (const [mime, expected] of cases) {
      let captured: Record<string, unknown> | undefined;
      await openRouterAdapter.transcribe!({
        apiKey: 'sk-or-test',
        model: 'openai/whisper-1',
        audio: new Uint8Array([1, 2, 3]),
        audioMimeType: mime,
        fetchFn: async (_url, init) => {
          captured = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
        },
      });
      const inputAudio = captured?.input_audio as { format: string };
      expect(inputAudio.format).toBe(expected);
    }
  });

  it('falls back to "wav" for unknown / missing mime types', async () => {
    let captured: Record<string, unknown> | undefined;
    await openRouterAdapter.transcribe!({
      apiKey: 'sk-or-test',
      model: 'openai/whisper-1',
      audio: new Uint8Array([1]),
      audioMimeType: 'application/octet-stream',
      fetchFn: async (_url, init) => {
        captured = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ text: 'ok' }), { status: 200 });
      },
    });
    const inputAudio = captured?.input_audio as { format: string };
    expect(inputAudio.format).toBe('wav');
  });

  it('throws when the response payload is missing the text field', async () => {
    await expect(
      openRouterAdapter.transcribe!({
        apiKey: 'sk-or-test',
        model: 'openai/whisper-1',
        audio: new Uint8Array([1]),
        fetchFn: async () =>
          new Response(JSON.stringify({ usage: { seconds: 1 } }), { status: 200 }),
      }),
    ).rejects.toThrowError(/did not include a "text" field/);
  });

  it('throws an auth error on 401', async () => {
    await expect(
      openRouterAdapter.transcribe!({
        apiKey: 'bad',
        model: 'openai/whisper-1',
        audio: new Uint8Array([1]),
        fetchFn: async () => new Response('', { status: 401 }),
      }),
    ).rejects.toThrowError(/status 401/);
  });

  it('throws when apiKey is missing', async () => {
    await expect(
      openRouterAdapter.transcribe!({
        model: 'openai/whisper-1',
        audio: new Uint8Array([1]),
      }),
    ).rejects.toThrowError(/OPENROUTER_API_KEY/);
  });
});

describe('openRouterAdapter.refreshSpeechModels', () => {
  it('queries with output_modalities=speech and parses results', async () => {
    let capturedUrl: string | undefined;
    const payload = {
      data: [
        {
          id: 'openai/tts-1',
          name: 'OpenAI TTS-1',
          architecture: { output_modalities: ['speech'] },
          pricing: { prompt: '0', completion: '0', request: '0', image: null },
          description: 'Text to speech',
        },
      ],
    };
    const result = await openRouterAdapter.refreshSpeechModels!({
      apiKey: 'sk-or-test',
      now: () => new Date('2026-05-01T00:00:00.000Z'),
      fetchFn: async (url) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    });
    expect(capturedUrl).toBe(
      'https://openrouter.ai/api/v1/models?output_modalities=speech',
    );
    expect(result.provider).toBe('openrouter');
    expect(result.defaultModel).toBe('openai/gpt-4o-mini-tts-2025-12-15');
    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toMatchObject({
      id: 'openai/tts-1',
      name: 'OpenAI TTS-1',
      voices: [],
    });
  });

  it('throws auth when key is missing', async () => {
    await expect(
      openRouterAdapter.refreshSpeechModels!({}),
    ).rejects.toThrowError(/OPENROUTER_API_KEY/);
  });
});

describe('openRouterAdapter.refreshTranscriptionModels', () => {
  it('queries with output_modalities=transcription and parses results', async () => {
    let capturedUrl: string | undefined;
    const payload = {
      data: [
        {
          id: 'openai/whisper-1',
          name: 'OpenAI Whisper-1',
          architecture: { output_modalities: ['transcription'] },
        },
      ],
    };
    const result = await openRouterAdapter.refreshTranscriptionModels!({
      apiKey: 'sk-or-test',
      fetchFn: async (url) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    });
    expect(capturedUrl).toBe(
      'https://openrouter.ai/api/v1/models?output_modalities=transcription',
    );
    expect(result.defaultModel).toBe('openai/whisper-1');
    expect(result.models[0]).toMatchObject({
      id: 'openai/whisper-1',
      name: 'OpenAI Whisper-1',
    });
  });
});
