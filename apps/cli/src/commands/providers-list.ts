import {
  listProviderReadiness,
  readMarmotConfig,
  writeLine,
  type OutputWriter,
} from '@marmot-sh/core';

import { listProviderSummaries } from '../providers/index.js';
import { renderList, type Column } from '../lib/list-renderer.js';
import { resolveOutputMode, type OutputModeOptions } from '../lib/output-mode-options.js';

type ProvidersListOptions = OutputModeOptions & {
  /** When true, layer per-provider readiness diagnostics (enabled / key
   *  presence / overall ready) onto each row. Without this flag the
   *  output stays the lean ProviderSummary shape. */
  checkKeys?: boolean;
};

type ProvidersListDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

type ProviderRow = {
  slug: string;
  name: string;
  category: string;
  env: string;
  ready?: boolean;
  enabled?: boolean;
};

const PROVIDER_COLUMNS: Column<ProviderRow>[] = [
  { key: 'slug', header: 'SLUG' },
  { key: 'name', header: 'NAME' },
  { key: 'category', header: 'CATEGORY' },
  { key: 'env', header: 'ENV VARS' },
];

const PROVIDER_COLUMNS_CHECK_KEYS: Column<ProviderRow>[] = [
  { key: 'slug', header: 'SLUG' },
  { key: 'name', header: 'NAME' },
  { key: 'category', header: 'CATEGORY' },
  { key: 'env', header: 'ENV VARS' },
  {
    key: 'ready',
    header: 'STATUS',
    format: (r) =>
      r.enabled === false ? '⏸ disabled' : r.ready ? '✓ ready' : '⚠ no key',
  },
];

export async function handleProvidersListCommand(
  options: ProvidersListOptions = {},
  dependencies: ProvidersListDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const summaries = listProviderSummaries(env);

  let rows: ProviderRow[];
  let columns: Column<ProviderRow>[];

  if (options.checkKeys) {
    const config = await readMarmotConfig(env);
    const readiness = listProviderReadiness(config, env);
    rows = summaries.map((s) => {
      const r = readiness.get(s.slug);
      return {
        slug: s.slug,
        name: s.name,
        category: s.category,
        env: s.env.join(', '),
        ready: r?.ready ?? false,
        enabled: r?.enabled ?? true,
      };
    });
    columns = PROVIDER_COLUMNS_CHECK_KEYS;
  } else {
    rows = summaries.map((s) => ({
      slug: s.slug,
      name: s.name,
      category: s.category,
      env: s.env.join(', '),
    }));
    columns = PROVIDER_COLUMNS;
  }

  const mode = resolveOutputMode(options, stdout as NodeJS.WriteStream);
  // For JSON mode, preserve the original raw shape (array of summaries
  // or summaries + readiness) so existing tooling doesn't break.
  if (mode === 'json' && !options.checkKeys) {
    writeLine(stdout, JSON.stringify(summaries, null, 2));
    return;
  }
  if (mode === 'json' && options.checkKeys) {
    const config = await readMarmotConfig(env);
    const readiness = listProviderReadiness(config, env);
    const fullRows = summaries.map((summary) => ({
      ...summary,
      ...(readiness.get(summary.slug) ?? { enabled: true, keys: [], ready: false }),
    }));
    writeLine(stdout, JSON.stringify(fullRows, null, 2));
    return;
  }

  writeLine(
    stdout,
    renderList({
      rows,
      columns,
      mode,
      envelopeKey: 'providers',
      emptyMessage: 'No providers registered.',
    }),
  );
}
