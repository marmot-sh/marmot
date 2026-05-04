import { Command } from 'commander';

import { AICliError, WEB_PROVIDER_BASE_URLS } from '@marmot-sh/core';

import { getWebProviderApiKey } from '../../providers/web-index.js';

const BASE_URL = WEB_PROVIDER_BASE_URLS.tavily;

type Deps = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  fetchFn?: typeof fetch;
};

function ensureKey(env: NodeJS.ProcessEnv, cli?: string): string {
  const k = getWebProviderApiKey('tavily', cli, env);
  if (!k) throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  return k;
}

export function buildTavilyCommand(deps: Deps = {}): Command {
  const cmd = new Command('tavily').description('Tavily passthrough.');

  cmd
    .command('usage')
    .description('Show credit usage for the API key + account.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .action(async (opts: { apiKey?: string }) => {
      const env = deps.env ?? process.env;
      const fetchFn = deps.fetchFn ?? fetch;
      const apiKey = ensureKey(env, opts.apiKey);
      const response = await fetchFn(`${BASE_URL}/usage`, {
        headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) {
        const cat =
          response.status === 401 || response.status === 403 ? 'auth' : 'provider';
        throw new AICliError(
          cat,
          `Tavily usage failed with status ${response.status}.`,
        );
      }
      const data = await response.json();
      const w = deps.stdout ?? process.stdout;
      w.write(`${JSON.stringify({ ok: true, provider: 'tavily', data }, null, 2)}\n`);
    });

  return cmd;
}
