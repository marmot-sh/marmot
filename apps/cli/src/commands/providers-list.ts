import {
  listProviderReadiness,
  readMarmotConfig,
  writeLine,
  type OutputWriter,
} from '@marmot-sh/core';

import { listProviderSummaries } from '../providers/index.js';

type ProvidersListOptions = {
  /** When true, layer per-provider readiness diagnostics (enabled / key
   *  presence / overall ready) onto each row. Without this flag the
   *  output stays the lean ProviderSummary shape. */
  checkKeys?: boolean;
};

type ProvidersListDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

export async function handleProvidersListCommand(
  options: ProvidersListOptions = {},
  dependencies: ProvidersListDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const summaries = listProviderSummaries(env);

  if (!options.checkKeys) {
    writeLine(stdout, JSON.stringify(summaries, null, 2));
    return;
  }

  const config = await readMarmotConfig(env);
  const readiness = listProviderReadiness(config, env);
  const rows = summaries.map((summary) => ({
    ...summary,
    ...(readiness.get(summary.slug) ?? {
      enabled: true,
      keys: [],
      ready: false,
    }),
  }));
  writeLine(stdout, JSON.stringify(rows, null, 2));
}
