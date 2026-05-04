import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { resolveStructuredSchema } from '../src/lib/schema.js';

describe('resolveStructuredSchema', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(async (dir) => {
      await rm(dir, {
        recursive: true,
        force: true,
      });
    }));
    tempDirs.length = 0;
  });

  it('loads inline JSON schema', async () => {
    const schema = await resolveStructuredSchema({
      kind: 'inline',
      value: JSON.stringify({
        type: 'object',
        properties: {
          joke: { type: 'string' },
        },
        required: ['joke'],
        additionalProperties: false,
      }),
    });

    expect(schema).toBeDefined();
    expect(typeof schema).toBe('object');
  });

  it('loads a JSON schema from a file', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-schema-'));
    tempDirs.push(tempDir);

    const schemaPath = join(tempDir, 'schema.json');
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: 'object',
        properties: { joke: { type: 'string' } },
        required: ['joke'],
        additionalProperties: false,
      }),
      'utf8',
    );

    const schema = await resolveStructuredSchema({
      kind: 'file',
      path: schemaPath,
    });

    expect(schema).toBeDefined();
    expect(typeof schema).toBe('object');
  });

  it('loads a TypeScript schema module export', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-schema-'));
    tempDirs.push(tempDir);

    const schemaModulePath = join(tempDir, 'schema.ts');
    await writeFile(
      schemaModulePath,
      [
        'import { z } from "zod";',
        'export const schema = z.object({ joke: z.string() });',
      ].join('\n'),
      'utf8',
    );

    const schema = await resolveStructuredSchema({
      kind: 'module',
      path: schemaModulePath,
    });

    expect(isZodSchema(schema)).toBe(true);

    if (!isZodSchema(schema)) {
      throw new Error('Expected a Zod schema export.');
    }

    const parsed = await schema.safeParseAsync({
      joke: 'hello',
    });
    expect(parsed.success).toBe(true);
  });
});

function isZodSchema(value: unknown): value is z.ZodType {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'safeParseAsync' in value &&
    typeof value.safeParseAsync === 'function',
  );
}
