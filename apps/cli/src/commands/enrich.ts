import { Command } from 'commander';

import {
  AICliError,
  assertProviderEnabled,
  readMarmotConfig,
  resolveDataVerbDefaults,
  resolveProviderAuth,
  resolveRetryOptions,
  runWithRetries,
  withSpinner,
  type DataEnrichOrgInput,
  type DataEnrichPersonInput,
  type DataMatchControls,
  type DataOrgIdentifiers,
  type DataPersonIdentifiers,
  type DataType,
  type StatusStream,
} from '@marmot-sh/core';

import { isDataType } from '../providers/data-capabilities.js';
import {
  assertProviderSupportsCell,
  getDataProviderAdapter,
} from '../providers/data-index.js';
import { withResponseCache } from '../providers/cache-wrap.js';
import { makeRetryNotifier } from '../lib/retry-notifier.js';

export type EnrichCommandOptions = {
  type?: string;
  provider?: string;
  apiKey?: string;
  // Person identifiers
  email?: string;
  emailHash?: string;
  linkedin?: string;
  phone?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  domain?: string;
  company?: string;
  providerId?: string;
  // Org-only
  website?: string;
  ticker?: string;
  // Match controls
  minLikelihood?: string;
  require?: string;
  fields?: string;
  // Output
  raw?: boolean;
  json?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string;
  timeout?: string;
};

export type EnrichCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
  stderr?: StatusStream;
  fetchFn?: typeof fetch;
};

function csvToList(s: string | undefined): string[] | undefined {
  if (!s) return undefined;
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function parseMinLikelihood(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n < 1) {
    throw new AICliError(
      'validation',
      `--min-likelihood must be a positive integer (got "${s}").`,
    );
  }
  return n;
}

function buildMatchControls(options: EnrichCommandOptions): DataMatchControls | undefined {
  const minLikelihood = parseMinLikelihood(options.minLikelihood);
  const fields = csvToList(options.fields);
  const require = options.require?.trim() || undefined;
  if (minLikelihood === undefined && !fields && !require) return undefined;
  return { minLikelihood, require, fields };
}

function resolveType(raw: string | undefined): DataType {
  const t = (raw ?? 'person').toLowerCase();
  if (!isDataType(t)) {
    throw new AICliError(
      'validation',
      `--type must be one of: person, org, email (got "${raw}").`,
    );
  }
  if (t === 'email') {
    throw new AICliError(
      'validation',
      'enrich does not support --type email. Did you mean "verify --email" or "lookup --type email"?',
    );
  }
  return t;
}

function buildPersonIdentifiers(options: EnrichCommandOptions): DataPersonIdentifiers {
  const id: DataPersonIdentifiers = {
    email: options.email,
    emailHash: options.emailHash,
    linkedin: options.linkedin,
    phone: options.phone,
    name: options.name,
    firstName: options.firstName,
    lastName: options.lastName,
    middleName: options.middleName,
    company: options.company,
    domain: options.domain,
    providerId: options.providerId,
  };
  const hasAny = Object.values(id).some(Boolean);
  if (!hasAny) {
    throw new AICliError(
      'validation',
      'enrich --type person requires at least one identifier (--email, --linkedin, --phone, --name, --first-name + --last-name, --domain, etc.).',
    );
  }
  return id;
}

function buildOrgIdentifiers(options: EnrichCommandOptions): DataOrgIdentifiers {
  const id: DataOrgIdentifiers = {
    domain: options.domain,
    name: options.name,
    website: options.website,
    ticker: options.ticker,
    linkedin: options.linkedin,
    providerId: options.providerId,
  };
  const hasAny = Object.values(id).some(Boolean);
  if (!hasAny) {
    throw new AICliError(
      'validation',
      'enrich --type org requires at least one identifier (--domain, --name, --website, --ticker, --linkedin).',
    );
  }
  return id;
}

