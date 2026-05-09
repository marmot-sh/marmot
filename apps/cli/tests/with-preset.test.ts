import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { upsertPreset } from '@marmot-sh/core';
import { withPreset } from '../src/lib/with-preset.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-with-preset-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir } };
}

describe('withPreset for web/data verbs', () => {
  it('merges saved search preset fields into options when --preset is passed', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'linkedin-people',
      {
        mode: 'search',
        provider: 'parallel',
        limit: 25,
        includeDomains: 'linkedin.com',
        afterDate: '2026-01-01',
      },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'linkedin-people' } as { preset?: string; provider?: string },
      'search',
    );
    expect(merged).toMatchObject({
      provider: 'parallel',
      limit: 25,
      includeDomains: 'linkedin.com',
      afterDate: '2026-01-01',
    });
    // Mode discriminator should not leak into verb options.
    expect(merged).not.toHaveProperty('mode');
  });

  it('explicit flags win over preset values', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'p1',
      { mode: 'search', provider: 'parallel', limit: 25 },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'p1', provider: 'tavily', limit: 5 } as {
        preset?: string;
        provider?: string;
        limit?: number;
      },
      'search',
    );
    expect(merged.provider).toBe('tavily');
    expect(merged.limit).toBe(5);
  });

  it('rejects when preset mode does not match verb', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'aiprompt',
      { mode: 'text', provider: 'anthropic' },
      {},
      env,
    );

    await expect(
      withPreset({ preset: 'aiprompt' } as { preset?: string }, 'search'),
    ).rejects.toThrowError(/mode "text".*requires "search"/);
  });

  it('returns options unchanged when no preset is passed', async () => {
    const opts = { provider: 'parallel', limit: 10 };
    const merged = await withPreset(opts as { preset?: string; provider?: string }, 'search');
    expect(merged).toEqual(opts);
  });

  it('merges enrich preset for data verb', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'enrich-pdl',
      {
        mode: 'enrich',
        provider: 'pdl',
        type: 'person',
        minLikelihood: 8,
        require: 'email',
      },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'enrich-pdl' } as { preset?: string },
      'enrich',
    );
    expect(merged).toMatchObject({
      provider: 'pdl',
      type: 'person',
      minLikelihood: 8,
      require: 'email',
    });
  });
});

describe('withPreset merge rules for text mode', () => {
  it('concatenates preset and runtime system prompts with double newline', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'helpful-base',
      { mode: 'text', system: 'You are a helpful assistant.' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'helpful-base', system: 'Be terse.' } as {
        preset?: string;
        system?: string;
      },
      'text',
    );
    expect(merged.system).toBe('You are a helpful assistant.\n\nBe terse.');
  });

  it('appends preset file list before runtime --file paths', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'with-standards',
      { mode: 'text', file: ['./standards.md'] },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'with-standards', file: ['./code.ts'] } as {
        preset?: string;
        file?: string[];
      },
      'text',
    );
    expect(merged.file).toEqual(['./standards.md', './code.ts']);
  });

  it('appends preset stop sequences before runtime ones', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'with-stops',
      { mode: 'text', stop: ['```'] },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'with-stops', stop: ['###'] } as {
        preset?: string;
        stop?: string[];
      },
      'text',
    );
    expect(merged.stop).toEqual(['```', '###']);
  });

  it('runtime --no-stream (stream: false) overrides preset stream: true', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'streaming',
      { mode: 'text', stream: true },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'streaming', stream: false } as {
        preset?: string;
        stream?: boolean;
      },
      'text',
    );
    expect(merged.stream).toBe(false);
  });

  it('preset prompt fills options.prompt for handler-side concat with positional', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'translator',
      { mode: 'text', prompt: 'Translate to French:' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'translator' } as { preset?: string; prompt?: string },
      'text',
    );
    expect(merged.prompt).toBe('Translate to French:');
  });

  it('rejects preset with apiKey field (security exclusion via .strict())', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await expect(
      upsertPreset(
        'badpreset',
        { mode: 'text', apiKey: 'sk-leaked' } as never,
        {},
        env,
      ),
    ).rejects.toThrow();
  });
});

