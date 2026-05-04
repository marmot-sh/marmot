import { listProviderSummaries } from '../providers/index.js';
import { writeLine, type OutputWriter } from '@marmot-sh/core';

type ProvidersListDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

export async function handleProvidersListCommand(
  dependencies: ProvidersListDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? process.stdout;
  const providers = listProviderSummaries(dependencies.env ?? process.env);
  writeLine(stdout, JSON.stringify(providers, null, 2));
}
