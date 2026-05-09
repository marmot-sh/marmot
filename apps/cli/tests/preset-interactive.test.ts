/**
 * Tests for the new descriptor table and the interactive create/update
 * routing logic. Note: the @clack/prompts walks themselves are not
 * exercised here — mocking clack is invasive and the existing
 * preset-command.test.ts already covers byte-identical output for the
 * flag-driven path post-refactor (which is the highest-value coverage).
 * The interactive walks are covered by manual smoke during release.
 */
import { describe, expect, it } from 'vitest';

import { PRESET_MODES, presetSchema, type PresetMode } from '@marmot-sh/core';

import {
  MODE_FIELDS,
  getFieldDescriptor,
  type FieldDescriptor,
  type FieldType,
} from '../src/commands/preset/field-descriptors.js';

describe('MODE_FIELDS table', () => {
  it('covers every preset mode', () => {
    for (const mode of PRESET_MODES) {
      expect(MODE_FIELDS[mode]).toBeDefined();
      expect(MODE_FIELDS[mode].length).toBeGreaterThan(0);
    }
  });

  it('every descriptor key is a recognized schema key (no unknown-key errors under strict mode)', () => {
    // We don't validate values here — type-correctness or enum
    // membership for `provider` etc. is the schema's job at parse time.
    // What this test catches is a typo in a descriptor `key` that
    // doesn't match any field on the matching mode's schema. A bad
    // descriptor would surface as "Unrecognized key" under strict mode.
    for (const mode of PRESET_MODES) {
      const candidate: Record<string, unknown> = { mode };
      for (const f of MODE_FIELDS[mode]) {
        candidate[f.key] = exampleValueFor(f);
      }
      const parsed = presetSchema.safeParse(candidate);
      if (!parsed.success) {
        const unknownKey = parsed.error.issues.find(
          (i) => i.code === 'unrecognized_keys',
        );
        if (unknownKey) {
          throw new Error(
            `Mode "${mode}" descriptor table has unknown key(s): ${JSON.stringify(unknownKey)}`,
          );
        }
        // Other issues (invalid enum value, type mismatch on placeholder)
        // are noise from the simplified placeholder generator and do not
        // indicate a descriptor bug.
      }
    }
  });

  it('declares enum values for every enum-typed field', () => {
    for (const mode of PRESET_MODES) {
      for (const f of MODE_FIELDS[mode]) {
        if (f.type === 'enum') {
          expect(f.enumValues, `${mode}.${f.key} missing enumValues`).toBeDefined();
          expect(f.enumValues!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('groups all `structured-output` members together (text, research, findall)', () => {
    const groupModes: PresetMode[] = ['text', 'research', 'findall'];
    for (const mode of groupModes) {
      const groupFields = MODE_FIELDS[mode].filter((f) => f.group === 'structured-output');
      expect(groupFields.length).toBeGreaterThanOrEqual(2);
      for (const f of groupFields) {
        expect(f.group).toBe('structured-output');
      }
    }
  });

  it('text mode lists all three structured-output members', () => {
    const groupKeys = MODE_FIELDS.text
      .filter((f) => f.group === 'structured-output')
      .map((f) => f.key);
    expect(groupKeys).toContain('schema');
    expect(groupKeys).toContain('schemaFile');
    expect(groupKeys).toContain('schemaModule');
  });

  it('AI modes include `model` in their field list, web/data modes do not', () => {
    const aiModes: PresetMode[] = ['text', 'image', 'speech', 'transcription', 'video'];
    const nonAiModes: PresetMode[] = [
      'search',
      'scrape',
      'answer',
      'map',
      'crawl',
      'research',
      'findall',
      'enrich',
      'lookup',
      'verify',
    ];

    for (const mode of aiModes) {
      const keys = MODE_FIELDS[mode].map((f) => f.key);
      expect(keys, `${mode} should include "model"`).toContain('model');
    }
    for (const mode of nonAiModes) {
      const keys = MODE_FIELDS[mode].map((f) => f.key);
      expect(keys, `${mode} should NOT include "model"`).not.toContain('model');
    }
  });

  it('every mode has provider, retries, timeout, output, session', () => {
    const required = ['provider', 'retries', 'timeout', 'output', 'session'];
    for (const mode of PRESET_MODES) {
      const keys = MODE_FIELDS[mode].map((f) => f.key);
      for (const k of required) {
        expect(keys, `${mode} missing ${k}`).toContain(k);
      }
    }
  });

  it('positional-fillback fields appear on the right modes', () => {
    // These positional values can be filled by a preset (a key feature
    // of 0.7.0 — covered by feature.preset-data-verbs and friends).
    const expectations: Array<[PresetMode, string]> = [
      ['text', 'prompt'],
      ['image', 'prompt'],
      ['speech', 'text'],
      ['transcription', 'audio'],
      ['video', 'prompt'],
      ['search', 'query'],
      ['scrape', 'urls'],
      ['answer', 'query'],
      ['map', 'url'],
      ['crawl', 'url'],
      ['research', 'query'],
      ['findall', 'objective'],
      ['verify', 'email'],
    ];
    for (const [mode, key] of expectations) {
      expect(getFieldDescriptor(mode, key), `${mode}.${key}`).toBeDefined();
    }
  });
});

describe('getFieldDescriptor', () => {
  it('returns the field for known mode+key pairs', () => {
    const f = getFieldDescriptor('text', 'system');
    expect(f).toBeDefined();
    expect(f?.type).toBe('string');
    expect(f?.flag).toBe('system');
  });

  it('returns undefined for unknown keys', () => {
    expect(getFieldDescriptor('text', 'totally-not-a-field')).toBeUndefined();
  });
});

describe('descriptor validation metadata', () => {
  it('every retries field has min: 0', () => {
    for (const mode of PRESET_MODES) {
      const f = MODE_FIELDS[mode].find((d) => d.key === 'retries');
      expect(f, `${mode}.retries`).toBeDefined();
      expect(f?.min, `${mode}.retries.min`).toBe(0);
    }
  });

  it('every timeout field has min: 1', () => {
    for (const mode of PRESET_MODES) {
      const f = MODE_FIELDS[mode].find((d) => d.key === 'timeout');
      expect(f, `${mode}.timeout`).toBeDefined();
      expect(f?.min, `${mode}.timeout.min`).toBe(1);
    }
  });

  it('text mode topP has min: 0 and max: 1', () => {
    const f = MODE_FIELDS.text.find((d) => d.key === 'topP')!;
    expect(f.min).toBe(0);
    expect(f.max).toBe(1);
  });

  it('image and video n fields have min: 1, max: 10', () => {
    for (const mode of ['image', 'video'] as const) {
      const f = MODE_FIELDS[mode].find((d) => d.key === 'n')!;
      expect(f.min, `${mode}.n.min`).toBe(1);
      expect(f.max, `${mode}.n.max`).toBe(10);
    }
  });

  it('search afterDate / beforeDate carry the YYYY-MM-DD pattern', () => {
    const after = MODE_FIELDS.search.find((d) => d.key === 'afterDate')!;
    const before = MODE_FIELDS.search.find((d) => d.key === 'beforeDate')!;
    expect(after.pattern?.test('2026-05-09')).toBe(true);
    expect(after.pattern?.test('2026/05/09')).toBe(false);
    expect(before.pattern?.test('not-a-date')).toBe(false);
  });

  it('speech speed has range 0.25–4', () => {
    const f = MODE_FIELDS.speech.find((d) => d.key === 'speed')!;
    expect(f.min).toBe(0.25);
    expect(f.max).toBe(4);
  });

  it('crawl maxPages has min: 1 and maxDepth has min: 0 (allows root-only)', () => {
    const mp = MODE_FIELDS.crawl.find((d) => d.key === 'maxPages')!;
    const md = MODE_FIELDS.crawl.find((d) => d.key === 'maxDepth')!;
    expect(mp.min).toBe(1);
    expect(md.min).toBe(0);
  });
});

describe('descriptor type coverage', () => {
  it('every FieldType has at least one descriptor using it (except path which appears in multiple modes)', () => {
    const seen = new Set<FieldType>();
    for (const mode of PRESET_MODES) {
      for (const f of MODE_FIELDS[mode]) {
        seen.add(f.type);
      }
    }
    // Sanity: at minimum we expect string, number-int, bool, enum,
    // list-string, path. number-float lives in text mode (temperature,
    // topP) and speech mode (speed).
    expect(seen.has('string')).toBe(true);
    expect(seen.has('path')).toBe(true);
    expect(seen.has('number-int')).toBe(true);
    expect(seen.has('number-float')).toBe(true);
    expect(seen.has('bool')).toBe(true);
    expect(seen.has('enum')).toBe(true);
    expect(seen.has('list-string')).toBe(true);
  });
});

/** Placeholder value generator used by the integrity test above. */
function exampleValueFor(f: FieldDescriptor): unknown {
  switch (f.type) {
    case 'string':
    case 'path':
      return 'example';
    case 'number-int':
      // Some int fields require positive (e.g. minLikelihood, n).
      return 1;
    case 'number-float':
      return 0.5;
    case 'bool':
      return true;
    case 'enum':
      return f.enumValues?.[0];
    case 'list-string':
      return ['example'];
  }
}