describe('withPreset merge rules for AI verbs (image / speak / transcribe / video)', () => {
  it('image preset prompt fills options.prompt for handler concat', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'oil-painting',
      { mode: 'image', provider: 'openai', prompt: 'in the style of Monet,' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'oil-painting' } as {
        preset?: string;
        prompt?: string;
        provider?: string;
      },
      'image',
    );
    expect(merged.prompt).toBe('in the style of Monet,');
    expect(merged.provider).toBe('openai');
  });

  it('image preset preview false + runtime --preview true → preview true', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'no-preview-default',
      { mode: 'image', provider: 'openai', preview: false },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'no-preview-default', preview: true } as {
        preset?: string;
        preview?: boolean;
      },
      'image',
    );
    expect(merged.preview).toBe(true);
  });

  it('speak preset text concatenates with runtime text via engine', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'tts-prefix',
      { mode: 'speech', provider: 'openai', text: 'Welcome.' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'tts-prefix', text: 'Take a seat.' } as {
        preset?: string;
        text?: string;
      },
      'speech',
    );
    expect(merged.text).toBe('Welcome.\n\nTake a seat.');
  });

  it('transcribe preset audio fills options.audio for positional fallback', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'recording',
      { mode: 'transcription', provider: 'openai', audio: '~/calls/today.mp3' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'recording' } as { preset?: string; audio?: string },
      'transcription',
    );
    expect(merged.audio).toBe('~/calls/today.mp3');
  });

  it('transcribe preset prompt concatenates with runtime --prompt (Breaking change)', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'whisper-bias',
      { mode: 'transcription', provider: 'openai', prompt: 'Technical vocabulary:' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'whisper-bias', prompt: 'React, Vue, Angular.' } as {
        preset?: string;
        prompt?: string;
      },
      'transcription',
    );
    expect(merged.prompt).toBe('Technical vocabulary:\n\nReact, Vue, Angular.');
  });

  it('video preset image list appends with runtime --image paths', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'first-frame-fixed',
      { mode: 'video', provider: 'vercel', image: ['./brand.png'] },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'first-frame-fixed', image: ['./last.png'] } as {
        preset?: string;
        image?: string[];
      },
      'video',
    );
    expect(merged.image).toEqual(['./brand.png', './last.png']);
  });
});

