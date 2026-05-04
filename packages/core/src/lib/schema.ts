import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, resolve } from 'node:path';
import { createRequire } from 'node:module';

import { jsonSchema, type FlexibleSchema } from 'ai';
import { transform as sucraseTransform } from 'sucrase';

import { AICliError } from './errors.js';
import { resolveUserPath } from './paths.js';
import type { SchemaSource } from '../types.js';

type JsonSchemaObject = Record<string, unknown>;
type CommonJsModuleRecord = {
  exports: unknown;
};

const packageRequire = createRequire(new URL('../../package.json', import.meta.url));
const transpiledModuleCache = new Map<string, CommonJsModuleRecord>();

export async function resolveStructuredSchema(
  source: SchemaSource,
): Promise<FlexibleSchema<unknown>> {
  switch (source.kind) {
    case 'inline':
      return wrapJsonSchema(parseJsonSchema(source.value, '--schema'));
    case 'file':
      return wrapJsonSchema(await loadJsonSchemaFile(source.path));
    case 'module':
      return loadSchemaModule(source.path);
  }
}

async function loadJsonSchemaFile(inputPath: string): Promise<JsonSchemaObject> {
  const resolvedPath = resolveUserPath(inputPath);
  return parseJsonSchema(readFileOrThrow(resolvedPath, 'file'), resolvedPath);
}

function parseJsonSchema(rawSchema: string, sourceLabel: string): JsonSchemaObject {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawSchema) as unknown;
  } catch (error) {
    throw new AICliError(
      'validation',
      `Schema from "${sourceLabel}" is not valid JSON.`,
      { cause: error },
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AICliError(
      'validation',
      `Schema from "${sourceLabel}" must be a JSON object.`,
    );
  }

  return parsed as JsonSchemaObject;
}

function wrapJsonSchema(schema: JsonSchemaObject): FlexibleSchema<unknown> {
  return jsonSchema(schema);
}

async function loadSchemaModule(inputPath: string): Promise<FlexibleSchema<unknown>> {
  const resolvedPath = resolveUserPath(inputPath);
  let importedModule: Record<string, unknown>;

  try {
    importedModule = loadCommonJsModule(resolvedPath) as Record<string, unknown>;
  } catch (error) {
    throw new AICliError(
      'provider',
      `Failed to load schema module "${resolvedPath}".`,
      { cause: error },
    );
  }

  const exportedSchema = importedModule.default ?? importedModule.schema;

  if (!looksLikeFlexibleSchema(exportedSchema)) {
    throw new AICliError(
      'validation',
      `Schema module "${resolvedPath}" must export a Zod schema as default or named "schema".`,
    );
  }

  return exportedSchema as FlexibleSchema<unknown>;
}

function isTypeScriptExtension(extension: string): boolean {
  return ['.ts', '.tsx', '.mts', '.cts'].includes(extension);
}

function loadCommonJsModule(modulePath: string): unknown {
  const resolvedModulePath = resolve(modulePath);
  const cached = transpiledModuleCache.get(resolvedModulePath);

  if (cached) {
    return cached.exports;
  }

  const source = readFileOrThrow(resolvedModulePath, 'module');
  const transpiled = transpileModuleOrThrow(source, resolvedModulePath);
  const moduleRecord: CommonJsModuleRecord = {
    exports: {},
  };

  transpiledModuleCache.set(resolvedModulePath, moduleRecord);

  const localRequire = createSchemaRequire(resolvedModulePath);

  try {
    const evaluator = new Function(
      'exports',
      'require',
      'module',
      '__filename',
      '__dirname',
      transpiled,
    );

    evaluator(
      moduleRecord.exports,
      localRequire,
      moduleRecord,
      resolvedModulePath,
      dirname(resolvedModulePath),
    );
  } catch (error) {
    transpiledModuleCache.delete(resolvedModulePath);
    throw error;
  }

  return moduleRecord.exports;
}

function readFileOrThrow(filePath: string, noun: 'file' | 'module'): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new AICliError(
      'io',
      `Failed to read schema ${noun} "${filePath}".`,
      { cause: error },
    );
  }
}

function transpileModuleOrThrow(source: string, filePath: string): string {
  // Sucrase transpiles TS → CommonJS without doing type-checking, which is
  // exactly what we need (the user's schema module is loaded into a vm
  // sandbox and only the runtime values are read). Sucrase is ~250 KB
  // vs the ~9 MB TypeScript compiler — a 75% bundle reduction.
  try {
    return sucraseTransform(source, {
      transforms: ['typescript', 'imports'],
      filePath,
      preserveDynamicImport: true,
    }).code;
  } catch (error) {
    throw new AICliError(
      'validation',
      `Failed to transpile schema module "${filePath}".`,
      { cause: error },
    );
  }
}

function createSchemaRequire(parentPath: string): NodeJS.Require {
  const parentRequire = createRequire(parentPath);

  return ((specifier: string) => {
    const resolvedFilePath = resolveRequiredFile(specifier, parentPath);

    if (resolvedFilePath && isTypeScriptExtension(extname(resolvedFilePath).toLowerCase())) {
      return loadCommonJsModule(resolvedFilePath);
    }

    try {
      return parentRequire(specifier);
    } catch (error) {
      if (isModuleNotFound(error) && isBareSpecifier(specifier)) {
        return packageRequire(specifier);
      }

      throw error;
    }
  }) as NodeJS.Require;
}

function resolveRequiredFile(specifier: string, parentPath: string): string | null {
  if (!isRelativeSpecifier(specifier) && !isAbsolute(specifier)) {
    return null;
  }

  const parentDirectory = dirname(parentPath);
  const absoluteSpecifier = isAbsolute(specifier)
    ? specifier
    : resolve(parentDirectory, specifier);
  const extension = extname(absoluteSpecifier).toLowerCase();
  const candidates = extension
    ? [
        absoluteSpecifier,
        ...getTypeScriptFallbacks(absoluteSpecifier, extension),
      ]
    : [
        absoluteSpecifier,
        ...expandWithoutExtension(absoluteSpecifier),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function expandWithoutExtension(filePath: string): string[] {
  return [
    `${filePath}.ts`,
    `${filePath}.tsx`,
    `${filePath}.mts`,
    `${filePath}.cts`,
    `${filePath}.js`,
    `${filePath}.mjs`,
    `${filePath}.cjs`,
    `${filePath}.json`,
    resolve(filePath, 'index.ts'),
    resolve(filePath, 'index.tsx'),
    resolve(filePath, 'index.mts'),
    resolve(filePath, 'index.cts'),
    resolve(filePath, 'index.js'),
    resolve(filePath, 'index.mjs'),
    resolve(filePath, 'index.cjs'),
    resolve(filePath, 'index.json'),
  ];
}

function getTypeScriptFallbacks(filePath: string, extension: string): string[] {
  const stem = filePath.slice(0, -extension.length);

  if (extension === '.js') {
    return [`${stem}.ts`, `${stem}.tsx`];
  }

  if (extension === '.mjs') {
    return [`${stem}.mts`];
  }

  if (extension === '.cjs') {
    return [`${stem}.cts`];
  }

  return [];
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === '.' ||
    specifier === '..'
  );
}

function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith('node:') &&
    !isRelativeSpecifier(specifier) &&
    !isAbsolute(specifier);
}

function isModuleNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'MODULE_NOT_FOUND',
  );
}

function looksLikeFlexibleSchema(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    'safeParse' in value ||
    'safeParseAsync' in value ||
    'jsonSchema' in value
  );
}
