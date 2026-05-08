#!/usr/bin/env node
// Mirror the bundled CLI artifacts from `apps/cli/dist/` into this shim
// package's `dist/`. The two packages are bit-identical at the binary
// level — only the `package.json` `name` differs. The bin entry is
// `bin.js` (a tiny Node-version guard) which dynamic-imports `cli.js` on
// the fly, so both files must travel together. See README.

import { chmod, copyFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, '..', '..', 'cli', 'dist');
const destDir = join(here, '..', 'dist');

const filesToSync = ['bin.js', 'cli.js'];

for (const file of filesToSync) {
  const source = join(sourceDir, file);
  if (!existsSync(source)) {
    process.stderr.write(
      `error: ${source} not found. Build @marmot-sh/cli first:\n` +
        `  pnpm --filter @marmot-sh/cli build\n`,
    );
    process.exit(1);
  }
}

await rm(destDir, { recursive: true, force: true });
await mkdir(destDir, { recursive: true });

for (const file of filesToSync) {
  const source = join(sourceDir, file);
  const dest = join(destDir, file);
  await copyFile(source, dest);
  // Preserve the executable bit so npm's bin shim works after install.
  await chmod(dest, 0o755);
  process.stdout.write(`marmot-sh: synced ${source} → ${dest}\n`);
}