describe('withPreset merge rules for web verbs', () => {
  it('search preset query concatenates with runtime --query (engine concat)', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'tech-search',
      { mode: 'search', provider: 'parallel', query: 'site:linkedin.com' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'tech-search', query: 'engineering manager' } as {
        preset?: string;
        query?: string;
      },
      'search',
    );
    expect(merged.query).toBe('site:linkedin.com\n\nengineering manager');
  });

  it('search preset cache: false, runtime --cache true → cache true', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'fresh-news',
      { mode: 'search', provider: 'tavily', cache: false },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'fresh-news', cache: true } as {
        preset?: string;
        cache?: boolean;
      },
      'search',
    );
    expect(merged.cache).toBe(true);
  });

  it('scrape preset urls list-appends with runtime urls', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'fixed-pages',
      { mode: 'scrape', provider: 'firecrawl', urls: ['https://a.com'] },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'fixed-pages', urls: ['https://b.com'] } as {
        preset?: string;
        urls?: string[];
      },
      'scrape',
    );
    expect(merged.urls).toEqual(['https://a.com', 'https://b.com']);
  });

  it('answer preset query concatenates and includeSearch overrides via --no-include-search', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'cited-answer',
      { mode: 'answer', provider: 'tavily', query: 'cite reputable sources for', includeSearch: true },
      {},
      env,
    );

    const merged = await withPreset(
      {
        preset: 'cited-answer',
        query: 'origins of XYZ',
        includeSearch: false,
      } as {
        preset?: string;
        query?: string;
        includeSearch?: boolean;
      },
      'answer',
    );
    expect(merged.query).toBe('cite reputable sources for\n\norigins of XYZ');
    expect(merged.includeSearch).toBe(false);
  });

  it('map preset url fills positional, runtime overrides', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'home-map',
      { mode: 'map', provider: 'firecrawl', url: 'https://example.com' },
      {},
      env,
    );

    const presetOnly = await withPreset(
      { preset: 'home-map' } as { preset?: string; url?: string },
      'map',
    );
    expect(presetOnly.url).toBe('https://example.com');

    const runtimeWins = await withPreset(
      { preset: 'home-map', url: 'https://other.com' } as {
        preset?: string;
        url?: string;
      },
      'map',
    );
    expect(runtimeWins.url).toBe('https://other.com');
  });

  it('crawl preset instructions concatenates with runtime --instructions (Breaking change)', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'docs-crawl',
      { mode: 'crawl', provider: 'tavily', instructions: 'Focus on technical content.' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'docs-crawl', instructions: 'Specifically about React 19.' } as {
        preset?: string;
        instructions?: string;
      },
      'crawl',
    );
    expect(merged.instructions).toBe('Focus on technical content.\n\nSpecifically about React 19.');
  });

  it('research preset instructions concatenates with runtime (Breaking change)', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'deep-fintech',
      { mode: 'research', provider: 'parallel', instructions: 'Cite authoritative sources.' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'deep-fintech', instructions: 'Compare YoY metrics.' } as {
        preset?: string;
        instructions?: string;
      },
      'research',
    );
    expect(merged.instructions).toBe('Cite authoritative sources.\n\nCompare YoY metrics.');
  });

  it('findall preset objective concatenates with runtime', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'engineers-list',
      { mode: 'findall', provider: 'parallel', objective: 'Senior engineers' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'engineers-list', objective: 'at YC startups' } as {
        preset?: string;
        objective?: string;
      },
      'findall',
    );
    expect(merged.objective).toBe('Senior engineers\n\nat YC startups');
  });
});

describe('withPreset merge rules for data verbs', () => {
  it('enrich preset can bake company; runtime adds firstName', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'enrich-acme',
      { mode: 'enrich', provider: 'pdl', type: 'person', company: 'acme.com' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'enrich-acme', firstName: 'Jane' } as {
        preset?: string;
        firstName?: string;
        company?: string;
      },
      'enrich',
    );
    expect(merged.company).toBe('acme.com');
    expect(merged.firstName).toBe('Jane');
  });

  it('enrich preset email is overridden by runtime --email (scalar replace)', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'enrich-default-email',
      { mode: 'enrich', provider: 'pdl', email: 'default@x.com' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'enrich-default-email', email: 'override@y.com' } as {
        preset?: string;
        email?: string;
      },
      'enrich',
    );
    expect(merged.email).toBe('override@y.com');
  });

  it('lookup preset with title + seniority is filled by preset; runtime can override scalars', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'lookup-eng-mgr',
      {
        mode: 'lookup',
        provider: 'apollo',
        type: 'person',
        title: 'Engineering Manager',
        seniority: 'manager',
      },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'lookup-eng-mgr', seniority: 'director' } as {
        preset?: string;
        title?: string;
        seniority?: string;
      },
      'lookup',
    );
    expect(merged.title).toBe('Engineering Manager');
    expect(merged.seniority).toBe('director');
  });

  it('verify preset email fills options.email for positional fallback', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'verify-default',
      { mode: 'verify', provider: 'hunter', email: 'team@example.com' },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'verify-default' } as { preset?: string; email?: string },
      'verify',
    );
    expect(merged.email).toBe('team@example.com');
  });

  it('verify preset cache: false + runtime --cache true → cache true', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPreset(
      'fresh-verify',
      { mode: 'verify', provider: 'hunter', cache: false },
      {},
      env,
    );

    const merged = await withPreset(
      { preset: 'fresh-verify', cache: true } as {
        preset?: string;
        cache?: boolean;
      },
      'verify',
    );
    expect(merged.cache).toBe(true);
  });
});
