import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PRESET_NAME_REGEX,
  marmotConfigSchema,
  presetSchema,
} from '../src/schemas/config.js';
import {
  applyPreset,
  deletePreset,
  getPreset,
  listPresets,
  upsertPreset,
  validatePresetName,
} from '../src/lib/presets.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-presets-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

describe('PRESET_NAME_REGEX', () => {
  const valid = [
    'foo',
    'foo-bar',
    'foo_bar',
    'foo-bar_baz',
    'a',
    '123',
    'gpt-4o-mini',
    'deep_research',
    'a1-b2_c3',
  ];
  for (const name of valid) {
    it(`accepts "${name}"`, () => {
      expect(PRESET_NAME_REGEX.test(name)).toBe(true);
    });
  }

  const invalid = [
    '',
    '-foo',
    'foo-',
    '_foo',
    'foo_',
    'foo--bar',
    'foo__bar',
    'foo-_bar',
    'foo_-bar',
    'Foo',
    'foo.bar',
    'foo bar',
    'FOO',
    'foo/bar',
  ];
  for (const name of invalid) {
    it(`rejects "${name}"`, () => {
      expect(PRESET_NAME_REGEX.test(name)).toBe(false);
    });
  }
});

describe('validatePresetName', () => {
  it('throws AICliError on bad slug', () => {
    expect(() => validatePresetName('Bad-Name')).toThrowError(/lowercase/);
  });
  it('passes on valid slug', () => {
    expect(() => validatePresetName('my-prof_1')).not.toThrow();
  });
});

