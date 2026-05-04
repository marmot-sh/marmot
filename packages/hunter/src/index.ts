// @marmot-sh/hunter — Hunter adapter.
//
// Backs marmot's enrich (person/org), lookup --type email (domain-search),
// and verify --email (email-verifier with 202 polling) verbs.

import {
  AICliError,
  DATA_PROVIDER_BASE_URLS,
  toAICliError,
  type DataEmailRecord,
  type DataEnrichOrgInput,
  type DataEnrichOrgResult,
  type DataEnrichPersonInput,
  type DataEnrichPersonResult,
  type DataLookupEmailInput,
  type DataLookupEmailResult,
  type DataNormalizedOrg,
  type DataNormalizedPerson,
  type DataProviderAdapter,
  type DataVerifyEmailInput,
  type DataVerifyEmailResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'hunter' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.hunter;

type HunterCombinedPerson = {
  id?: string;
  name?: { fullName?: string | null; givenName?: string | null; familyName?: string | null };
  email?: string | null;
  location?: string | null;
  bio?: string | null;
  employment?: {
    domain?: string | null;
    name?: string | null;
    title?: string | null;
    role?: string | null;
    subRole?: string | null;
    seniority?: string | null;
  };
  twitter?: { handle?: string | null } | null;
  linkedin?: { handle?: string | null } | null;
  github?: { handle?: string | null } | null;
};

type HunterCombinedCompany = {
  id?: string;
  name?: string | null;
  legalName?: string | null;
  domain?: string | null;
  description?: string | null;
  category?: { industry?: string | null } | null;
  foundedYear?: number | null;
  location?: string | null;
  metrics?: { employees?: number | null; employeesRange?: string | null } | null;
  linkedin?: { handle?: string | null } | null;
  twitter?: { handle?: string | null } | null;
};

type HunterCombinedResponse = {
  data?: {
    person?: HunterCombinedPerson | null;
    company?: HunterCombinedCompany | null;
  };
  errors?: Array<{ id?: string; code?: number; details?: string }>;
};

type HunterEmailFinderResponse = {
  data?: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    score?: number | null;
    domain?: string | null;
    accept_all?: boolean | null;
    position?: string | null;
    company?: string | null;
    twitter?: string | null;
    linkedin_url?: string | null;
    phone_number?: string | null;
    verification?: { date?: string | null; status?: string | null } | null;
  };
};

type HunterDomainSearchEmail = {
  value?: string | null;
  type?: 'personal' | 'generic' | null;
  confidence?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  seniority?: string | null;
  department?: string | null;
  verification?: { status?: string | null } | null;
};

type HunterDomainSearchResponse = {
  data?: {
    domain?: string | null;
    pattern?: string | null;
    accept_all?: boolean | null;
    organization?: string | null;
    emails?: HunterDomainSearchEmail[] | null;
  };
  meta?: { results?: number };
};

type HunterCompaniesFindResponse = {
  data?: HunterCombinedCompany;
};

type HunterVerifierResponse = {
  data?: {
    status?: string;
    result?: string;
    score?: number | null;
    email?: string;
    regexp?: boolean;
    gibberish?: boolean;
    disposable?: boolean;
    webmail?: boolean;
    mx_records?: boolean;
    smtp_server?: boolean;
    smtp_check?: boolean;
    accept_all?: boolean;
    block?: boolean;
  };
};

function authError(): AICliError {
  return new AICliError('auth', 'Hunter requires --api-key or HUNTER_API_KEY.');
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

async function hunterGet(
  path: string,
  params: URLSearchParams,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  const url = `${BASE_URL}${path}?${params.toString()}`;
  try {
    return await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        accept: 'application/json',
      },
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Hunter ${path} request failed.`);
  }
}

function normalizeCombinedOrg(c: HunterCombinedCompany | undefined | null): DataNormalizedOrg | null {
  if (!c) return null;
  return {
    name: c.name ?? c.legalName ?? null,
    domain: c.domain ?? null,
    description: c.description ?? null,
    industry: c.category?.industry ?? null,
    headcount: c.metrics?.employees ?? null,
    headcountRange: c.metrics?.employeesRange ?? null,
    foundedYear: c.foundedYear ?? null,
    location: c.location ?? null,
    linkedin: c.linkedin?.handle ? `https://linkedin.com/${c.linkedin.handle}` : null,
    twitter: c.twitter?.handle ?? null,
    providerId: c.id ?? null,
  };
}