export async function handleEnrichCommand(
  options: EnrichCommandOptions,
  deps: EnrichCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  const type = resolveType(options.type);
  const config = await readMarmotConfig(env);
  const { provider } = resolveDataVerbDefaults('enrich', config, {
    provider: options.provider,
  });
  assertProviderSupportsCell('enrich', type, provider);

  assertProviderEnabled(provider, config);
  const adapter = getDataProviderAdapter(provider);
  const { apiKey, apiSecret } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'enrich', retries);
  const controls = buildMatchControls(options);

  if (type === 'person') {
    if (!adapter.enrichPerson) {
      throw new AICliError(
        'provider',
        `Adapter for "${provider}" declares enrich.person support but the method is missing.`,
      );
    }
    const input: DataEnrichPersonInput = {
      identifiers: buildPersonIdentifiers(options),
      controls,
      apiKey,
      apiSecret,
      fetchFn,
    };
    const { response: result, cached } = await withSpinner(
      `Enriching person via ${provider}…`,
      () =>
        withResponseCache({
          provider,
          verb: 'enrich.person',
          input: { identifiers: input.identifiers, controls: input.controls },
          query: input.identifiers.email ?? input.identifiers.linkedin ?? input.identifiers.name,
          config,
          env,
          noCache: options.cache === false,
          refresh: options.refresh,
          fetcher: () =>
            runWithRetries(
              (abortSignal) => adapter.enrichPerson!({ ...input, abortSignal }),
              { retries, timeoutMs, onRetry },
            ),
        }),
      { stream: stderr, env },
    );
    const envelope = {
      ok: true as const,
      provider: result.provider,
      verb: 'enrich' as const,
      type,
      cached,
      data: options.raw ? null : result.data,
      raw: options.raw ? (result.raw ?? null) : null,
      usage: result.usage ?? null,
      timestamp: new Date().toISOString(),
    };
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return;
  }

  // org
  if (!adapter.enrichOrg) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares enrich.org support but the method is missing.`,
    );
  }
  const input: DataEnrichOrgInput = {
    identifiers: buildOrgIdentifiers(options),
    controls,
    apiKey,
    apiSecret,
    fetchFn,
  };
  const { response: result, cached } = await withSpinner(
    `Enriching org via ${provider}…`,
    () =>
      withResponseCache({
        provider,
        verb: 'enrich.org',
        input: { identifiers: input.identifiers, controls: input.controls },
        query: input.identifiers.domain ?? input.identifiers.name ?? input.identifiers.website,
        config,
        env,
        noCache: options.cache === false,
        refresh: options.refresh,
        fetcher: () =>
          runWithRetries(
            (abortSignal) => adapter.enrichOrg!({ ...input, abortSignal }),
            { retries, timeoutMs, onRetry },
          ),
      }),
    { stream: stderr, env },
  );
  const envelope = {
    ok: true as const,
    provider: result.provider,
    verb: 'enrich' as const,
    type,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    usage: result.usage ?? null,
    timestamp: new Date().toISOString(),
  };
  stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function buildEnrichCommand(deps: EnrichCommandDependencies = {}): Command {
  const cmd = new Command('enrich')
    .description('Enrich a person or org from one or more identifiers.')
    .option('--type <kind>', 'Entity type: person (default) or org.', 'person')
    .option('--provider <slug>', 'Data provider: apollo, hunter, pdl, tomba, datagma.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    // Person + org identifiers
    .option('--email <addr>', 'Email address (person).')
    .option('--email-hash <hash>', 'MD5/SHA-256 hash of email (person, Apollo/PDL).')
    .option('--linkedin <url>', 'LinkedIn URL or handle.')
    .option('--phone <number>', 'Phone number (person).')
    .option('--name <full>', 'Full name (person) or org name.')
    .option('--first-name <first>', 'First name (person).')
    .option('--last-name <last>', 'Last name (person).')
    .option('--middle-name <middle>', 'Middle name (person).')
    .option('--domain <domain>', 'Company/org domain (e.g. acme.com).')
    .option('--company <ref>', 'Employer name, domain, or social URL (person).')
    .option('--website <url>', 'Website URL (org).')
    .option('--ticker <symbol>', 'Stock ticker (org).')
    .option('--provider-id <id>', "Provider's stable id (Apollo id, PDL pdl_id).")
    // Match controls
    .option('--min-likelihood <n>', 'Reject results below this provider-defined likelihood.')
    .option('--require <fields>', 'Comma-separated fields the result must populate.')
    .option('--fields <list>', 'Comma-separated fields to return (payload shaping).')
    // Output
    .option('--raw', "Emit the provider's native response under `raw` instead of normalized data.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .action(async (options: EnrichCommandOptions) => {
      await handleEnrichCommand(options, deps);
    });
  return cmd;
}
