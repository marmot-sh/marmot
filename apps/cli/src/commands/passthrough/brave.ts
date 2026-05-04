import { Command } from 'commander';

import { AICliError, WEB_PROVIDER_BASE_URLS } from '@marmot-sh/core';

import { getWebProviderApiKey } from '../../providers/web-index.js';

const BASE_URL = WEB_PROVIDER_BASE_URLS.brave;

type Deps = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  fetchFn?: typeof fetch;
};

async function call(
  endpoint: string,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const response = await fetchFn(`${BASE_URL}${endpoint}`, {
    headers: { accept: 'application/json', 'X-Subscription-Token': apiKey },
  });
  if (!response.ok) {
    const cat =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      cat,
      `Brave call ${endpoint} failed with status ${response.status}.`,
    );
  }
  return response.json();
}

function emit(stdout: Deps['stdout'], data: unknown): void {
  const w = stdout ?? process.stdout;
  w.write(`${JSON.stringify({ ok: true, provider: 'brave', data }, null, 2)}\n`);
}

function ensureKey(env: NodeJS.ProcessEnv, cli?: string): string {
  const k = getWebProviderApiKey('brave', cli, env);
  if (!k) {
    throw new AICliError('auth', 'Brave requires --api-key or BRAVE_API_KEY.');
  }
  return k;
}

export function buildBraveCommand(deps: Deps = {}): Command {
  const cmd = new Command('brave').description('Brave Search passthrough.');

  cmd
    .command('summarizer')
    .description('Summarizer fetch by key (must come from a prior web/search summary=1).')
    .requiredOption('--key <key>', 'Summarizer key returned by web/search.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .option('--inline-references', 'Embed citation markers inline.')
    .action(async (opts: { key: string; apiKey?: string; inlineReferences?: boolean }) => {
      const env = deps.env ?? process.env;
      const fetchFn = deps.fetchFn ?? fetch;
      const apiKey = ensureKey(env, opts.apiKey);
      const url = new URL(`${BASE_URL}/summarizer/search`);
      url.searchParams.set('key', opts.key);
      if (opts.inlineReferences) url.searchParams.set('inline_references', '1');
      const data = await call(url.pathname + url.search, apiKey, fetchFn);
      emit(deps.stdout, data);
    });

  return cmd;
}