function normalizeCombinedPerson(
  p: HunterCombinedPerson,
  org: DataNormalizedOrg | null,
): DataNormalizedPerson {
  return {
    fullName: p.name?.fullName ?? null,
    firstName: p.name?.givenName ?? null,
    lastName: p.name?.familyName ?? null,
    email: p.email ?? null,
    phone: null,
    linkedin: p.linkedin?.handle ? `https://linkedin.com/${p.linkedin.handle}` : null,
    twitter: p.twitter?.handle ?? null,
    github: p.github?.handle ?? null,
    title: p.employment?.title ?? null,
    seniority: p.employment?.seniority ?? null,
    department: p.employment?.role ?? null,
    providerId: p.id ?? null,
    confidence: null,
    location: p.location ?? null,
    org,
  };
}

// -- enrichPerson ------------------------------------------------------------

async function hunterEnrichPerson(
  input: DataEnrichPersonInput,
): Promise<DataEnrichPersonResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const id = input.identifiers;

  if (id.email) {
    const params = new URLSearchParams({ email: id.email });
    const response = await hunterGet('/combined/find', params, input.apiKey, fetchFn, input.abortSignal);

    if (response.status === 404) {
      const raw = await response.json().catch(() => null);
      return { provider: 'hunter', data: { person: null }, raw };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AICliError(
        categoryFor(response.status),
        `Hunter combined/find failed with status ${response.status}. ${text.slice(0, 400)}`,
      );
    }
    const payload = (await response.json()) as HunterCombinedResponse;
    if (!payload.data?.person) {
      return { provider: 'hunter', data: { person: null }, raw: payload };
    }
    const org = normalizeCombinedOrg(payload.data.company);
    const person = normalizeCombinedPerson(payload.data.person, org);
    return { provider: 'hunter', data: { person }, raw: payload };
  }

  // Fall back to email-finder when caller has name + domain only.
  const domain = id.domain ?? id.company;
  if (id.firstName && id.lastName && domain) {
    const params = new URLSearchParams({
      domain,
      first_name: id.firstName,
      last_name: id.lastName,
    });
    const response = await hunterGet('/email-finder', params, input.apiKey, fetchFn, input.abortSignal);

    if (response.status === 404) {
      const raw = await response.json().catch(() => null);
      return { provider: 'hunter', data: { person: null }, raw };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AICliError(
        categoryFor(response.status),
        `Hunter email-finder failed with status ${response.status}. ${text.slice(0, 400)}`,
      );
    }
    const payload = (await response.json()) as HunterEmailFinderResponse;
    const d = payload.data;
    if (!d?.email) {
      return { provider: 'hunter', data: { person: null }, raw: payload };
    }
    const fullName = [d.first_name, d.last_name].filter(Boolean).join(' ') || null;
    const person: DataNormalizedPerson = {
      fullName,
      firstName: d.first_name ?? null,
      lastName: d.last_name ?? null,
      email: d.email ?? null,
      phone: d.phone_number ?? null,
      linkedin: d.linkedin_url ?? null,
      twitter: d.twitter ?? null,
      title: d.position ?? null,
      seniority: null,
      department: null,
      providerId: null,
      confidence: typeof d.score === 'number' ? d.score : null,
      location: null,
      org: d.domain
        ? {
            name: d.company ?? null,
            domain: d.domain,
            description: null,
            industry: null,
            headcount: null,
            headcountRange: null,
            foundedYear: null,
            location: null,
            linkedin: null,
            providerId: null,
          }
        : null,
    };
    return { provider: 'hunter', data: { person }, raw: payload };
  }

  throw new AICliError(
    'validation',
    'Hunter enrich-person requires --email or (--first-name + --last-name + --domain).',
  );
}

// -- enrichOrg ---------------------------------------------------------------

