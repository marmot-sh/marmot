import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  handleConfigGet,
  handleConfigInit,
  handleConfigPath,
  handleConfigSet,
  handleConfigShow,
  handleConfigUnset,
} from '../src/commands/config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-cfg-cmd-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
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

describe('config show', () => {
  it('returns version=1 with no defaults when no config file exists', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleConfigShow({ json: true }, { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.version).toBe(1);
  });

  it('returns the parsed config when a file exists', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaults: { image: { provider: 'cloudflare' } },
      }),
    );
    const cap = captureStdout();
    await handleConfigShow({ json: true }, { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.defaults.image.provider).toBe('cloudflare');
  });
});

describe('config path', () => {
  it('prints the config file path', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    handleConfigPath({ env, stdout: cap.writer });
    expect(cap.text.trim()).toBe(join(dir, 'config.json'));
  });
});

describe('config init', () => {
  it('writes an empty config when missing', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    await handleConfigInit({}, { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.alreadyExists).toBe(false);

    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.version).toBe(1);
    expect(onDisk.defaults).toBeDefined();
  });

  it('overwrites a malformed file with --force', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      '{ "version": 99, "stale": true }',
    );
    const cap = captureStdout();
    await handleConfigInit({ force: true }, { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.alreadyExists).toBe(false);
    expect(parsed.overwrote).toBe(true);

    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.version).toBe(1);
    expect(onDisk.stale).toBeUndefined();
  });

  it('without --force, refuses to overwrite even a malformed file', async () => {
    const { env, dir } = await fixture();
    await writeFile(join(dir, 'config.json'), '{ "version": 99 }');
    const cap = captureStdout();
    await handleConfigInit({}, { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.alreadyExists).toBe(true);
    expect(parsed.hint).toMatch(/--force/);
  });

  it('does not overwrite an existing config', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ version: 1, defaults: { text: { provider: 'anthropic' } } }),
    );
    const cap = captureStdout();
    await handleConfigInit({}, { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.alreadyExists).toBe(true);

    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.defaults.text.provider).toBe('anthropic');
  });
});

describe('config set', () => {
  it('sets a fresh value (creating the file)', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    await handleConfigSet('image.provider', 'cloudflare', {
      env,
      stdout: cap.writer,
    });

    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.defaults.image.provider).toBe('cloudflare');
  });

  it('rejects an invalid provider slug at write time', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('image.provider', 'not-a-thing', { env }),
    ).rejects.toThrowError(/Cannot set image\.provider/);
  });

  it('rejects unknown config keys', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('text.foo', 'whatever', { env }),
    ).rejects.toThrowError(/Unknown config key/);
  });

  it('accepts speech.voice and transcription.provider', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet('speech.provider', 'openai', { env });
    await handleConfigSet('speech.voice', 'alloy', { env });
    await handleConfigSet('transcription.provider', 'cloudflare', { env });
    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.defaults.speech.voice).toBe('alloy');
    expect(onDisk.defaults.transcription.provider).toBe('cloudflare');
  });

  it('preserves existing keys when setting a new one', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaults: { text: { provider: 'anthropic' } },
      }),
    );

    await handleConfigSet('image.provider', 'openai', { env });

    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.defaults.text.provider).toBe('anthropic');
    expect(onDisk.defaults.image.provider).toBe('openai');
  });
});

describe('config unset', () => {
  it('removes a key from existing config', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaults: {
          text: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
        },
      }),
    );

    await handleConfigUnset('text.model', { env });

    const onDisk = JSON.parse(
      await readFile(join(dir, 'config.json'), 'utf8'),
    );
    expect(onDisk.defaults.text.provider).toBe('anthropic');
    expect(onDisk.defaults.text.model).toBeUndefined();
  });

  it('is a no-op when the file does not exist', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleConfigUnset('image.provider', { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed.removed).toBe(false);
  });

  it('rejects unknown config keys', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigUnset('mystery.key', { env }),
    ).rejects.toThrowError(/Unknown config key/);
  });
});

