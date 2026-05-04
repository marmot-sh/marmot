// @marmot-sh/pdl — People Data Labs adapter.
//
// Backs marmot's enrich + lookup verbs for person and org against the v5 graph.
// PDL has no email-only verbs and no email verification; those go through Hunter.

import {
  AICliError,
  DATA_PROVIDER_BASE_URLS,
  toAICliError,
  type DataEnrichOrgInput,
  type DataEnrichOrgResult,
  type DataEnrichPersonInput,
  type DataEnrichPersonResult,
  type DataLookupOrgInput,
  type DataLookupOrgResult,
  type DataLookupPersonInput,
  type DataLookupPersonResult,
  type DataMatchControls,
  type DataNormalizedOrg,
  type DataNormalizedPerson,
  type DataProviderAdapter,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'pdl' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.pdl;

type PdlPerson = {
  id?: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  github_url?: string | null;
  work_email?: string | null;
  personal_emails?: string[] | null;
  emails?: Array<{ address?: string }> | null;
  mobile_phone?: string | null;
  phone_numbers?: string[] | null;
  job_title?: string | null;
  job_title_role?: string | null;
  job_title_sub_role?: string | null;
  job_title_levels?: string[] | null;
  job_company_name?: string | null;
  job_company_website?: string | null;
  job_company_industry?: string | null;
  job_company_employee_count?: number | null;
  job_company_linkedin_url?: string | null;
  job_company_id?: string | null;
  location_name?: string | null;
};

type PdlCompany = {
  id?: string;
  name?: string | null;
  website?: string | null;
  industry?: string | null;
  summary?: string | null;
  employee_count?: number | null;
  size?: string | null;
  founded?: number | null;
  location?: { name?: string | null } | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  tags?: string[] | null;
};

type PdlEnrichResponse<T> = {
  status?: number;
  likelihood?: number;
  data?: T;
  error?: { type?: string; message?: string };
};

type PdlSearchResponse<T> = {
  status?: number;
  total?: number;
  data?: T[];
  scroll_token?: string;
  error?: { type?: string; message?: string };
};

function authError(): AICliError {
  return new AICliError('auth', 'PDL requires --api-key or PDL_API_KEY.');
}

function applyMatchControls(
  params: URLSearchParams,
  controls: DataMatchControls | undefined,
): void {
  if (!controls) return;
  if (typeof controls.minLikelihood === 'number') {
    params.set('min_likelihood', String(controls.minLikelihood));
  }
  if (controls.require) {
    params.set('required', controls.require);
  }
  if (controls.fields?.length) {
    params.set('data_include', controls.fields.join(','));
  }
}

async function pdlGet(
  path: string,
  params: URLSearchParams,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  const url = `${BASE_URL}${path}?${params.toString()}`;
  try {
    return await fetchFn(url, {
      headers: { 'X-API-Key': apiKey, accept: 'application/json' },
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `PDL ${path} request failed.`);
  }
}

async function pdlPost(
  path: string,
  body: unknown,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetchFn(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `PDL ${path} request failed.`);
  }
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

function normalizePerson(p: PdlPerson): DataNormalizedPerson {
  const orgPresent = Boolean(p.job_company_name ?? p.job_company_website);
  const org: DataNormalizedOrg | null = orgPresent
    ? {
        name: p.job_company_name ?? null,
        domain: p.job_company_website ?? null,
        description: null,
        industry: p.job_company_industry ?? null,
        headcount: p.job_company_employee_count ?? null,
        headcountRange: null,
        foundedYear: null,
        location: null,
        linkedin: p.job_company_linkedin_url ?? null,
        providerId: p.job_company_id ?? null,
      }
    : null;

  const seniority = p.job_title_levels?.[0] ?? null;
  const department = p.job_title_role ?? null;
  const allEmails = [
    ...(p.work_email ? [p.work_email] : []),
    ...(p.personal_emails ?? []),
    ...(p.emails ?? []).map((e) => e.address).filter((s): s is string => Boolean(s)),
  ];
  const phone = p.mobile_phone ?? p.phone_numbers?.[0] ?? null;

  return {
    fullName: p.full_name ?? null,
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    email: allEmails[0] ?? null,
    emails: allEmails.length ? Array.from(new Set(allEmails)) : undefined,
    phone,
    linkedin: p.linkedin_url ?? null,
    twitter: p.twitter_url ?? null,
    github: p.github_url ?? null,
    title: p.job_title ?? null,
    seniority,
    department,
    providerId: p.id ?? null,
    confidence: null,
    location: p.location_name ?? null,
    org,
  };
}

function normalizeOrg(c: PdlCompany): DataNormalizedOrg {
  return {
    name: c.name ?? null,
    domain: c.website ?? null,
    description: c.summary ?? null,
    industry: c.industry ?? null,
    headcount: c.employee_count ?? null,
    headcountRange: c.size ?? null,
    foundedYear: c.founded ?? null,
    location: c.location?.name ?? null,
    linkedin: c.linkedin_url ?? null,
    twitter: c.twitter_url ?? null,
    providerId: c.id ?? null,
  };
}

// -- enrichPerson ------------------------------------------------------------

async function pdlEnrichPerson(
  input: DataEnrichPersonInput,
): Promise<DataEnrichPersonResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const id = input.identifiers;

  const params = new URLSearchParams();
  if (id.email) params.set('email', id.email);
  if (id.emailHash) params.set('email_hash', id.emailHash);
  if (id.linkedin) params.set('profile', id.linkedin);
  if (id.linkedinId) params.set('lid', id.linkedinId);
  if (id.phone) params.set('phone', id.phone);
  if (id.name) params.set('name', id.name);
  if (id.firstName) params.set('first_name', id.firstName);
  if (id.lastName) params.set('last_name', id.lastName);
  if (id.middleName) params.set('middle_name', id.middleName);
  if (id.company ?? id.domain) params.set('company', id.company ?? id.domain ?? '');
  if (id.providerId) params.set('pdl_id', id.providerId);
  applyMatchControls(params, input.controls);

  if (![...params.keys()].some((k) => k !== 'min_likelihood' && k !== 'required' && k !== 'data_include')) {
    throw new AICliError(
      'validation',
      'PDL enrich requires at least one identifier (email, linkedin, phone, name+company, etc.).',
    );
  }

  const response = await pdlGet('/person/enrich', params, input.apiKey, fetchFn, input.abortSignal);

  if (response.status === 404) {
    const raw = await response.json().catch(() => null);
    return { provider: 'pdl', data: { person: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `PDL person/enrich failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as PdlEnrichResponse<PdlPerson>;
  if (!payload.data) {
    return { provider: 'pdl', data: { person: null }, raw: payload };
  }
  const person = normalizePerson(payload.data);
  if (typeof payload.likelihood === 'number') {
    person.confidence = Math.min(100, Math.max(0, Math.round(payload.likelihood * 10)));
  }
  return { provider: 'pdl', data: { person }, raw: payload };
}

// -- enrichOrg ---------------------------------------------------------------

async function pdlEnrichOrg(input: DataEnrichOrgInput): Promise<DataEnrichOrgResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const id = input.identifiers;

  const params = new URLSearchParams();
  if (id.providerId) params.set('pdl_id', id.providerId);
  if (id.website ?? id.domain) params.set('website', id.website ?? id.domain ?? '');
  if (id.name) params.set('name', id.name);
  if (id.linkedin) params.set('profile', id.linkedin);
  if (id.ticker) params.set('ticker', id.ticker);
  applyMatchControls(params, input.controls);

  if (!params.has('pdl_id') && !params.has('website') && !params.has('name') && !params.has('profile') && !params.has('ticker')) {
    throw new AICliError(
      'validation',
      'PDL company/enrich requires at least one of: domain, website, name, linkedin, ticker.',
    );
  }

  const response = await pdlGet('/company/enrich', params, input.apiKey, fetchFn, input.abortSignal);

  if (response.status === 404) {
    const raw = await response.json().catch(() => null);
    return { provider: 'pdl', data: { org: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `PDL company/enrich failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as PdlEnrichResponse<PdlCompany>;
  if (!payload.data) {
    return { provider: 'pdl', data: { org: null }, raw: payload };
  }
  return { provider: 'pdl', data: { org: normalizeOrg(payload.data) }, raw: payload };
}

// -- lookupPerson ------------------------------------------------------------

function buildPersonSearchQuery(input: DataLookupPersonInput): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [];
  const f = input.filters;
  if (f.title) must.push({ match: { job_title: f.title } });
  if (f.seniority) must.push({ match: { job_title_levels: f.seniority } });
  if (f.location) must.push({ match: { location_name: f.location } });
  if (f.domains?.length) must.push({ terms: { job_company_website: f.domains } });
  if (f.industry) must.push({ match: { job_company_industry: f.industry } });
  if (f.employees) {
    must.push({
      range: { job_company_employee_count: { gte: f.employees[0], lte: f.employees[1] } },
    });
  }
  if (f.q) must.push({ query_string: { query: f.q } });
  if (!must.length) {
    throw new AICliError(
      'validation',
      'PDL person/search requires at least one filter (title, seniority, location, domains, industry, employees, q).',
    );
  }
  return { bool: { must } };
}

async function pdlLookupPerson(
  input: DataLookupPersonInput,
): Promise<DataLookupPersonResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    query: buildPersonSearchQuery(input),
    size: Math.min(Math.max(input.limit ?? 10, 1), 100),
  };
  if (input.cursor) body.scroll_token = input.cursor;

  const response = await pdlPost('/person/search', body, input.apiKey, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `PDL person/search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as PdlSearchResponse<PdlPerson>;
  const results = (payload.data ?? []).map(normalizePerson);
  return {
    provider: 'pdl',
    data: {
      results,
      total: payload.total ?? null,
      nextCursor: payload.scroll_token ?? null,
    },
    raw: payload,
  };
}

// -- lookupOrg ---------------------------------------------------------------

function buildOrgSearchQuery(input: DataLookupOrgInput): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [];
  const f = input.filters;
  if (f.domains?.length) must.push({ terms: { website: f.domains } });
  if (f.location) must.push({ match: { 'location.name': f.location } });
  if (f.industry) must.push({ match: { industry: f.industry } });
  if (f.tech?.length) must.push({ terms: { tags: f.tech } });
  if (f.employees) {
    must.push({ range: { employee_count: { gte: f.employees[0], lte: f.employees[1] } } });
  }
  if (f.q) must.push({ query_string: { query: f.q } });
  if (!must.length) {
    throw new AICliError(
      'validation',
      'PDL company/search requires at least one filter (domains, location, industry, tech, employees, q).',
    );
  }
  return { bool: { must } };
}

async function pdlLookupOrg(input: DataLookupOrgInput): Promise<DataLookupOrgResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    query: buildOrgSearchQuery(input),
    size: Math.min(Math.max(input.limit ?? 10, 1), 100),
  };
  if (input.cursor) body.scroll_token = input.cursor;

  const response = await pdlPost('/company/search', body, input.apiKey, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `PDL company/search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as PdlSearchResponse<PdlCompany>;
  const results = (payload.data ?? []).map(normalizeOrg);
  return {
    provider: 'pdl',
    data: {
      results,
      total: payload.total ?? null,
      nextCursor: payload.scroll_token ?? null,
    },
    raw: payload,
  };
}

export const pdlAdapter: DataProviderAdapter = {
  slug: 'pdl',
  name: 'People Data Labs',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: true,
    enrichOrg: true,
    lookupPerson: true,
    lookupOrg: true,
    lookupEmail: false,
    verifyEmail: false,
  },
  enrichPerson: pdlEnrichPerson,
  enrichOrg: pdlEnrichOrg,
  lookupPerson: pdlLookupPerson,
  lookupOrg: pdlLookupOrg,
};
