import { describe, expect, it } from 'vitest';

import { getOllamaApiBaseUrl, getProviderApiKey } from '../src/lib/env.js';

describe('getProviderApiKey', () => {
  it('reads OPENROUTER_API_KEY for openrouter', () => {
    expect(
      getProviderApiKey('openrouter', undefined, { OPENROUTER_API_KEY: 'or-key' }),
    ).toBe('or-key');
  });

  it('reads ANTHROPIC_API_KEY for anthropic', () => {
    expect(
      getProviderApiKey('anthropic', undefined, { ANTHROPIC_API_KEY: 'an-key' }),
    ).toBe('an-key');
  });

  it('reads OPENAI_API_KEY for openai', () => {
    expect(
      getProviderApiKey('openai', undefined, { OPENAI_API_KEY: 'oa-key' }),
    ).toBe('oa-key');
  });

  it('returns undefined for ollama (no api key)', () => {
    expect(
      getProviderApiKey('ollama', undefined, { OPENROUTER_API_KEY: 'ignored' }),
    ).toBeUndefined();
  });

  it('prefers the cli key over the env var', () => {
    expect(
      getProviderApiKey('anthropic', 'cli-key', { ANTHROPIC_API_KEY: 'env-key' }),
    ).toBe('cli-key');
  });

  it('trims whitespace and treats blank as missing', () => {
    expect(
      getProviderApiKey('openai', '   ', { OPENAI_API_KEY: '   ' }),
    ).toBeUndefined();
  });
});

describe('getOllamaApiBaseUrl', () => {
  it('falls back to the default when OLLAMA_HOST is unset', () => {
    expect(getOllamaApiBaseUrl({})).toBe('http://localhost:11434/api');
  });

  it('appends /api when missing', () => {
    expect(getOllamaApiBaseUrl({ OLLAMA_HOST: 'http://localhost:11434' })).toBe(
      'http://localhost:11434/api',
    );
  });

  it('preserves /api when already present', () => {
    expect(
      getOllamaApiBaseUrl({ OLLAMA_HOST: 'http://localhost:11434/api' }),
    ).toBe('http://localhost:11434/api');
  });

  it('strips trailing slashes', () => {
    expect(
      getOllamaApiBaseUrl({ OLLAMA_HOST: 'http://localhost:11434///' }),
    ).toBe('http://localhost:11434/api');
  });

  it('accepts https://', () => {
    expect(getOllamaApiBaseUrl({ OLLAMA_HOST: 'https://ollama.example.com' })).toBe(
      'https://ollama.example.com/api',
    );
  });

  it('rejects file:// scheme', () => {
    expect(() =>
      getOllamaApiBaseUrl({ OLLAMA_HOST: 'file:///etc/passwd' }),
    ).toThrowError(/must use http:\/\/ or https:\/\//);
  });

  it('rejects gopher:// scheme', () => {
    expect(() =>
      getOllamaApiBaseUrl({ OLLAMA_HOST: 'gopher://attacker.example.com' }),
    ).toThrowError(/must use http:\/\/ or https:\/\//);
  });

  it('rejects malformed URLs', () => {
    expect(() =>
      getOllamaApiBaseUrl({ OLLAMA_HOST: 'not a url at all' }),
    ).toThrowError(/not a valid URL/);
  });

  it('rejects bare host:port without scheme', () => {
    expect(() =>
      getOllamaApiBaseUrl({ OLLAMA_HOST: 'localhost:11434' }),
    ).toThrowError(/must use http:\/\/ or https:\/\//);
  });
});
