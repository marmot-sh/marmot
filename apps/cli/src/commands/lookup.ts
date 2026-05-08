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
  type DataLookupEmailInput,
  type DataLookupOrgFilters,
  type DataLookupOrgInput,
  type DataLookupPersonFilters,
  type DataLookupPersonInput,
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

export type LookupCommandOptions = {
  type?: string;
  provider?: string;
  apiKey?: string;
  // Common filters
  q?: string;
  limit?: string | number;
  cursor?: string;
  // Person/org filters
  title?: string;
  seniority?: string;
  location?: string;
  domain?: string;
  industry?: string;
  employees?: string;
  tech?: string;
  // Email-only filters
  emailType?: 'personal' | 'generic';
  department?: string;
  company?: string;
  // Output
  raw?: boolean;
  cache?: boolean;
  refresh?: boolean;
  retries?: string | number;
  timeout?: string | number;
  output?: string;
  preset?: string;
  preset_id?: string;
};

export type LookupCommandDependencies = {
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

function parseLimit(s: string | number | undefined): number | undefined {
  if (s === undefined || s === null || s === '') return undefined;
  const n = typeof s === 'number' ? s : Number.parseInt(s, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new AICliError('validation', `--limit must be a positive integer (got "${s}").`);
  }
  return n;
}

function parseEmployees(s: string | undefined): [number, number] | undefined {
  if (!s) return undefined;
  const parts = s.split(',').map((x) => Number.parseInt(x.trim(), 10));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new AICliError(
      'validation',
      `--employees must be "min,max" (got "${s}").`,
    );
  }
  return [parts[0]!, parts[1]!];
}

function resolveType(raw: string | undefined): DataType {
  const t = (raw ?? 'person').toLowerCase();
  if (!isDataType(t)) {
    throw new AICliError(
      'validation',
      `--type must be one of: person, org, email (got "${raw}").`,
    );
  }
  return t;
}

export async function handleLookupCommand(
  options: LookupCommandOptions,
  deps: LookupCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const fetchFn = deps.fetchFn ?? fetch;

  const type = resolveType(options.type);
  const config = await readMarmotConfig(env);
  const { provider } = resolveDataVerbDefaults('lookup', config, {
    provider: options.provider,
  });
  assertProviderSupportsCell('lookup', type, provider);

  assertProviderEnabled(provider, config);
  const adapter = getDataProviderAdapter(provider);
  const { apiKey, apiSecret } = resolveProviderAuth(provider, config, env, {
    apiKey: options.apiKey,
  });
  const { retries, timeoutMs } = resolveRetryOptions({
    retries: options.retries,
    timeout: options.timeout,
  });
  const onRetry = makeRetryNotifier(stderr, provider, 'lookup', retries);
  const limit = parseLimit(options.limit);
  const cursor = options.cursor;

  const baseEnvelope = {
    ok: true as const,
    provider,
    verb: 'lookup' as const,
    type,
    timestamp: new Date().toISOString(),
  };

  // Privacy-safe usage metadata. Filter values (q/title/domain/etc.) are
  // recorded as boolean presence only — they often reveal target identity.
  const usageFlags: Record<string, string | number | boolean> = { type };
  if (limit !== undefined) usageFlags.limit = limit;
  const usagePresence: Record<string, boolean> = {
    q: Boolean(options.q),
    cursor: Boolean(options.cursor),
    title: Boolean(options.title),
    seniority: Boolean(options.seniority),
    location: Boolean(options.location),
    domain: Boolean(options.domain),
    industry: Boolean(options.industry),
    employees: Boolean(options.employees),
    tech: Boolean(options.tech),
    emailType: Boolean(options.emailType),
    department: Boolean(options.department),
    company: Boolean(options.company),
  };
  const sensitiveFlags: Record<string, string> = {};
  for (const k of [
    'q', 'cursor', 'title', 'seniority', 'location', 'domain', 'industry',
    'employees', 'tech', 'emailType', 'department', 'company',
  ] as const) {
    const v = (options as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > 0) sensitiveFlags[k] = v;
  }
  const usageMeta = {
    verb: 'lookup' as const,
    provider,
    preset_id: options.preset_id,
    flags: usageFlags,
    flag_presence: usagePresence,
    session: null,
    sensitive: Object.keys(sensitiveFlags).length > 0 ? { flags: sensitiveFlags } : undefined,
  };

  if (type === 'person') {
    if (!adapter.lookupPerson) {
      throw new AICliError(
        'provider',
        `Adapter for "${provider}" declares lookup.person support but the method is missing.`,
      );
    }
    const filters: DataLookupPersonFilters = {
      title: options.title,
      seniority: options.seniority,
      location: options.location,
      domains: csvToList(options.domain),
      employees: parseEmployees(options.employees),
      industry: options.industry,
      q: options.q,
    };
    const input: DataLookupPersonInput = { filters, limit, cursor, apiKey, apiSecret, fetchFn };
    const { result, cached } = await withUsageLogging(
      config,
      usageMeta,
      async () => {
        const out = await withSpinner(
          `Looking up people via ${provider}…`,
          () =>
            withResponseCache({
              provider,
              verb: 'lookup.person',
              input: { filters, limit, cursor },
              query: filters.q ?? filters.title ?? filters.location,
              config,
              env,
              noCache: options.cache === false,
              refresh: options.refresh,
              fetcher: () =>
                runWithRetries(
                  (abortSignal) => adapter.lookupPerson!({ ...input, abortSignal }),
                  { retries, timeoutMs, onRetry },
                ),
            }),
          { stream: stderr, env },
        );
        return {
          result: out.response,
          cached: out.cached,
          quantity: { results: out.response.data?.results?.length ?? 0 },
          cost: null,
        };
      },
      env,
    );
    await writeEnvelope(stdout, options.output, {
      ...baseEnvelope,
      cached,
      data: options.raw ? null : result.data,
      raw: options.raw ? (result.raw ?? null) : null,
      usage: result.usage ?? null,
    });
    return;
  }

  if (type === 'org') {
    if (!adapter.lookupOrg) {
      throw new AICliError(
        'provider',
        `Adapter for "${provider}" declares lookup.org support but the method is missing.`,
      );
    }
    const filters: DataLookupOrgFilters = {
      domains: csvToList(options.domain),
      employees: parseEmployees(options.employees),
      location: options.location,
      industry: options.industry,
      tech: csvToList(options.tech),
      q: options.q,
    };
    const input: DataLookupOrgInput = { filters, limit, cursor, apiKey, apiSecret, fetchFn };
    const { result, cached } = await withUsageLogging(
      config,
      usageMeta,
      async () => {
        const out = await withSpinner(
          `Looking up orgs via ${provider}…`,
          () =>
            withResponseCache({
              provider,
              verb: 'lookup.org',
              input: { filters, limit, cursor },
              query: filters.q ?? filters.industry ?? filters.location,
              config,
              env,
              noCache: options.cache === false,
              refresh: options.refresh,
              fetcher: () =>
                runWithRetries(
                  (abortSignal) => adapter.lookupOrg!({ ...input, abortSignal }),
                  { retries, timeoutMs, onRetry },
                ),
            }),
          { stream: stderr, env },
        );
        return {
          result: out.response,
          cached: out.cached,
          quantity: { results: out.response.data?.results?.length ?? 0 },
          cost: null,
        };
      },
      env,
    );
    await writeEnvelope(stdout, options.output, {
      ...baseEnvelope,
      cached,
      data: options.raw ? null : result.data,
      raw: options.raw ? (result.raw ?? null) : null,
      usage: result.usage ?? null,
    });
    return;
  }

  // email
  if (!adapter.lookupEmail) {
    throw new AICliError(
      'provider',
      `Adapter for "${provider}" declares lookup.email support but the method is missing.`,
    );
  }
  if (!options.domain && !options.company) {
    throw new AICliError(
      'validation',
      'lookup --type email requires --domain or --company.',
    );
  }
  const input: DataLookupEmailInput = {
    filters: {
      domain: options.domain,
      company: options.company,
      type: options.emailType,
      seniority: options.seniority,
      department: options.department,
    },
    limit,
    cursor,
    apiKey,
    apiSecret,
    fetchFn,
  };
  const { result, cached } = await withUsageLogging(
    config,
    usageMeta,
    async () => {
      const out = await withSpinner(
        `Looking up emails via ${provider}…`,
        () =>
          withResponseCache({
            provider,
            verb: 'lookup.email',
            input: { filters: input.filters, limit, cursor },
            query: input.filters.domain ?? input.filters.company,
            config,
            env,
            noCache: options.cache === false,
            refresh: options.refresh,
            fetcher: () =>
              runWithRetries(
                (abortSignal) => adapter.lookupEmail!({ ...input, abortSignal }),
                { retries, timeoutMs, onRetry },
              ),
          }),
        { stream: stderr, env },
      );
      return {
        result: out.response,
        cached: out.cached,
        quantity: { results: out.response.data?.results?.length ?? 0 },
        cost: null,
      };
    },
    env,
  );
  await writeEnvelope(stdout, options.output, {
    ...baseEnvelope,
    cached,
    data: options.raw ? null : result.data,
    raw: options.raw ? (result.raw ?? null) : null,
    usage: result.usage ?? null,
  });
}

