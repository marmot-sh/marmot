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
    expect(back).toEqual({
      mode: 'text',
      provider: 'anthropic',
      model: 'claude-opus-4-7',
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.presets['deep-research'].provider).toBe('anthropic');
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
