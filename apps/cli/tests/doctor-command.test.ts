import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeMarmotConfig } from '@marmot-sh/core';

import { handleDoctorCommand } from '../src/commands/doctor.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-doctor-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir } as NodeJS.ProcessEnv, dir };
}

function captureStdout() {
  const chunks: string[] = [];
  return {
    writer: {
      write(chunk: string | Buffer) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        return true;
      },
    },
    get text() {
      return chunks.join('');
    },
  };
}

describe('marmot doctor', () => {
  it('renders a verdict line at the end', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleDoctorCommand({}, { env, stdout: cap.writer });
    const lastLine = cap.text.trim().split('\n').pop()!;
    expect(lastLine).toMatch(/^(✓ Everything is in good order\.|⚠ \d+ issues? found\.)/);
  });

  it('reports "issues found" with a fix command when no providers are ready', async () => {
    const { env } = await fixture();
    // Force every provider off so readiness drops to 0 regardless of
    // whatever API keys are floating around in the host environment.
    await writeMarmotConfig(
      {
        version: 1,
        providers: {
          ollama: { enabled: false },
          openai: { enabled: false },
          anthropic: { enabled: false },
          openrouter: { enabled: false },
          vercel: { enabled: false },
          cloudflare: { enabled: false },
          brave: { enabled: false },
          exa: { enabled: false },
          firecrawl: { enabled: false },
          parallel: { enabled: false },
          tavily: { enabled: false },
          datagma: { enabled: false },
          hunter: { enabled: false },
          tomba: { enabled: false },
          apollo: { enabled: false },
          pdl: { enabled: false },
          kickbox: { enabled: false },
          zerobounce: { enabled: false },
          bouncer: { enabled: false },
        },
      },
      env,
    );
    const cap = captureStdout();
    await handleDoctorCommand({}, { env, stdout: cap.writer });
    expect(cap.text).toMatch(/⚠ \d+ issues? found\./);
    expect(cap.text).toContain('marmot providers list --check-keys');
  });

  it('JSON envelope carries verdict, issues_found, and per-check fix_suggestion', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, providers: { ollama: { enabled: false } } },
      env,
    );
    const cap = captureStdout();
    await handleDoctorCommand({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out).toHaveProperty('verdict');
    expect(out).toHaveProperty('issues_found');
    expect(out.checks).toBeInstanceOf(Array);
    const providersCheck = (out.checks as Array<{ name: string; fix_suggestion?: { command?: string } }>).find(
      (c) => c.name === 'providers',
    );
    expect(providersCheck?.fix_suggestion?.command).toBe('marmot providers list --check-keys');
  });

  it('reports "config readable" with a fix_suggestion when the config file is corrupt', async () => {
    const { env, dir } = await fixture();
    await writeFile(join(dir, 'config.json'), '{ this is not json', 'utf8');
    const cap = captureStdout();
    await handleDoctorCommand({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    const configCheck = (out.checks as Array<{ name: string; level: string; fix_suggestion?: { command?: string } }>).find(
      (c) => c.name === 'config readable',
    );
    expect(configCheck?.level).toBe('error');
    expect(configCheck?.fix_suggestion?.command).toBe('marmot config init --force');
    // Errors outrank warnings in the primary-fix selection: verdict
    // should suggest the config init command, not provider diagnostics.
    expect(out.verdict).toContain('marmot config init --force');
  });

  it('--fix writes a default config when the file is missing', async () => {
    const { env, dir } = await fixture();
    const configPath = join(dir, 'config.json');
    await expect(stat(configPath)).rejects.toThrow();

    const cap = captureStdout();
    await handleDoctorCommand({ fix: true, json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);

    // Config file now exists.
    await expect(stat(configPath)).resolves.toBeTruthy();
    expect(out.fixes_applied).toEqual(
      expect.arrayContaining([expect.stringMatching(/wrote default config/)]),
    );
  });

  it('surfaces no-op cache settings on AI-only providers', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      {
        version: 1,
        providers: {
          openrouter: { cache: { enabled: true, ttlDays: 7 } },
        },
      },
      env,
    );
    const cap = captureStdout();
    await handleDoctorCommand({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    const cacheCheck = (out.checks as Array<{ name: string; level: string; detail: string }>).find(
      (c) => c.name === 'cache settings',
    );
    expect(cacheCheck).toBeDefined();
    expect(cacheCheck?.level).toBe('info');
    expect(cacheCheck?.detail).toContain('openrouter');
    expect(cacheCheck?.detail).toContain('AI verbs never cache');
  });

  it('--fix is a no-op when the config already exists and the usage dir is small', async () => {
    const { env } = await fixture();
    await writeMarmotConfig({ version: 1, defaults: { text: {}, image: {} } }, env);

    const cap = captureStdout();
    await handleDoctorCommand({ fix: true, json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);

    expect(out.fixes_applied).toEqual([]);
  });
});
