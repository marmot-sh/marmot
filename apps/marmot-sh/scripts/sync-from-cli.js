#!/usr/bin/env node
// Mirror the bundled CLI artifact from `apps/cli/dist/cli.js` into this
// shim package's `dist/`. The two packages are bit-identical at the
// binary level — only the `package.json` `name` differs. See README.

import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceCliJs = join(here, '..', '..', 'cli', 'dist', 'cli.js');
const destDir = join(here, '..', 'dist');
const destCliJs = join(destDir, 'cli.js');

if (!existsSync(sourceCliJs)) {
  process.stderr.write(
    `error: ${sourceCliJs} not found. Build @marmot-sh/cli first:\n` +
      `  pnpm --filter @marmot-sh/cli build\n`,
  );
  process.exit(1);
}

await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });
await copyFile(sourceCliJs, destCliJs);
// Preserve the executable bit so npm's bin shim works after install.
await chmod(destCliJs, 0o755);

process.stdout.write(
  `marmot-sh: synced ${sourceCliJs} → ${destCliJs}\n`,
);
