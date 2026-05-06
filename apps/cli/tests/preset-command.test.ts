import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  handlePresetCreate,
  handlePresetDelete,
  handlePresetList,
  handlePresetShow,
  handlePresetUpdate,
} from '../src/commands/preset/index.js';
import { expandPresetSigil } from '../src/cli.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-preset-cmd-'));
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

describe('preset create', () => {
  it('creates a text preset via flags', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    await handlePresetCreate(
      'deep_research',
      { mode: 'text', provider: 'anthropic', model: 'claude-opus-4-7', system: 'be terse' },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.ok).toBe(true);
    expect(out.preset.system).toBe('be terse');

    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.presets.deep_research.provider).toBe('anthropic');
  });

  it('creates an image preset with numeric coercion', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handlePresetCreate(
      'square',
      { mode: 'image', provider: 'openai', size: '1024x1024', n: '4', retries: '2' },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.preset.n).toBe(4);
    expect(out.preset.retries).toBe(2);
  });

  it('rejects invalid name', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetCreate('Bad-Name', { mode: 'text' }, { env }),
    ).rejects.toThrowError(/Invalid preset name/);
  });

  it('rejects unknown mode', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetCreate('p1', { mode: 'banana' }, { env }),
    ).rejects.toThrowError(/Unknown mode/);
  });

  it('rejects missing mode', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetCreate('p1', {}, { env }),
    ).rejects.toThrowError(/--mode is required/);
  });

  it('rejects duplicate without overwrite', async () => {
    const { env } = await fixture();
    await handlePresetCreate('p1', { mode: 'text' }, { env });
    await expect(
      handlePresetCreate('p1', { mode: 'text' }, { env }),
    ).rejects.toThrowError(/already exists/);
  });

  it('rejects non-numeric --n', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetCreate('p1', { mode: 'image', n: 'abc' }, { env }),
    ).rejects.toThrowError(/--n must be an integer/);
  });
});

describe('preset update', () => {
  it('patches a single field, leaves others intact', async () => {
    const { env } = await fixture();
    await handlePresetCreate(
      'p1',
      { mode: 'text', provider: 'anthropic', model: 'claude-opus-4-7' },
      { env },
    );
    const cap = captureStdout();
    await handlePresetUpdate('p1', { provider: 'openai' }, { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.preset.provider).toBe('openai');
    expect(out.preset.model).toBe('claude-opus-4-7');
  });

  it('refuses to change mode', async () => {
    const { env } = await fixture();
    await handlePresetCreate('p1', { mode: 'text' }, { env });
    await expect(
      handlePresetUpdate('p1', { mode: 'image' }, { env }),
    ).rejects.toThrowError(/Cannot change mode/);
  });

  it('throws when preset does not exist', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetUpdate('missing', { provider: 'openai' }, { env }),
    ).rejects.toThrowError(/not found/);
  });
});

describe('preset delete', () => {
  it('removes an existing preset', async () => {
    const { env } = await fixture();
    await handlePresetCreate('p1', { mode: 'text' }, { env });
    const cap = captureStdout();
    await handlePresetDelete('p1', { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).removed).toBe(true);
  });

  it('reports removed=false for missing presets', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handlePresetDelete('missing', { env, stdout: cap.writer });
    expect(JSON.parse(cap.text).removed).toBe(false);
  });
});

describe('preset list + show', () => {
  it('lists presets sorted by name with summary fields', async () => {
    const { env } = await fixture();
    await handlePresetCreate('zeta', { mode: 'image', provider: 'openai' }, { env });
    await handlePresetCreate('alpha', { mode: 'text', provider: 'anthropic', model: 'm1' }, { env });
    const cap = captureStdout();
    await handlePresetList({ env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.presets.map((p: { name: string }) => p.name)).toEqual(['alpha', 'zeta']);
    expect(out.presets[0]).toEqual({
      name: 'alpha',
      mode: 'text',
      provider: 'anthropic',
      model: 'm1',
    });
  });

  it('shows full settings for one preset', async () => {
    const { env } = await fixture();
    await handlePresetCreate(
      'p1',
      { mode: 'speech', provider: 'openai', voice: 'alloy', speed: '1.2' },
      { env },
    );
    const cap = captureStdout();
    await handlePresetShow('p1', { env, stdout: cap.writer });
    const out = JSON.parse(cap.text);
    expect(out.preset.voice).toBe('alloy');
    expect(out.preset.speed).toBe(1.2);
  });
});

describe('expandPresetSigil', () => {
  it('rewrites @name into --preset name', () => {
    const out = expandPresetSigil(['node', 'marmot', '@deep-research', 'hello world']);
    expect(out).toEqual(['node', 'marmot', '--preset', 'deep-research', 'hello world']);
  });

  it('only consumes the first @name token', () => {
    const out = expandPresetSigil(['node', 'marmot', '@first', '@second']);
    expect(out).toEqual(['node', 'marmot', '--preset', 'first', '@second']);
  });

  it('leaves invalid slugs alone (e.g. @User-Bad)', () => {
    const out = expandPresetSigil(['node', 'marmot', 'run', '@User-Bad', 'prompt']);
    expect(out).toEqual(['node', 'marmot', 'run', '@User-Bad', 'prompt']);
  });

  it('does not rewrite when --preset is already present', () => {
    const out = expandPresetSigil(['node', 'marmot', '--preset', 'a', '@b']);
    expect(out).toEqual(['node', 'marmot', '--preset', 'a', '@b']);
  });

  it('does not rewrite when --preset=name is already present', () => {
    const out = expandPresetSigil(['node', 'marmot', '--preset=a', '@b']);
    expect(out).toEqual(['node', 'marmot', '--preset=a', '@b']);
  });

  it('handles bare @ (too short) by ignoring it', () => {
    const out = expandPresetSigil(['node', 'marmot', '@']);
    expect(out).toEqual(['node', 'marmot', '@']);
  });

  it('works on subcommand verbs (image, speak, etc.)', () => {
    const out = expandPresetSigil(['node', 'marmot', 'image', '@square_1024', 'a marmot']);
    expect(out).toEqual(['node', 'marmot', 'image', '--preset', 'square_1024', 'a marmot']);
  });
});
