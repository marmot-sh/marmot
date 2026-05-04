// @marmot-sh/tomba — Tomba adapter.
//
// Backs marmot's enrich (person/org), lookup --type email (domain-search),
// lookup --type org (reveal/search), and verify --type email cells. Hunter
// shape with two-key auth (X-Tomba-Key + X-Tomba-Secret).

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
  type DataLookupOrgInput,
  type DataLookupOrgResult,
  type DataNormalizedOrg,
  type DataNormalizedPerson,
  type DataProviderAdapter,
  type DataVerifyEmailInput,
  type DataVerifyEmailResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'tomba' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.tomba;

type TombaEmail = {
  email?: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  position?: string | null;
  department?: string | null;
  seniority?: string | null;
  type?: 'personal' | 'generic' | null;
  score?: number | null;
  linkedin?: string | null;
  twitter?: string | null;
  phone_number?: string | null;
  verification?: { date?: string | null; status?: string | null } | null;
  disposable?: boolean | null;
  webmail?: boolean | null;
  accept_all?: boolean | null;
};

type TombaOrganization = {
  organization?: string | null;
  website_url?: string | null;
  industries?: string | null;
  founded?: number | string | null;
  company_size?: string | null;
  description?: string | null;
  pattern?: string | null;
  accept_all?: boolean | null;
  total_emails?: number | null;
  location?: { country?: string | null; city?: string | null; state?: string | null } | null;
  social_links?: { linkedin?: string | null; twitter?: string | null } | null;
};

type TombaCombinedPerson = {
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
    seniority?: string | null;
  };
  twitter?: { handle?: string | null } | null;
  linkedin?: { handle?: string | null } | null;
  github?: { handle?: string | null } | null;
};

