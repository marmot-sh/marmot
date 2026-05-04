import { describe, expect, it } from 'vitest';

import { type MarmotConfig } from '@marmot-sh/core';

import { formatProviderStatusReport } from '../src/commands/setup-provider-settings.js';

const baseConfig: MarmotConfig = { version: 1 };

describe('formatProviderStatusReport', () => {
  it('groups providers by [ai] / [web] / [data] sections', () => {
    const env = {
      OPENROUTER_API_KEY: 'k',
      TAVILY_API_KEY: 'k',
      APOLLO_API_KEY: 'k',
    };
    const report = formatProviderStatusReport(baseConfig, env);
    expect(report).toMatch(/\[ai\]/);
    expect(report).toMatch(/\[web\]/);
    expect(report).toMatch(/\[data\]/);
  });

  it('marks providers with credentials as ✓ and others as ·', () => {
    const env = { TAVILY_API_KEY: 'k' };
    const report = formatProviderStatusReport(baseConfig, env);
    expect(report).toMatch(/✓ Tavily/);
    expect(report).toMatch(/· Apollo/);
  });

  it('marks providers with enabled=false as ⏸', () => {
    const env = { TAVILY_API_KEY: 'k' };
    const config: MarmotConfig = {
      version: 1,
      providers: { tavily: { enabled: false } },
    };
    const report = formatProviderStatusReport(config, env);
    expect(report).toMatch(/⏸ Tavily/);
    expect(report).toMatch(/paused/);
  });

  it('shows cache TTL when caching is enabled', () => {
    const env = { TAVILY_API_KEY: 'k' };
    const config: MarmotConfig = {
      version: 1,
      providers: { tavily: { cache: { enabled: true, ttlDays: 14 } } },
    };
    const report = formatProviderStatusReport(config, env);
    expect(report).toMatch(/Tavily.*cache 14d/);
  });

  it('honors custom apiKeyEnvVar in detection', () => {
    const env = { MY_TAVILY_KEY: 'k' };
    const config: MarmotConfig = {
      version: 1,
      providers: { tavily: { apiKeyEnvVar: 'MY_TAVILY_KEY' } },
    };
    const report = formatProviderStatusReport(config, env);
    expect(report).toMatch(/✓ Tavily/);
  });

  it('shows Ollama as ✓ even without an env var (no key needed)', () => {
    const report = formatProviderStatusReport(baseConfig, {});
    expect(report).toMatch(/✓ Ollama/);
  });
});