export function buildLookupCommand(deps: LookupCommandDependencies = {}): Command {
  const cmd = new Command('lookup')
    .description('Look up people, orgs, or emails by structured filters.')
    .option('--type <kind>', 'Entity type: person (default), org, or email.', 'person')
    .option('--provider <slug>', 'Data provider: apollo, hunter, pdl, tomba.')
    .option('--api-key <apiKey>', 'Provider API key override.')
    // Common filters
    .option('--q <text>', 'Free-form keyword query.')
    .option('--limit <n>', 'Max results to return (capped per provider).')
    .option('--cursor <token>', 'Pagination cursor (PDL scroll_token, Apollo page).')
    // Person/org filters
    .option('--title <text>', 'Job title (person).')
    .option('--seniority <enum>', 'Seniority level (person/email).')
    .option('--location <text>', 'Geographic location.')
    .option('--domain <csv>', 'Comma-separated company domains (or single domain for emails).')
    .option('--industry <text>', 'Industry filter.')
    .option('--employees <range>', 'Employee count range "min,max" (e.g. 100,500).')
    .option('--tech <csv>', 'Tech-stack tags (org).')
    // Email-only
    .option('--email-type <kind>', 'Email type: personal or generic (email).')
    .option('--department <text>', 'Department filter (email).')
    .option('--company <name>', 'Company name (alternative to --domain for emails).')
    // Output
    .option('--raw', "Emit the provider's native response under `raw` instead of normalized data.")
    .option('--no-cache', 'Bypass the response cache for this call (skip read and write).')
    .option('--refresh', 'Skip cache read but write the fresh response (overwrite any cached entry).')
    .option('--retries <count>', 'Retry failed provider calls up to N times (default: 0).')
    .option('--timeout <seconds>', 'Per-attempt request timeout in seconds (default: 120).')
    .option('-o, --output <path>', 'Write the JSON envelope to a file instead of stdout.')
    .option('--preset <name>', 'Apply a saved lookup preset as defaults (explicit flags still win). Shorthand: @name.')
    .action(async (options: LookupCommandOptions) => {
      const merged = await withPreset(options, 'lookup');
      await handleLookupCommand(merged, deps);
    });
  return cmd;
}
