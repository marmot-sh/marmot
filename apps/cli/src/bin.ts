// Bin entry. Runs a Node version guard, then hands off to the real CLI via a
// dynamic import. The dynamic-import path is constructed at runtime so esbuild
// does NOT bundle cli.js into bin.js — bin.js must stay a tiny preamble that
// can parse on Node 18 to print a friendly upgrade message.

import { checkNodeVersion } from './lib/node-version-check.js';

const result = checkNodeVersion({
  versionString: process.versions.node,
  execPath: process.execPath,
});

if (!result.ok) {
  process.stderr.write(result.message + '\n');
  process.exit(1);
}

const cliUrl = new URL('./cli.js', import.meta.url).href;
const cli = (await import(cliUrl)) as { runMain: () => Promise<void> };
await cli.runMain();
