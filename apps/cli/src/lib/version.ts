import { readFileSync } from 'node:fs';

// Replaced at build time by tsup's `define` (see tsup.config.ts).
// Falls back to reading package.json at runtime when running unbundled
// (e.g. `pnpm dev` / `tsx src/cli.ts`).
declare const __MARMOT_VERSION__: string | undefined;

function resolveVersion(): string {
  if (typeof __MARMOT_VERSION__ === 'string') return __MARMOT_VERSION__;
  try {
    const url = new URL('../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

export const MARMOT_VERSION = resolveVersion();
