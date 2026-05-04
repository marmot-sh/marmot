import { Command } from 'commander';

import { AICliError, WEB_PROVIDER_BASE_URLS } from '@marmot-sh/core';

import { getWebProviderApiKey } from '../../providers/web-index.js';

const BASE_URL = WEB_PROVIDER_BASE_URLS.firecrawl;

type Deps = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  fetchFn?: typeof fetch;
};

function ensureKey(env: NodeJS.ProcessEnv, cli?: string): string {
  const k = getWebProviderApiKey('firecrawl', cli, env);
  if (!k) {
    throw new AICliError('auth', 'Firecrawl requires --api-key or FIRECRAWL_API_KEY.');
  }
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
      `Firecrawl ${endpointHint} failed with status ${response.status}.`,
    );
  }
  return response.json();
}

function emit(stdout: Deps['stdout'], data: unknown): void {
  const w = stdout ?? process.stdout;
  w.write(`${JSON.stringify({ ok: true, provider: 'firecrawl', data }, null, 2)}\n`);
}

export function buildFirecrawlCommand(deps: Deps = {}): Command {
  const cmd = new Command('firecrawl').description('Firecrawl passthrough.');

  cmd
    .command('llmstxt')
    .description('Generate llms.txt for a website (async).')
    .requiredOption('--url <url>', 'Site URL.')
    .option('--max-urls <n>', 'Max URLs to analyze.')
    .option('--show-full-text', 'Include full text content in response.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .action(async (opts: { url: string; maxUrls?: string; showFullText?: boolean; apiKey?: string }) => {
      const env = deps.env ?? process.env;
      const fetchFn = deps.fetchFn ?? fetch;
      const apiKey = ensureKey(env, opts.apiKey);
      const body: Record<string, unknown> = { url: opts.url };
      if (opts.maxUrls) body.maxUrls = Number.parseInt(opts.maxUrls, 10);
      if (opts.showFullText) body.showFullText = true;
      const data = await fetchJson(
        `${BASE_URL}/v2/llmstxt`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        },
        fetchFn,
        'llmstxt',
      );
      emit(deps.stdout, data);
    });

  cmd
    .command('llmstxt-status')
    .description('Get the status/result of an llmstxt job.')
    .argument('<id>', 'Job id.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .action(async (id: string, opts: { apiKey?: string }) => {
      const env = deps.env ?? process.env;
      const fetchFn = deps.fetchFn ?? fetch;
      const apiKey = ensureKey(env, opts.apiKey);
      const data = await fetchJson(
        `${BASE_URL}/v2/llmstxt/${encodeURIComponent(id)}`,
        { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } },
        fetchFn,
        'llmstxt.status',
      );
      emit(deps.stdout, data);
    });

  cmd
    .command('usage')
    .description('Show remaining credits + tokens for the team.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    .action(async (opts: { apiKey?: string }) => {
      const env = deps.env ?? process.env;
      const fetchFn = deps.fetchFn ?? fetch;
      const apiKey = ensureKey(env, opts.apiKey);
      const credits = await fetchJson(
        `${BASE_URL}/v2/team/credit-usage`,
        { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } },
        fetchFn,
        'team/credit-usage',
      );
      const tokens = await fetchJson(
        `${BASE_URL}/v2/team/token-usage`,
        { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey}` } },
        fetchFn,
        'team/token-usage',
      );
      emit(deps.stdout, { credits, tokens });
    });

  return cmd;
}