import { writeCached } from '@marmot-sh/core';

describe('handleConfigSet — extended key shapes', () => {
  it('accepts web verb defaults (search.provider)', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    await handleConfigSet('search.provider', 'tavily', { env, stdout: cap.writer });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.defaults.search.provider).toBe('tavily');
  });

  it('accepts data verb defaults (enrich.provider)', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet('enrich.provider', 'pdl', { env, stdout: captureStdout().writer });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.defaults.enrich.provider).toBe('pdl');
  });

  it('accepts providers.<slug>.cache.enabled with boolean coercion', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet('providers.tavily.cache.enabled', 'true', {
      env,
      stdout: captureStdout().writer,
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers.tavily.cache.enabled).toBe(true);
  });

  it('accepts providers.<slug>.cache.ttlDays with integer coercion', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet('providers.tavily.cache.ttlDays', '14', {
      env,
      stdout: captureStdout().writer,
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers.tavily.cache.ttlDays).toBe(14);
  });

  it('accepts providers.<slug>.apiKeyEnvVar', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet('providers.apollo.apiKeyEnvVar', 'MY_APOLLO_KEY', {
      env,
      stdout: captureStdout().writer,
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers.apollo.apiKeyEnvVar).toBe('MY_APOLLO_KEY');
  });

  it('rejects ttlDays = 0', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('providers.tavily.cache.ttlDays', '0', { env }),
    ).rejects.toThrow(/positive integer/);
  });

  it('rejects boolean value that is not "true" or "false"', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('providers.tavily.cache.enabled', 'yes', { env }),
    ).rejects.toThrow(/true or false/);
  });

  it('rejects unknown provider slug', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('providers.nonexistent.enabled', 'true', { env }),
    ).rejects.toThrow(/Unknown provider slug/);
  });

  it('rejects unknown provider setting suffix', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('providers.tavily.frobulate', 'true', { env }),
    ).rejects.toThrow(/Unknown provider setting/);
  });
});

describe('handleConfigUnset — extended key shapes', () => {
  it('removes providers.<slug>.cache.enabled and prunes empty parents', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet('providers.tavily.cache.enabled', 'true', {
      env,
      stdout: captureStdout().writer,
    });
    await handleConfigUnset('providers.tavily.cache.enabled', {
      env,
      stdout: captureStdout().writer,
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers).toBeUndefined();
  });
});

describe('handleConfigSet — pricing overrides', () => {
  it('sets providers.<slug>.pricing.<modelId>.<field> as a string value', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet(
      'providers.openai.pricing.gpt-4o.prompt',
      '0.0000025',
      { env, stdout: captureStdout().writer },
    );
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers.openai.pricing['gpt-4o'].prompt).toBe('0.0000025');
  });

  it('preserves model ids that contain dots (e.g. gpt-4.1)', async () => {
    const { env, dir } = await fixture();
    await handleConfigSet(
      'providers.openai.pricing.gpt-4.1.completion',
      '0.00001',
      { env, stdout: captureStdout().writer },
    );
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers.openai.pricing['gpt-4.1'].completion).toBe('0.00001');
  });

  it('rejects an invalid pricing field', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet(
        'providers.openai.pricing.gpt-4o.frobulate',
        '0.001',
        { env },
      ),
    ).rejects.toThrow(/Pricing field "frobulate" is invalid/);
  });

  it('rejects pricing key with no <field> suffix', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigSet('providers.openai.pricing.prompt', '0.001', { env }),
    ).rejects.toThrow(/must end in one of prompt\|completion/);
  });

  it('unset removes a single pricing field and prunes empty parents', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    await handleConfigSet(
      'providers.openai.pricing.gpt-4o.prompt',
      '0.0000025',
      { env, stdout: cap.writer },
    );
    await handleConfigUnset(
      'providers.openai.pricing.gpt-4o.prompt',
      { env, stdout: cap.writer },
    );
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.providers).toBeUndefined();
  });
});