type TombaCombinedCompany = {
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

type TombaCombinedResponse = {
  data?: {
    person?: TombaCombinedPerson | null;
    company?: TombaCombinedCompany | null;
  };
};

type TombaEmailFinderResponse = {
  data?: {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    full_name?: string | null;
    score?: number | null;
    domain?: string | null;
    company?: string | null;
    position?: string | null;
    linkedin?: string | null;
    phone_number?: string | null;
    accept_all?: boolean | null;
    verification?: { status?: string | null } | null;
  };
};

type TombaDomainSearchResponse = {
  data?: {
    organization?: TombaOrganization;
    emails?: TombaEmail[];
  };
  meta?: { total?: number; current?: number; total_pages?: number; pageSize?: number };
};

type TombaCompaniesFindResponse = {
  data?: TombaCombinedCompany;
};

type TombaVerifierResponse = {
  data?: {
    email?: {
      status?: string;
      result?: string;
      score?: number | null;
      email?: string;
      regex?: boolean;
      gibberish?: boolean;
      disposable?: boolean;
      webmail?: boolean;
      mx?: boolean;
      mx_check?: boolean;
      smtp_server?: boolean;
      smtp_check?: boolean;
      accept_all?: boolean;
      block?: boolean;
    };
  };
};

type TombaRevealCompany = {
  name?: string | null;
  description?: string | null;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  industry?: string | null;
  company_size?: string | null;
  founded?: number | string | null;
  website_url?: string | null;
  total_emails?: number | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
};

type TombaRevealResponse = {
  data?: { companies?: TombaRevealCompany[] };
  meta?: { total?: number; page?: number; total_pages?: number };
};

function authError(): AICliError {
  return new AICliError(
    'auth',
    'Tomba requires --api-key (TOMBA_API_KEY) and TOMBA_SECRET_KEY in the environment.',
  );
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

function tombaHeaders(apiKey: string, apiSecret: string): Record<string, string> {
  return {
    'X-Tomba-Key': apiKey,
    'X-Tomba-Secret': apiSecret,
    accept: 'application/json',
  };
}

async function tombaGet(
  path: string,
  params: URLSearchParams,
  apiKey: string,
  apiSecret: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  const url = `${BASE_URL}${path}?${params.toString()}`;
  try {
    return await fetchFn(url, {
      headers: tombaHeaders(apiKey, apiSecret),
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Tomba ${path} request failed.`);
  }
}

async function tombaPost(
  path: string,
  body: unknown,
  apiKey: string,
  apiSecret: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetchFn(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        ...tombaHeaders(apiKey, apiSecret),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Tomba ${path} request failed.`);
  }
}

function ensureCreds(input: { apiKey?: string; apiSecret?: string }): {
  apiKey: string;
  apiSecret: string;
} {
  if (!input.apiKey || !input.apiSecret) throw authError();
  return { apiKey: input.apiKey, apiSecret: input.apiSecret };
}

function normalizeCombinedOrg(c: TombaCombinedCompany | undefined | null): DataNormalizedOrg | null {
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
  p: TombaCombinedPerson,
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

function joinLocationParts(o: TombaRevealCompany): string | null {
  const parts = [o.city, o.state, o.country].filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(', ') : null;
}

function normalizeRevealOrg(o: TombaRevealCompany): DataNormalizedOrg {
  const founded =
    typeof o.founded === 'number'
      ? o.founded
      : typeof o.founded === 'string' && /^\d+$/.test(o.founded)
        ? Number.parseInt(o.founded, 10)
        : null;
  return {
    name: o.name ?? null,
    domain: o.website_url ?? null,
    description: o.description ?? null,
    industry: o.industry ?? null,
    headcount: null,
    headcountRange: o.company_size ?? null,
    foundedYear: founded,
    location: joinLocationParts(o),
    linkedin: o.linkedin_url ?? null,
    twitter: o.twitter_url ?? null,
    providerId: null,
  };
}

// -- enrichPerson ------------------------------------------------------------

async function tombaEnrichPerson(
  input: DataEnrichPersonInput,
): Promise<DataEnrichPersonResult> {
  const { apiKey, apiSecret } = ensureCreds(input);
  const fetchFn = input.fetchFn ?? fetch;
  const id = input.identifiers;

  if (id.email) {
    const params = new URLSearchParams({ email: id.email });
    const response = await tombaGet('/combined/find', params, apiKey, apiSecret, fetchFn, input.abortSignal);

    if (response.status === 404) {
      const raw = await response.json().catch(() => null);
      return { provider: 'tomba', data: { person: null }, raw };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AICliError(
        categoryFor(response.status),
        `Tomba combined/find failed with status ${response.status}. ${text.slice(0, 400)}`,
      );
    }
    const payload = (await response.json()) as TombaCombinedResponse;
    if (!payload.data?.person) {
      return { provider: 'tomba', data: { person: null }, raw: payload };
    }
    const org = normalizeCombinedOrg(payload.data.company);
    const person = normalizeCombinedPerson(payload.data.person, org);
    return { provider: 'tomba', data: { person }, raw: payload };
  }

  const domain = id.domain ?? id.company;
  if (id.firstName && id.lastName && domain) {
    const params = new URLSearchParams({
      domain,
      first_name: id.firstName,
      last_name: id.lastName,
    });
    const response = await tombaGet('/email-finder', params, apiKey, apiSecret, fetchFn, input.abortSignal);

    if (response.status === 404) {
      const raw = await response.json().catch(() => null);
      return { provider: 'tomba', data: { person: null }, raw };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AICliError(
        categoryFor(response.status),
        `Tomba email-finder failed with status ${response.status}. ${text.slice(0, 400)}`,
      );
    }
    const payload = (await response.json()) as TombaEmailFinderResponse;
    const d = payload.data;
    if (!d?.email) {
      return { provider: 'tomba', data: { person: null }, raw: payload };
    }
    const fullName =
      d.full_name ?? ([d.first_name, d.last_name].filter(Boolean).join(' ') || null);
    const person: DataNormalizedPerson = {
      fullName,
      firstName: d.first_name ?? null,
      lastName: d.last_name ?? null,
      email: d.email ?? null,
      // Tomba's free tier returns `phone_number: true` as a presence flag
      // when an actual phone is gated behind a paid plan. Coerce non-string
      // values to null so the envelope's contract (`phone: string | null`)
      // is honest at runtime.
      phone: typeof d.phone_number === 'string' && d.phone_number ? d.phone_number : null,
      linkedin: d.linkedin ?? null,
      twitter: null,
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
    return { provider: 'tomba', data: { person }, raw: payload };
  }

  throw new AICliError(
    'validation',
    'Tomba enrich-person requires --email or (--first-name + --last-name + --domain).',
  );
}

// -- enrichOrg ---------------------------------------------------------------

async function tombaEnrichOrg(input: DataEnrichOrgInput): Promise<DataEnrichOrgResult> {
  const { apiKey, apiSecret } = ensureCreds(input);
  const fetchFn = input.fetchFn ?? fetch;
  const domain = input.identifiers.domain ?? input.identifiers.website;
  if (!domain) {
    throw new AICliError('validation', 'Tomba enrich-org requires --domain.');
  }
  const params = new URLSearchParams({ domain });
  const response = await tombaGet('/companies/find', params, apiKey, apiSecret, fetchFn, input.abortSignal);

  if (response.status === 404) {
    const raw = await response.json().catch(() => null);
    return { provider: 'tomba', data: { org: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Tomba companies/find failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as TombaCompaniesFindResponse;
  return { provider: 'tomba', data: { org: normalizeCombinedOrg(payload.data) }, raw: payload };
}

// -- lookupEmail (domain-search) --------------------------------------------

async function tombaLookupEmail(
  input: DataLookupEmailInput,
): Promise<DataLookupEmailResult> {
  const { apiKey, apiSecret } = ensureCreds(input);
  const fetchFn = input.fetchFn ?? fetch;
  const f = input.filters;

  const params = new URLSearchParams();
  if (f.domain) params.set('domain', f.domain);
  else if (f.company) params.set('company', f.company);
  else throw new AICliError('validation', 'Tomba lookup-email requires --domain or --company.');

  if (typeof input.limit === 'number') params.set('limit', String(Math.min(input.limit, 100)));
  if (input.cursor) params.set('page', input.cursor);
  if (f.type) params.set('type', f.type);
  if (f.seniority) params.set('seniority', f.seniority);
  if (f.department) params.set('department', f.department);

  const response = await tombaGet('/domain-search', params, apiKey, apiSecret, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Tomba domain-search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as TombaDomainSearchResponse;
  const emails = payload.data?.emails ?? [];
  const results: DataEmailRecord[] = emails.map((e) => ({
    email: e.email ?? '',
    firstName: e.first_name ?? null,
    lastName: e.last_name ?? null,
    fullName:
      e.full_name ?? ([e.first_name, e.last_name].filter(Boolean).join(' ') || null),
    title: e.position ?? null,
    seniority: e.seniority ?? null,
    department: e.department ?? null,
    type: e.type ?? null,
    confidence: typeof e.score === 'number' ? e.score : null,
    verificationStatus: e.verification?.status ?? null,
  }));

  const total = payload.meta?.total ?? null;
  const currentPage = payload.meta?.current ?? 1;
  const totalPages = payload.meta?.total_pages ?? null;
  const nextCursor =
    totalPages !== null && currentPage < totalPages ? String(currentPage + 1) : null;

  return {
    provider: 'tomba',
    data: {
      results,
      domain: payload.data?.organization?.website_url ?? null,
      pattern: payload.data?.organization?.pattern ?? null,
      acceptAll: payload.data?.organization?.accept_all ?? null,
      total,
      nextCursor,
    },
    raw: payload,
  };
}

// -- lookupOrg (reveal/search) ----------------------------------------------

async function tombaLookupOrg(input: DataLookupOrgInput): Promise<DataLookupOrgResult> {
  const { apiKey, apiSecret } = ensureCreds(input);
  const fetchFn = input.fetchFn ?? fetch;
  const f = input.filters;

  const filters: Record<string, { include?: string[]; exclude?: string[] }> = {};
  if (f.domains?.length) filters.company = { include: f.domains };
  if (f.location) filters.location_country = { include: [f.location] };
  if (f.industry) filters.industry = { include: [f.industry] };
  if (f.tech?.length) filters.technologies = { include: f.tech };
  if (f.employees) {
    // Tomba's `size` filter uses banded strings; map [min,max] to a single range
    // expressed in the canonical "min-max" form Tomba accepts.
    filters.size = { include: [`${f.employees[0]}-${f.employees[1]}`] };
  }

  const body: Record<string, unknown> = {};
  if (f.q) body.query = f.q;
  if (Object.keys(filters).length > 0) body.filters = filters;
  if (input.cursor) body.page = Number(input.cursor);

  const hasFilter = Boolean(f.q) || Object.keys(filters).length > 0;
  if (!hasFilter) {
    throw new AICliError(
      'validation',
      'Tomba reveal/search requires at least one filter (q, domains, location, industry, tech, employees).',
    );
  }

  const response = await tombaPost('/reveal/search', body, apiKey, apiSecret, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Tomba reveal/search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as TombaRevealResponse;
  const results = (payload.data?.companies ?? []).map(normalizeRevealOrg);
  const total = payload.meta?.total ?? null;
  const page = payload.meta?.page ?? 1;
  const totalPages = payload.meta?.total_pages ?? null;
  const nextCursor = totalPages !== null && page < totalPages ? String(page + 1) : null;

  return {
    provider: 'tomba',
    data: { results, total, nextCursor },
    raw: payload,
  };
}

// -- verifyEmail -------------------------------------------------------------

async function tombaVerifyEmail(
  input: DataVerifyEmailInput,
): Promise<DataVerifyEmailResult> {
  const { apiKey, apiSecret } = ensureCreds(input);
  const fetchFn = input.fetchFn ?? fetch;
  const params = new URLSearchParams({ email: input.email });

  const response = await tombaGet('/email-verifier', params, apiKey, apiSecret, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Tomba email-verifier failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as TombaVerifierResponse;
  const e = payload.data?.email;
  if (!e) {
    throw new AICliError('provider', 'Tomba email-verifier returned no email payload.');
  }
  const status = (e.status ?? 'unknown').toLowerCase();
  return {
    provider: 'tomba',
    data: {
      email: e.email ?? input.email,
      deliverable: status === 'valid' || status === 'accept_all',
      status,
      score: typeof e.score === 'number' ? e.score : null,
      checks: {
        regexp: e.regex ?? null,
        mxRecords: e.mx ?? e.mx_check ?? null,
        smtpServer: e.smtp_server ?? null,
        smtpCheck: e.smtp_check ?? null,
        acceptAll: e.accept_all ?? null,
        disposable: e.disposable ?? null,
        webmail: e.webmail ?? null,
        gibberish: e.gibberish ?? null,
        block: e.block ?? null,
      },
    },
    raw: payload,
  };
}

export const tombaAdapter: DataProviderAdapter = {
  slug: 'tomba',
  name: 'Tomba',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: true,
    enrichOrg: true,
    lookupPerson: false,
    lookupOrg: true,
    lookupEmail: true,
    verifyEmail: true,
  },
  enrichPerson: tombaEnrichPerson,
  enrichOrg: tombaEnrichOrg,
  lookupOrg: tombaLookupOrg,
  lookupEmail: tombaLookupEmail,
  verifyEmail: tombaVerifyEmail,
};
