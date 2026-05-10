import { describe, expect, it } from 'vitest';

import {
  renderList,
  renderRecord,
  type Column,
  type RenderMode,
  type Section,
} from '../src/lib/list-renderer.js';
import { resolveOutputMode } from '../src/lib/output-mode-options.js';

type Preset = { name: string; mode: string; provider: string; model?: string };

const presetCols: Column<Preset>[] = [
  { key: 'name', header: 'NAME' },
  { key: 'mode', header: 'MODE' },
  { key: 'provider', header: 'PROVIDER' },
  { key: 'model', header: 'MODEL' },
];

const samplePresets: Preset[] = [
  { name: 'linked-in', mode: 'search', provider: 'parallel' },
  { name: 'yc-news', mode: 'scrape', provider: 'parallel' },
  { name: 'code-review', mode: 'text', provider: 'anthropic', model: 'claude-sonnet-4-6' },
];

describe('renderList — json mode', () => {
  it('preserves the today-style envelope shape exactly', () => {
    const out = renderList({
      rows: samplePresets,
      columns: presetCols,
      mode: 'json',
      envelopeKey: 'presets',
    });
    expect(JSON.parse(out)).toEqual({ presets: samplePresets });
  });

  it('merges meta into the envelope', () => {
    const out = renderList({
      rows: samplePresets.slice(0, 2),
      columns: presetCols,
      mode: 'json',
      envelopeKey: 'presets',
      meta: { total: 100, limit: 2 },
    });
    expect(JSON.parse(out)).toEqual({
      presets: samplePresets.slice(0, 2),
      total: 100,
      limit: 2,
    });
  });

  it('returns empty array (not a message) when rows is empty', () => {
    const out = renderList({
      rows: [],
      columns: presetCols,
      mode: 'json',
      envelopeKey: 'presets',
      emptyMessage: 'No presets configured.',
    });
    expect(JSON.parse(out)).toEqual({ presets: [] });
  });
});

describe('renderList — human mode', () => {
  it('emits a column-aligned table with dimmed headers', () => {
    const out = renderList({
      rows: samplePresets,
      columns: presetCols,
      mode: 'human',
      envelopeKey: 'presets',
    });
    // Header line contains every column header.
    expect(out).toMatch(/NAME/);
    expect(out).toMatch(/MODE/);
    expect(out).toMatch(/PROVIDER/);
    expect(out).toMatch(/MODEL/);
    // First data row appears.
    expect(out).toMatch(/linked-in/);
    expect(out).toMatch(/yc-news/);
  });

  it('renders missing/undefined cells as em-dash', () => {
    const out = renderList({
      rows: [{ name: 'x', mode: 'search', provider: 'parallel' }],
      columns: presetCols,
      mode: 'human',
      envelopeKey: 'presets',
    });
    expect(out).toMatch(/—/);
  });

  it('uses emptyMessage when rows is empty', () => {
    const out = renderList({
      rows: [],
      columns: presetCols,
      mode: 'human',
      envelopeKey: 'presets',
      emptyMessage: 'No presets configured.',
    });
    expect(out).toBe('No presets configured.');
  });

  it('appends footer line after the table when provided', () => {
    const out = renderList({
      rows: samplePresets.slice(0, 1),
      columns: presetCols,
      mode: 'human',
      envelopeKey: 'presets',
      footer: 'Showing 1 of 87. Pass --limit to see more.',
    });
    expect(out).toMatch(/Showing 1 of 87/);
  });
});

