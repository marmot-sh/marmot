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
import { writeEnvelope } from '../lib/data-verb-io.js';
import { withPreset } from '../lib/with-preset.js';
import { withUsageLogging } from '../lib/usage-recorder.js';
import { resolveSessionBinding } from '../lib/session-binding.js';
import { isDryRun, emitDryRun } from '../lib/dry-run.js';

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
  minLikelihood?: string | number;
  require?: string;
  fields?: string;
  // Output
  raw?: boolean;
  json?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  preset?: string;
  preset_id?: string;
  session?: string;
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

function parseMinLikelihood(s: string | number | undefined): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const n = typeof s === 'number' ? s : Number.parseInt(s, 10);
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
  const sessionBinding = await resolveSessionBinding(options, env);
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

  // Privacy-safe usage metadata. Identifiers (email/linkedin/phone/name)
  // are NEVER recorded by value — only as boolean presence.
  const usageFlags: Record<string, string | number | boolean> = { type };
  if (controls?.minLikelihood !== undefined) usageFlags.min_likelihood = controls.minLikelihood;
  const usagePresence: Record<string, boolean> = {
    email: Boolean(options.email),
    emailHash: Boolean(options.emailHash),
    linkedin: Boolean(options.linkedin),
    phone: Boolean(options.phone),
    name: Boolean(options.name),
    firstName: Boolean(options.firstName),
    lastName: Boolean(options.lastName),
    domain: Boolean(options.domain),
    company: Boolean(options.company),
    website: Boolean(options.website),
    ticker: Boolean(options.ticker),
    providerId: Boolean(options.providerId),
    require: Boolean(options.require),
    fields: Boolean(options.fields),
  };
  // Build the opt-in audit payload — only persisted when
  // logging.recordSensitive is true. Cheap to assemble eagerly; gated by
  // the recorder.
  const sensitiveFlags: Record<string, string> = {};
  for (const k of [
    'email', 'emailHash', 'linkedin', 'phone', 'name', 'firstName', 'lastName',
    'middleName', 'domain', 'company', 'providerId', 'website', 'ticker',
    'require', 'fields',
  ] as const) {
    const v = (options as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > 0) sensitiveFlags[k] = v;
  }
  const usageMeta = {
    verb: 'enrich' as const,
    provider,
    preset_id: options.preset_id,
    flags: usageFlags,
    flag_presence: usagePresence,
    session: sessionBinding?.name ?? null,
    sensitive: Object.keys(sensitiveFlags).length > 0 ? { flags: sensitiveFlags } : undefined,
  };

  if (isDryRun(env)) {
    emitDryRun(
      {
        verb: 'enrich',
        provider,
        request: {
          type,
          ...usagePresence,
          min_likelihood: controls?.minLikelihood,
        },
        retries,
        timeoutMs,
      },
      stdout,
    );
    return;
  }

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
    const { result, cached } = await withUsageLogging(
      config,
      usageMeta,
      async () => {
        const out = await withSpinner(
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
        return {
          result: out.response,
          cached: out.cached,
          quantity: { requests: 1 },
          cost: null,
        };
      },
      env,
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
    await writeEnvelope(stdout, options.output, envelope);
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
  const { result, cached } = await withUsageLogging(
    config,
    usageMeta,
    async () => {
      const out = await withSpinner(
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
      return {
        result: out.response,
        cached: out.cached,
        quantity: { requests: 1 },
        cost: null,
      };
    },
    env,
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
  await writeEnvelope(stdout, options.output, envelope);
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
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('--preset <name>', 'Apply a saved enrich preset as defaults (explicit flags still win). Shorthand: @name.')
    .option('--session <name>', 'Bind this call to a session so it appears in `marmot session show <name>` and filters by session in usage reports.')
    .action(async (options: EnrichCommandOptions) => {
      const merged = await withPreset(options, 'enrich');
      await handleEnrichCommand(merged, deps);
    });
  return cmd;
}