describe('presetSchema', () => {
  it('accepts a minimal text preset', () => {
    const r = presetSchema.safeParse({ mode: 'text' });
    expect(r.success).toBe(true);
  });

  it('accepts an image preset with all fields', () => {
    const r = presetSchema.safeParse({
      mode: 'image',
      provider: 'openai',
      model: 'gpt-image-1',
      size: '1024x1024',
      quality: 'high',
      style: 'vivid',
      n: 2,
      retries: 3,
      timeout: 60,
    });
    expect(r.success).toBe(true);
  });

  it('rejects a speech preset with image fields (strict)', () => {
    const r = presetSchema.safeParse({ mode: 'speech', size: '1024x1024' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown provider slugs', () => {
    const r = presetSchema.safeParse({ mode: 'text', provider: 'nope' });
    expect(r.success).toBe(false);
  });

  it('accepts a text preset with schema and sampling/reasoning fields', () => {
    const r = presetSchema.safeParse({
      mode: 'text',
      provider: 'openrouter',
      schema: '{"type":"object"}',
      schemaFile: '/tmp/schema.json',
      schemaModule: '/tmp/schema.ts',
      systemFile: '/tmp/system.txt',
      temperature: 0.2,
      maxTokens: 400,
      topP: 0.9,
      seed: 42,
      stop: ['###', 'END'],
      reasoning: 'high',
      providerOption: ['logprobs=true'],
      stream: false,
      json: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects topP outside 0–1', () => {
    const r = presetSchema.safeParse({ mode: 'text', topP: 1.5 });
    expect(r.success).toBe(false);
  });

  it('rejects unknown reasoning levels', () => {
    const r = presetSchema.safeParse({ mode: 'text', reasoning: 'extreme' });
    expect(r.success).toBe(false);
  });

  it('accepts an image preset with seed, negative, and providerOption', () => {
    const r = presetSchema.safeParse({
      mode: 'image',
      provider: 'cloudflare',
      seed: 7,
      negative: 'no text',
      providerOption: ['background=transparent'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a speech preset with instructions and providerOption', () => {
    const r = presetSchema.safeParse({
      mode: 'speech',
      voice: 'ash',
      instructions: 'cheerful, slow',
      providerOption: ['format_options=mp3-high'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts a transcription preset with prompt and providerOption', () => {
    const r = presetSchema.safeParse({
      mode: 'transcription',
      prompt: 'technical interview, names: Ada, Linus',
      providerOption: ['timestamp_granularities=word'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects schema field on a non-text preset (strict)', () => {
    const r = presetSchema.safeParse({ mode: 'image', schema: '{}' });
    expect(r.success).toBe(false);
  });

  it('accepts a minimal video preset', () => {
    const r = presetSchema.safeParse({ mode: 'video' });
    expect(r.success).toBe(true);
  });

  it('accepts a video preset with all fields', () => {
    const r = presetSchema.safeParse({
      mode: 'video',
      provider: 'openrouter',
      model: 'google/veo-3.1-lite',
      aspect: '16:9',
      resolution: '720p',
      duration: 4,
      fps: 24,
      audio: false,
      n: 1,
      seed: 42,
      providerOption: ['negativePrompt=blurry'],
      retries: 2,
      timeout: 600,
    });
    expect(r.success).toBe(true);
  });

  it('rejects video preset with non-positive duration', () => {
    const r = presetSchema.safeParse({ mode: 'video', duration: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects video field on a non-video preset (strict)', () => {
    const r = presetSchema.safeParse({ mode: 'image', aspect: '16:9' });
    expect(r.success).toBe(false);
  });

  // Web verb presets

  it('accepts a fully-populated search preset', () => {
    const r = presetSchema.safeParse({
      mode: 'search',
      provider: 'parallel',
      limit: 25,
      depth: 'deep',
      freshness: 'week',
      afterDate: '2026-01-01',
      beforeDate: '2026-12-31',
      includeDomains: 'linkedin.com,github.com',
      excludeDomains: 'spam.com',
      includeContent: true,
      retries: 2,
      timeout: 60,
    });
    expect(r.success).toBe(true);
  });

  it('rejects search preset with malformed afterDate', () => {
    const r = presetSchema.safeParse({
      mode: 'search',
      afterDate: '01/01/2026',
    });
    expect(r.success).toBe(false);
  });

  it('rejects search preset with non-positive limit', () => {
    const r = presetSchema.safeParse({ mode: 'search', limit: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects search preset with unknown depth tier', () => {
    const r = presetSchema.safeParse({ mode: 'search', depth: 'extreme' });
    expect(r.success).toBe(false);
  });

  it('rejects search preset with AI-mode field (strict)', () => {
    const r = presetSchema.safeParse({
      mode: 'search',
      temperature: 0.5,
    });
    expect(r.success).toBe(false);
  });

  it('rejects search preset with AI provider', () => {
    const r = presetSchema.safeParse({
      mode: 'search',
      provider: 'anthropic',
    });
    expect(r.success).toBe(false);
  });

  it('accepts a scrape preset', () => {
    const r = presetSchema.safeParse({
      mode: 'scrape',
      provider: 'firecrawl',
      format: 'markdown',
      query: 'pricing details',
      retries: 1,
      timeout: 90,
    });
    expect(r.success).toBe(true);
  });

  it('rejects scrape preset with unknown format', () => {
    const r = presetSchema.safeParse({ mode: 'scrape', format: 'docx' });
    expect(r.success).toBe(false);
  });

  it('accepts an answer preset', () => {
    const r = presetSchema.safeParse({
      mode: 'answer',
      provider: 'tavily',
      maxCitations: 8,
      includeSearch: true,
    });
    expect(r.success).toBe(true);
  });

  it('rejects answer preset with non-positive maxCitations', () => {
    const r = presetSchema.safeParse({ mode: 'answer', maxCitations: 0 });
    expect(r.success).toBe(false);
  });

  it('accepts a map preset', () => {
    const r = presetSchema.safeParse({
      mode: 'map',
      provider: 'firecrawl',
      search: 'docs',
      limit: 100,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a crawl preset', () => {
    const r = presetSchema.safeParse({
      mode: 'crawl',
      provider: 'firecrawl',
      maxPages: 50,
      maxDepth: 3,
      instructions: 'Focus on docs and pricing.',
      includePaths: '/docs/.*,/pricing',
      excludePaths: '/blog/.*',
      allowExternal: false,
    });
    expect(r.success).toBe(true);
  });

  it('rejects crawl preset with negative maxDepth', () => {
    const r = presetSchema.safeParse({ mode: 'crawl', maxDepth: -1 });
    expect(r.success).toBe(false);
  });

  it('accepts a research preset', () => {
    const r = presetSchema.safeParse({
      mode: 'research',
      provider: 'parallel',
      depth: 'deep',
      schemaFile: '/path/to/schema.json',
      instructions: 'Cite primary sources.',
      pollInterval: '5,10,30',
      maxWait: 1800,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a findall preset', () => {
    const r = presetSchema.safeParse({
      mode: 'findall',
      provider: 'parallel',
      limit: 100,
      schema: '{"type":"object"}',
      entityType: 'company',
      matchConditions: '[{"name":"sector","description":"fintech"}]',
    });
    expect(r.success).toBe(true);
  });

  // Data verb presets

  it('accepts an enrich preset', () => {
    const r = presetSchema.safeParse({
      mode: 'enrich',
      provider: 'pdl',
      type: 'person',
      minLikelihood: 8,
      require: 'email,linkedin',
      fields: 'email,linkedin,full_name',
    });
    expect(r.success).toBe(true);
  });

  it('rejects enrich preset with unknown type', () => {
    const r = presetSchema.safeParse({ mode: 'enrich', type: 'building' });
    expect(r.success).toBe(false);
  });

  it('rejects enrich preset with web provider', () => {
    const r = presetSchema.safeParse({ mode: 'enrich', provider: 'parallel' });
    expect(r.success).toBe(false);
  });

  it('accepts a lookup preset', () => {
    const r = presetSchema.safeParse({
      mode: 'lookup',
      provider: 'apollo',
      type: 'email',
      limit: 50,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a verify preset (minimal)', () => {
    const r = presetSchema.safeParse({
      mode: 'verify',
      provider: 'hunter',
    });
    expect(r.success).toBe(true);
  });

  it('rejects verify preset with random extra field (strict)', () => {
    const r = presetSchema.safeParse({
      mode: 'verify',
      provider: 'hunter',
      type: 'person',
    });
    expect(r.success).toBe(false);
  });

  it('rejects unknown mode discriminator', () => {
    const r = presetSchema.safeParse({ mode: 'unknown', provider: 'x' });
    expect(r.success).toBe(false);
  });
});

describe('marmotConfigSchema presets key validation', () => {
  it('rejects badly-named presets in the record', () => {
    const r = marmotConfigSchema.safeParse({
      version: 1,
      presets: { 'Bad-Name': { mode: 'text' } },
    });
    expect(r.success).toBe(false);
  });

  it('accepts well-named presets', () => {
    const r = marmotConfigSchema.safeParse({
      version: 1,
      presets: { 'good_name-1': { mode: 'text' } },
    });
    expect(r.success).toBe(true);
  });
});

describe('upsertPreset + getPreset + listPresets', () => {
  it('creates a preset and reads it back', async () => {
    const { env, dir } = await fixture();
    await upsertPreset(
      'deep-research',
      { mode: 'text', provider: 'anthropic', model: 'claude-opus-4-7' },
      {},
      env,
    );
    const back = await getPreset('deep-research', env);
    expect(back).toMatchObject({
      mode: 'text',
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });
    expect(back.preset_id).toMatch(/^[0-9a-f-]{36}$/);
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.presets['deep-research'].provider).toBe('anthropic');
    expect(onDisk.presets['deep-research'].preset_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses to overwrite without overwrite=true', async () => {
    const { env } = await fixture();
    await upsertPreset('p1', { mode: 'text' }, {}, env);
    await expect(
      upsertPreset('p1', { mode: 'text', provider: 'openai' }, {}, env),
    ).rejects.toThrowError(/already exists/);
  });

  it('overwrites with overwrite=true', async () => {
    const { env } = await fixture();
    await upsertPreset('p1', { mode: 'text', provider: 'anthropic' }, {}, env);
    await upsertPreset(
      'p1',
      { mode: 'text', provider: 'openai' },
      { overwrite: true },
      env,
    );
    const back = await getPreset('p1', env);
    expect(back.provider).toBe('openai');
  });

  it('rejects bad slug names', async () => {
    const { env } = await fixture();
    await expect(
      upsertPreset('Bad-Name', { mode: 'text' }, {}, env),
    ).rejects.toThrowError(/Invalid preset name/);
  });

  it('preserves defaults block when adding a preset', async () => {
    const { env, dir } = await fixture();
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        version: 1,
        defaults: { text: { provider: 'anthropic' } },
      }),
    );
    await upsertPreset('p1', { mode: 'text', provider: 'openai' }, {}, env);
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.defaults.text.provider).toBe('anthropic');
    expect(onDisk.presets.p1.provider).toBe('openai');
  });

  it('lists presets', async () => {
    const { env } = await fixture();
    await upsertPreset('a', { mode: 'text' }, {}, env);
    await upsertPreset('b', { mode: 'image' }, {}, env);
    const all = await listPresets(env);
    expect(Object.keys(all).sort()).toEqual(['a', 'b']);
  });

  it('returns empty when no config file exists', async () => {
    const { env } = await fixture();
    expect(await listPresets(env)).toEqual({});
  });

  it('getPreset throws on missing', async () => {
    const { env } = await fixture();
    await expect(getPreset('missing', env)).rejects.toThrowError(/not found/);
  });
});

describe('deletePreset', () => {
  it('removes an existing preset', async () => {
    const { env } = await fixture();
    await upsertPreset('p1', { mode: 'text' }, {}, env);
    const removed = await deletePreset('p1', env);
    expect(removed).toBe(true);
    expect(await listPresets(env)).toEqual({});
  });

  it('returns false when the preset does not exist', async () => {
    const { env } = await fixture();
    const removed = await deletePreset('p1', env);
    expect(removed).toBe(false);
  });

  it('rejects bad slug names', async () => {
    const { env } = await fixture();
    await expect(deletePreset('Bad-Name', env)).rejects.toThrowError(
      /Invalid preset name/,
    );
  });
});

describe('applyPreset', () => {
  it('fills only undefined option slots', () => {
    const merged = applyPreset(
      { mode: 'text', provider: 'anthropic', model: 'claude-opus-4-7' },
      { provider: undefined, model: 'override-model', other: 'x' },
    );
    expect(merged).toEqual({
      provider: 'anthropic',
      model: 'override-model',
      other: 'x',
    });
  });

  it('drops the mode discriminator', () => {
    const merged = applyPreset(
      { mode: 'text', provider: 'anthropic' },
      {} as Record<string, unknown>,
    );
    expect(merged).not.toHaveProperty('mode');
    expect(merged.provider).toBe('anthropic');
  });

  it('does not overwrite an explicit value (even falsy ones like empty string)', () => {
    const merged = applyPreset(
      { mode: 'text', system: 'preset-system' },
      { system: '' },
    );
    expect(merged.system).toBe('');
  });

  it('skips undefined preset fields', () => {
    const merged = applyPreset(
      { mode: 'text', provider: 'anthropic' },
      { provider: undefined, model: undefined },
    );
    expect(merged.provider).toBe('anthropic');
    expect(merged.model).toBeUndefined();
  });
});