describe('renderList — markdown mode', () => {
  it('emits a pipe-table with separator row', () => {
    const out = renderList({
      rows: samplePresets,
      columns: presetCols,
      mode: 'markdown',
      envelopeKey: 'presets',
    });
    const lines = out.split('\n');
    expect(lines[0]).toBe('| NAME | MODE | PROVIDER | MODEL |');
    expect(lines[1]).toBe('| --- | --- | --- | --- |');
    expect(lines[2]).toBe('| linked-in | search | parallel | — |');
  });

  it('escapes pipes inside cells', () => {
    const out = renderList({
      rows: [{ name: 'a|b', mode: 'm', provider: 'p' }],
      columns: presetCols,
      mode: 'markdown',
      envelopeKey: 'presets',
    });
    expect(out).toMatch(/a\\\|b/);
  });

  it('renders right-aligned columns with --:-- separator', () => {
    const cols: Column<{ n: number }>[] = [
      { key: 'n', header: 'N', align: 'right' },
    ];
    const out = renderList({
      rows: [{ n: 7 }],
      columns: cols,
      mode: 'markdown',
      envelopeKey: 'rows',
    });
    expect(out.split('\n')[1]).toBe('| ---: |');
  });

  it('emits italic empty marker when rows is empty', () => {
    const out = renderList({
      rows: [],
      columns: presetCols,
      mode: 'markdown',
      envelopeKey: 'presets',
      emptyMessage: '_No presets configured._',
    });
    expect(out).toBe('_No presets configured._');
  });
});

describe('renderRecord — json mode', () => {
  it('wraps the record under envelopeKey', () => {
    const record = { name: 'linked-in', mode: 'search', provider: 'parallel' };
    const out = renderRecord({ record, mode: 'json', envelopeKey: 'preset' });
    expect(JSON.parse(out)).toEqual({ preset: record });
  });
});

describe('renderRecord — human mode', () => {
  it('groups keys into named sections', () => {
    const record = {
      name: 'linked-in',
      mode: 'search',
      provider: 'parallel',
      includeDomains: 'linkedin.com',
    };
    const sections: Section<typeof record>[] = [
      { title: 'Identity', keys: ['name', 'mode'] },
      { title: 'Settings', keys: ['provider', 'includeDomains'] },
    ];
    const out = renderRecord({ record, mode: 'human', envelopeKey: 'preset', sections });
    expect(out).toMatch(/Identity/);
    expect(out).toMatch(/Settings/);
    expect(out).toMatch(/name/);
    expect(out).toMatch(/linked-in/);
    expect(out).toMatch(/includeDomains/);
  });

  it('falls back to flat key/value when no sections passed', () => {
    const out = renderRecord({
      record: { foo: 'bar', baz: 42 },
      mode: 'human',
      envelopeKey: 'item',
    });
    expect(out).toMatch(/foo/);
    expect(out).toMatch(/bar/);
    expect(out).toMatch(/baz/);
    expect(out).toMatch(/42/);
  });
});

describe('renderRecord — markdown mode', () => {
  it('renders a 2-col Field|Value table', () => {
    const record = { name: 'x', mode: 'search' };
    const out = renderRecord({ record, mode: 'markdown', envelopeKey: 'preset' });
    expect(out).toMatch(/\| Field \| Value \|/);
    expect(out).toMatch(/\| name \| x \|/);
  });

  it('emits ## headings per section', () => {
    const record = { a: 1, b: 2 };
    const sections: Section<typeof record>[] = [
      { title: 'Group A', keys: ['a'] },
      { title: 'Group B', keys: ['b'] },
    ];
    const out = renderRecord({ record, mode: 'markdown', envelopeKey: 'r', sections, title: 'Demo' });
    expect(out).toMatch(/^## Demo/);
    expect(out).toMatch(/### Group A/);
    expect(out).toMatch(/### Group B/);
  });
});

describe('resolveOutputMode', () => {
  it('returns json when --json is set', () => {
    expect(resolveOutputMode({ json: true })).toBe('json');
  });

  it('returns markdown when --markdown is set', () => {
    expect(resolveOutputMode({ markdown: true })).toBe('markdown');
  });

  it('throws when both flags are passed', () => {
    expect(() => resolveOutputMode({ json: true, markdown: true })).toThrow(/mutually exclusive/);
  });

  it('returns human on a TTY when no flag is passed', () => {
    const fakeTty = { isTTY: true } as unknown as NodeJS.WriteStream;
    expect(resolveOutputMode({}, fakeTty)).toBe('human');
  });

  it('returns json on a non-TTY (piped) when no flag is passed', () => {
    const fakePipe = { isTTY: false } as unknown as NodeJS.WriteStream;
    expect(resolveOutputMode({}, fakePipe)).toBe('json');
  });
});