describe('handleConfigShow — cache section', () => {
  it('shows "(empty)" cache when nothing is cached', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handleConfigShow({}, { env, stdout: cap.writer });
    expect(cap.text).toMatch(/Response cache:[\s\S]*\(empty\)/);
  });

  it('shows total entries and bytes when cache has entries', async () => {
    const { env } = await fixture();
    await writeCached('parallel', { verb: 'search', input: { q: 'x' } }, {}, 60, { env });
    await writeCached('exa', { verb: 'search', input: { q: 'y' } }, {}, 60, { env });
    const cap = captureStdout();
    await handleConfigShow({}, { env, stdout: cap.writer });
    expect(cap.text).toMatch(/Response cache:/);
    expect(cap.text).toMatch(/total: 2 entries/);
    expect(cap.text).toMatch(/parallel/);
    expect(cap.text).toMatch(/exa/);
  });

  it('--json includes cache totals and per-provider stats', async () => {
    const { env } = await fixture();
    await writeCached('parallel', { verb: 'search', input: { q: 'x' } }, {}, 60, { env });
    const cap = captureStdout();
    await handleConfigShow({ json: true }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.cache.totals.entries).toBe(1);
    expect(out.cache.providers).toHaveLength(1);
    expect(out.cache.providers[0].provider).toBe('parallel');
  });
});

describe('config get', () => {
  it('prints a string value bare', async () => {
    const { env } = await fixture();
    await handleConfigSet('text.provider', 'openrouter', { env });
    const cap = captureStdout();
    await handleConfigGet('text.provider', { env, stdout: cap.writer });
    expect(cap.text.trim()).toBe('openrouter');
  });

  it('prints a boolean value bare', async () => {
    const { env } = await fixture();
    await handleConfigSet('logging.recordSensitive', 'false', { env });
    const cap = captureStdout();
    await handleConfigGet('logging.recordSensitive', { env, stdout: cap.writer });
    expect(cap.text.trim()).toBe('false');
  });

  it('pretty-prints object values as JSON', async () => {
    const { env } = await fixture();
    await handleConfigSet('providers.openai.cache.enabled', 'true', { env });
    await handleConfigSet('providers.openai.cache.ttlDays', '30', { env });
    const cap = captureStdout();
    await handleConfigGet('providers.openai.cache', { env, stdout: cap.writer });
    const parsed = JSON.parse(cap.text);
    expect(parsed).toEqual({ enabled: true, ttlDays: 30 });
  });

  it('errors when the key is unset', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigGet('text.provider', { env }),
    ).rejects.toThrowError(/Key "text\.provider" is not set/);
  });

  it('errors when the key shape is invalid (same wording as set)', async () => {
    const { env } = await fixture();
    await expect(
      handleConfigGet('made.up.key', { env }),
    ).rejects.toThrowError(/Unknown config key/);
  });
});

describe('config set: AI-only cache no-op warning', () => {
  it('warns on stderr when cache.enabled=true is set for an AI-only provider', async () => {
    const { env } = await fixture();
    const stdout = captureStdout();
    const stderr = captureStdout();
    await handleConfigSet('providers.openrouter.cache.enabled', 'true', {
      env,
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(stderr.text).toContain('"openrouter" is an AI-only provider');
    expect(stderr.text).toContain('AI verbs never cache');
    // Setting still persists.
    const out = JSON.parse(stdout.text);
    expect(out.value).toBe(true);
  });

  it('does not warn for web/data providers', async () => {
    const { env } = await fixture();
    const stdout = captureStdout();
    const stderr = captureStdout();
    await handleConfigSet('providers.tavily.cache.enabled', 'true', {
      env,
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(stderr.text).not.toContain('AI-only');
  });

  it('does not warn when disabling cache (false) on an AI-only provider', async () => {
    const { env } = await fixture();
    const stdout = captureStdout();
    const stderr = captureStdout();
    await handleConfigSet('providers.openrouter.cache.enabled', 'false', {
      env,
      stdout: stdout.writer,
      stderr: stderr.writer,
    });
    expect(stderr.text).not.toContain('AI-only');
  });
});
