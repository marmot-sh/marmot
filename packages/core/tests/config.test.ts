import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readMarmotConfig,
  resolveImageDefaults,
  resolveSpeechDefaults,
  resolveTextDefaults,
  resolveTranscriptionDefaults,
  writeMarmotConfig,
} from '../src/lib/config.js';

const tempDirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-config-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

describe('readMarmotConfig', () => {
  it('returns null when no config file exists', async () => {
    const { env } = await fixture();
    const result = await readMarmotConfig(env);
    expect(result).toBeNull();
  });

  it('parses a valid config file', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaults: {
          text: { provider: 'anthropic' },
          image: { provider: 'cloudflare', model: '@cf/black-forest-labs/flux-1-schnell' },
        },
      }),
    );

    const result = await readMarmotConfig(env);
    expect(result?.defaults?.text?.provider).toBe('anthropic');
    expect(result?.defaults?.image?.provider).toBe('cloudflare');
    expect(result?.defaults?.image?.model).toBe('@cf/black-forest-labs/flux-1-schnell');
  });

  it('rejects malformed JSON', async () => {
    const { env, dir } = await fixture();
    await writeFile(join(dir, 'config.json'), '{ not json');
    await expect(readMarmotConfig(env)).rejects.toThrowError(/invalid JSON/);
  });

  it('rejects an invalid provider slug', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaults: { text: { provider: 'not-a-real-provider' } },
      }),
    );
    await expect(readMarmotConfig(env)).rejects.toThrowError(
      /did not match the expected schema/,
    );
  });

  it('rejects an unsupported version', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ version: 99 }),
    );
    await expect(readMarmotConfig(env)).rejects.toThrowError(/expected schema/);
  });

  it('rejects unknown top-level keys', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, mystery: 'no' }),
    );
    await expect(readMarmotConfig(env)).rejects.toThrowError(/expected schema/);
  });
});

describe('writeMarmotConfig', () => {
  it('writes and round-trips through readMarmotConfig', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      {
        version: 1,
        defaults: {
          image: { provider: 'vercel', model: 'openai/dall-e-3' },
        },
      },
      env,
    );
    const read = await readMarmotConfig(env);
    expect(read?.defaults?.image?.provider).toBe('vercel');
    expect(read?.defaults?.image?.model).toBe('openai/dall-e-3');
  });

  it('creates the parent directory if missing', async () => {
    const { env } = await fixture();
    const path = await writeMarmotConfig(
      { version: 1 },
      env,
    );
    expect(path).toMatch(/config\.json$/);
  });
});

describe('resolveTextDefaults', () => {
  it('throws when no config and no override (no hardcoded fallback)', () => {
    expect(() => resolveTextDefaults(null)).toThrowError(
      /No default provider for "text"/,
    );
  });

  it('uses config when no override', () => {
    const result = resolveTextDefaults({
      version: 1,
      defaults: { text: { provider: 'anthropic' } },
    });
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('honors a model from config without overriding the provider default', () => {
    const result = resolveTextDefaults({
      version: 1,
      defaults: { text: { provider: 'openai', model: 'gpt-4.1' } },
    });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4.1');
  });

  it('lets explicit override beat config', () => {
    const result = resolveTextDefaults(
      { version: 1, defaults: { text: { provider: 'anthropic' } } },
      { provider: 'openai' },
    );
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
  });
});

describe('resolveImageDefaults', () => {
  it('throws when no config and no override (no hardcoded fallback)', () => {
    expect(() => resolveImageDefaults(null)).toThrowError(
      /No default provider for "image"/,
    );
  });

  it('uses config when no override', () => {
    const result = resolveImageDefaults({
      version: 1,
      defaults: { image: { provider: 'cloudflare' } },
    });
    expect(result.provider).toBe('cloudflare');
    expect(result.model).toBe('@cf/black-forest-labs/flux-1-schnell');
  });

  it('lets explicit override beat config', () => {
    const result = resolveImageDefaults(
      { version: 1, defaults: { image: { provider: 'cloudflare' } } },
      { provider: 'vercel', model: 'openai/dall-e-3' },
    );
    expect(result.provider).toBe('vercel');
    expect(result.model).toBe('openai/dall-e-3');
  });
});

describe('resolveSpeechDefaults', () => {
  it('throws when no config and no override (no hardcoded fallback)', () => {
    expect(() => resolveSpeechDefaults(null)).toThrowError(
      /No default provider for "speech"/,
    );
  });

  it('uses configured voice + model', () => {
    const r = resolveSpeechDefaults({
      version: 1,
      defaults: {
        speech: { provider: 'openai', model: 'tts-1-hd', voice: 'nova' },
      },
    });
    expect(r.model).toBe('tts-1-hd');
    expect(r.voice).toBe('nova');
  });

  it('explicit override wins over config', () => {
    const r = resolveSpeechDefaults(
      {
        version: 1,
        defaults: { speech: { provider: 'cloudflare' } },
      },
      { provider: 'openai', voice: 'alloy' },
    );
    expect(r.provider).toBe('openai');
    expect(r.voice).toBe('alloy');
  });
});

describe('resolveTranscriptionDefaults', () => {
  it('throws when no config and no override (no hardcoded fallback)', () => {
    expect(() => resolveTranscriptionDefaults(null)).toThrowError(
      /No default provider for "transcription"/,
    );
  });

  it('uses configured provider+model', () => {
    const r = resolveTranscriptionDefaults({
      version: 1,
      defaults: {
        transcription: { provider: 'cloudflare', model: '@cf/openai/whisper' },
      },
    });
    expect(r.provider).toBe('cloudflare');
    expect(r.model).toBe('@cf/openai/whisper');
  });
});