async function hunterEnrichOrg(input: DataEnrichOrgInput): Promise<DataEnrichOrgResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const domain = input.identifiers.domain ?? input.identifiers.website;
  if (!domain) {
    throw new AICliError(
      'validation',
      'Hunter enrich-org requires --domain.',
    );
  }
  const params = new URLSearchParams({ domain });
  const response = await hunterGet('/companies/find', params, input.apiKey, fetchFn, input.abortSignal);

  if (response.status === 404) {
    const raw = await response.json().catch(() => null);
    return { provider: 'hunter', data: { org: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Hunter companies/find failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as HunterCompaniesFindResponse;
  const org = normalizeCombinedOrg(payload.data);
  return { provider: 'hunter', data: { org }, raw: payload };
}

// -- lookupEmail (domain-search) --------------------------------------------

async function hunterLookupEmail(
  input: DataLookupEmailInput,
): Promise<DataLookupEmailResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const f = input.filters;

  const params = new URLSearchParams();
  if (f.domain) params.set('domain', f.domain);
  else if (f.company) params.set('company', f.company);
  else throw new AICliError('validation', 'Hunter lookup-email requires --domain or --company.');

  if (typeof input.limit === 'number') params.set('limit', String(Math.min(input.limit, 100)));
  if (input.cursor) params.set('offset', input.cursor);
  if (f.type) params.set('type', f.type);
  if (f.seniority) params.set('seniority', f.seniority);
  if (f.department) params.set('department', f.department);

  const response = await hunterGet('/domain-search', params, input.apiKey, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Hunter domain-search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as HunterDomainSearchResponse;
  const emails = payload.data?.emails ?? [];
  const results: DataEmailRecord[] = emails.map((e) => {
    const fullName = [e.first_name, e.last_name].filter(Boolean).join(' ') || null;
    return {
      email: e.value ?? '',
      firstName: e.first_name ?? null,
      lastName: e.last_name ?? null,
      fullName,
      title: e.position ?? null,
      seniority: e.seniority ?? null,
      department: e.department ?? null,
      type: e.type ?? null,
      confidence: typeof e.confidence === 'number' ? e.confidence : null,
      verificationStatus: e.verification?.status ?? null,
    };
  });

  const limit = Number(params.get('limit') ?? 10);
  const offset = Number(params.get('offset') ?? 0);
  const total = payload.meta?.results ?? null;
  const nextCursor =
    total !== null && offset + emails.length < total
      ? String(offset + limit)
      : null;

  return {
    provider: 'hunter',
    data: {
      results,
      domain: payload.data?.domain ?? null,
      pattern: payload.data?.pattern ?? null,
      acceptAll: payload.data?.accept_all ?? null,
      total,
      nextCursor,
    },
    raw: payload,
  };
}

// -- verifyEmail (with 202 polling) -----------------------------------------

const VERIFIER_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

async function hunterVerifyEmail(
  input: DataVerifyEmailInput,
): Promise<DataVerifyEmailResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const params = new URLSearchParams({ email: input.email });

  const start = Date.now();
  const deadline = start + 30_000;

  let payload: HunterVerifierResponse | null = null;
  let lastResponse: Response | null = null;
  for (let attempt = 0; ; attempt += 1) {
    const response = await hunterGet('/email-verifier', params, input.apiKey, fetchFn, input.abortSignal);
    lastResponse = response;
    if (!response.ok && response.status !== 202) {
      const text = await response.text().catch(() => '');
      throw new AICliError(
        categoryFor(response.status),
        `Hunter email-verifier failed with status ${response.status}. ${text.slice(0, 400)}`,
      );
    }
    payload = (await response.json()) as HunterVerifierResponse;
    const status = (payload.data?.status ?? 'unknown').toLowerCase();
    if (response.status !== 202 && status !== 'unknown') break;
    if (Date.now() >= deadline) break;
    const delay = VERIFIER_BACKOFF_MS[Math.min(attempt, VERIFIER_BACKOFF_MS.length - 1)];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, delay);
      input.abortSignal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new AICliError('network', 'Hunter email-verifier was cancelled.'));
        },
        { once: true },
      );
    });
  }

  if (!payload?.data) {
    throw new AICliError(
      'provider',
      `Hunter email-verifier returned no data (last status ${lastResponse?.status}).`,
    );
  }

  const d = payload.data;
  const status = (d.status ?? 'unknown').toLowerCase();
  return {
    provider: 'hunter',
    data: {
      email: d.email ?? input.email,
      deliverable: status === 'valid' || status === 'accept_all',
      status,
      score: typeof d.score === 'number' ? d.score : null,
      checks: {
        regexp: d.regexp ?? null,
        mxRecords: d.mx_records ?? null,
        smtpServer: d.smtp_server ?? null,
        smtpCheck: d.smtp_check ?? null,
        acceptAll: d.accept_all ?? null,
        disposable: d.disposable ?? null,
        webmail: d.webmail ?? null,
        gibberish: d.gibberish ?? null,
        block: d.block ?? null,
      },
    },
    raw: payload,
  };
}

export const hunterAdapter: DataProviderAdapter = {
  slug: 'hunter',
  name: 'Hunter',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: true,
    enrichOrg: true,
    lookupPerson: false,
    lookupOrg: false,
    lookupEmail: true,
    verifyEmail: true,
  },
  enrichPerson: hunterEnrichPerson,
  enrichOrg: hunterEnrichOrg,
  lookupEmail: hunterLookupEmail,
  verifyEmail: hunterVerifyEmail,
};
