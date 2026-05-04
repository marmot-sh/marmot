import { Command } from 'commander';

import { AICliError, WEB_PROVIDER_BASE_URLS } from '@marmot-sh/core';

import { getWebProviderApiKey } from '../../providers/web-index.js';

const BASE_URL = WEB_PROVIDER_BASE_URLS.exa;

type Deps = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  fetchFn?: typeof fetch;
};

function ensureKey(env: NodeJS.ProcessEnv, cli?: string): string {
  const k = getWebProviderApiKey('exa', cli, env);
  if (!k) throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  return k;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  endpointHint: string,
): Promise<unknown> {
  const response = await fetchFn(url, init);
  if (!response.ok) {
    const cat =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      cat,
      `Exa ${endpointHint} failed with status ${response.status}.`,
    );
  }
  return response.json();
}

function emit(stdout: Deps['stdout'], data: unknown): void {
  const w = stdout ?? process.stdout;
  w.write(`${JSON.stringify({ ok: true, provider: 'exa', data }, null, 2)}\n`);
}

export function buildExaCommand(deps: Deps = {}): Command {
  const cmd = new Command('exa').description('Exa passthrough.');

  cmd
    .command('find-similar')
    .description('Find semantically similar pages to a URL.')
    .argument('<url>', 'Source URL.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--exclude-source-domain', 'Exclude pages from the source domain.')
    .option('--num-results <n>', 'Max results.')
    .action(async (url: string, opts: { apiKey?: string; excludeSourceDomain?: boolean; numResults?: string }) => {
      const env = deps.env ?? process.env;
      const fetchFn = deps.fetchFn ?? fetch;
      const apiKey = ensureKey(env, opts.apiKey);
      const body: Record<string, unknown> = { url };
      if (opts.excludeSourceDomain) body.excludeSourceDomain = true;
      if (opts.numResults) body.numResults = Number.parseInt(opts.numResults, 10);
      const data = await fetchJson(
        `${BASE_URL}/findSimilar`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify(body),
        },
        fetchFn,
        'findSimilar',
      );
      emit(deps.stdout, data);
    });

  return cmd;
}
