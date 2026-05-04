import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

const requireFromHere = createRequire(import.meta.url);

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  define: {
    __MARMOT_VERSION__: JSON.stringify(pkg.version),
  },
  esbuildPlugins: [
    // zod ships 51 locale modules (Arabic, Belarusian, Khmer, etc.). Our
    // CLI is English-only — same as every other dev-tool CLI. Intercept
    // the locales index import (which zod resolves as a relative path
    // from inside its own tree) and redirect to the English module so
    // the other 50 never enter the bundle. ~277 KB savings.
    {
      name: 'strip-zod-locales',
      setup(build) {
        build.onResolve({ filter: /\/locales(\/index)?(\.[mc]?js)?$/ }, (args) => {
          if (!args.importer.includes('/zod/')) return null;
          return { path: requireFromHere.resolve('zod/v4/locales/en.js') };
        });
      },
    },
  ],
  // Bundle every workspace + npm dependency into a single file. The
  // published `marmot` binary should install with zero runtime deps so
  // users don't pay an install-time penalty for a 100MB AI SDK tree
  // they're already going to fetch elsewhere. Only Node built-ins stay
  // external (handled by platform: 'node').
  noExternal: [/.*/],
  // ESM bundle plus a createRequire shim so any bundled CJS deps that call
  // `require()` (commander does this internally) keep working at runtime.
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __marmotCreateRequire } from 'module';",
      'const require = __marmotCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  shims: true,
  splitting: false,
  treeshake: true,
  clean: true,
  // Sourcemaps doubled the published tarball size. Re-enable for local
  // debugging via `SOURCEMAP=1 pnpm build` if needed.
  sourcemap: process.env.SOURCEMAP === '1',
  // Skip d.ts emit for the CLI app — it's not a consumed library.
  dts: false,
});
