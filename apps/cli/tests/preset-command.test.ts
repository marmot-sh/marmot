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

  it('creates a search preset with domain filters and dates', async () => {
    const { env, dir } = await fixture();
    const cap = captureStdout();
    await handlePresetCreate(
      'linkedin-people',
      {
        mode: 'search',
        provider: 'parallel',
        limit: '25',
        depth: 'deep',
        includeDomains: 'linkedin.com',
        afterDate: '2026-01-01',
        retries: '2',
      },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.preset).toMatchObject({
      mode: 'search',
      provider: 'parallel',
      limit: 25,
      depth: 'deep',
      includeDomains: 'linkedin.com',
      afterDate: '2026-01-01',
      retries: 2,
    });
    const onDisk = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'));
    expect(onDisk.presets['linkedin-people'].includeDomains).toBe('linkedin.com');
  });

  it('rejects search preset with malformed afterDate', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetCreate(
        'p1',
        { mode: 'search', afterDate: '01/01/2026' },
        { env },
      ),
    ).rejects.toThrowError(/Invalid preset/);
  });

  it('creates a research preset with schema-file and poll cadence', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handlePresetCreate(
      'deep-research',
      {
        mode: 'research',
        provider: 'parallel',
        depth: 'deep',
        schemaFile: '/tmp/schema.json',
        instructions: 'Cite primary sources.',
        pollInterval: '5,10,30',
        maxWait: '1800',
      },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.preset.depth).toBe('deep');
    expect(out.preset.pollInterval).toBe('5,10,30');
    expect(out.preset.maxWait).toBe(1800);
  });

  it('creates an enrich preset with type, likelihood, and field controls', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handlePresetCreate(
      'enrich-people-pdl',
      {
        mode: 'enrich',
        provider: 'pdl',
        type: 'person',
        minLikelihood: '8',
        require: 'email,linkedin',
        fields: 'email,linkedin,full_name',
      },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.preset).toMatchObject({
      mode: 'enrich',
      provider: 'pdl',
      type: 'person',
      minLikelihood: 8,
      require: 'email,linkedin',
      fields: 'email,linkedin,full_name',
    });
  });

  it('rejects enrich preset with web provider', async () => {
    const { env } = await fixture();
    await expect(
      handlePresetCreate(
        'p1',
        { mode: 'enrich', provider: 'parallel' },
        { env },
      ),
    ).rejects.toThrowError(/Invalid preset/);
  });

  it('creates a verify preset (minimal)', async () => {
    const { env } = await fixture();
    const cap = captureStdout();
    await handlePresetCreate(
      'verify-hunter',
      { mode: 'verify', provider: 'hunter', retries: '1' },
      { env, stdout: cap.writer },
    );
    const out = JSON.parse(cap.text);
    expect(out.preset).toMatchObject({
      mode: 'verify',
      provider: 'hunter',
      retries: 1,
    });
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
    // No verb injection when preset can't be resolved (lookup returns null).
    const out = expandPresetSigil(
      ['node', 'marmot', '@deep-research', 'hello world'],
      () => null,
    );
    expect(out).toEqual(['node', 'marmot', '--preset', 'deep-research', 'hello world']);
  });

  it('only consumes the first @name token', () => {
    const out = expandPresetSigil(['node', 'marmot', '@first', '@second'], () => null);
    expect(out).toEqual(['node', 'marmot', '--preset', 'first', '@second']);
  });

  it('leaves invalid slugs alone (e.g. @User-Bad)', () => {
    const out = expandPresetSigil(
      ['node', 'marmot', 'run', '@User-Bad', 'prompt'],
      () => null,
    );
    expect(out).toEqual(['node', 'marmot', 'run', '@User-Bad', 'prompt']);
  });

  it('does not rewrite when --preset is already present', () => {
    const out = expandPresetSigil(['node', 'marmot', '--preset', 'a', '@b'], () => null);
    expect(out).toEqual(['node', 'marmot', '--preset', 'a', '@b']);
  });

  it('does not rewrite when --preset=name is already present', () => {
    const out = expandPresetSigil(['node', 'marmot', '--preset=a', '@b'], () => null);
    expect(out).toEqual(['node', 'marmot', '--preset=a', '@b']);
  });

  it('handles bare @ (too short) by ignoring it', () => {
    const out = expandPresetSigil(['node', 'marmot', '@'], () => null);
    expect(out).toEqual(['node', 'marmot', '@']);
  });

  it('preserves an explicit verb when given (image @square_1024 …)', () => {
    const out = expandPresetSigil(
      ['node', 'marmot', 'image', '@square_1024', 'a marmot'],
      () => 'image',
    );
    expect(out).toEqual(['node', 'marmot', 'image', '--preset', 'square_1024', 'a marmot']);
  });

  // 0.4.7: verb-routing for @name at argv[2] (no explicit verb)

  it('injects search verb when sigil is at argv[2] and preset mode is search', () => {
    const out = expandPresetSigil(
      ['node', 'marmot', '@linkedin', 'Daniel Francis Abel Police'],
      (name) => (name === 'linkedin' ? 'search' : null),
    );
    expect(out).toEqual([
      'node',
      'marmot',
      'search',
      '--preset',
      'linkedin',
      'Daniel Francis Abel Police',
    ]);
  });

  it('injects research verb for research-mode preset', () => {
    const out = expandPresetSigil(
      ['node', 'marmot', '@deep-fintech', 'stripe vs adyen'],
      () => 'research',
    );
    expect(out).toEqual([
      'node',
      'marmot',
      'research',
      '--preset',
      'deep-fintech',
      'stripe vs adyen',
    ]);
  });

  it('injects speak verb for speech-mode preset', () => {
    const out = expandPresetSigil(['node', 'marmot', '@my-voice', 'hello'], () => 'speech');
    expect(out).toEqual(['node', 'marmot', 'speak', '--preset', 'my-voice', 'hello']);
  });

  it('injects transcribe verb for transcription-mode preset', () => {
    const out = expandPresetSigil(
      ['node', 'marmot', '@my-stt', './audio.wav'],
      () => 'transcription',
    );
    expect(out).toEqual([
      'node',
      'marmot',
      'transcribe',
      '--preset',
      'my-stt',
      './audio.wav',
    ]);
  });

  it('does not inject a verb for text-mode preset (default run)', () => {
    const out = expandPresetSigil(['node', 'marmot', '@summarizer', 'a body of text'], () => 'text');
    expect(out).toEqual([
      'node',
      'marmot',
      '--preset',
      'summarizer',
      'a body of text',
    ]);
  });

  it('does not inject when preset cannot be resolved', () => {
    const out = expandPresetSigil(['node', 'marmot', '@missing', 'q'], () => null);
    expect(out).toEqual(['node', 'marmot', '--preset', 'missing', 'q']);
  });

  it('does not inject when sigil is not at argv[2] (explicit verb already wins)', () => {
    // User typed `marmot scrape @some-search-preset url` — explicit verb is
    // honored, no injection. The mode-mismatch error surfaces later.
    const out = expandPresetSigil(
      ['node', 'marmot', 'scrape', '@some-search', 'https://example.com'],
      () => 'search',
    );
    expect(out).toEqual([
      'node',
      'marmot',
      'scrape',
      '--preset',
      'some-search',
      'https://example.com',
    ]);
  });

  it('injects enrich verb for enrich-mode preset', () => {
    const out = expandPresetSigil(
      ['node', 'marmot', '@enrich-pdl', '--email', 'a@b.com'],
      () => 'enrich',
    );
    expect(out).toEqual([
      'node',
      'marmot',
      'enrich',
      '--preset',
      'enrich-pdl',
      '--email',
      'a@b.com',
    ]);
  });
});
