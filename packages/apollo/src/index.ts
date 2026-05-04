// @marmot-sh/apollo — Apollo adapter.
//
// Backs marmot's enrich + lookup verbs for person and org against Apollo's
// graph (~275M people, ~73M companies). No email-only verbs and no email
// verification — those route through Hunter.

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
  type DataNormalizedOrg,
  type DataNormalizedPerson,
  type DataProviderAdapter,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'apollo' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.apollo;

type ApolloOrganization = {
  id?: string;
  name?: string | null;
  website_url?: string | null;
  primary_domain?: string | null;
  short_description?: string | null;
  industry?: string | null;
  estimated_num_employees?: number | null;
  founded_year?: number | null;
  raw_address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
};

type ApolloPerson = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
  twitter_url?: string | null;
  github_url?: string | null;
  title?: string | null;
  seniority?: string | null;
  departments?: string[] | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  phone_numbers?: Array<{ raw_number?: string | null }> | null;
  organization?: ApolloOrganization | null;
};

type ApolloPagination = {
  page?: number;
  per_page?: number;
  total_entries?: number;
  total_pages?: number;
};

function authError(): AICliError {
  return new AICliError('auth', 'Apollo requires --api-key or APOLLO_API_KEY.');
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

const COMMON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-cache',
  accept: 'application/json',
};

async function apolloPost(
  path: string,
  body: unknown,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  try {
    return await fetchFn(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...COMMON_HEADERS, 'x-api-key': apiKey },
      body: JSON.stringify(body),
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Apollo ${path} request failed.`);
  }
}

async function apolloGet(
  path: string,
  params: URLSearchParams,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  const url = `${BASE_URL}${path}?${params.toString()}`;
  try {
    return await fetchFn(url, {
      headers: { ...COMMON_HEADERS, 'x-api-key': apiKey },
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Apollo ${path} request failed.`);
  }
}

function joinLocation(o: { city?: string | null; state?: string | null; country?: string | null }): string | null {
  const parts = [o.city, o.state, o.country].filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(', ') : null;
}

function normalizeOrg(o: ApolloOrganization | null | undefined): DataNormalizedOrg | null {
  if (!o) return null;
  return {
    name: o.name ?? null,
    domain: o.primary_domain ?? o.website_url ?? null,
    description: o.short_description ?? null,
    industry: o.industry ?? null,
    headcount: o.estimated_num_employees ?? null,
    headcountRange: null,
    foundedYear: o.founded_year ?? null,
    location: o.raw_address ?? joinLocation(o),
    linkedin: o.linkedin_url ?? null,
    twitter: o.twitter_url ?? null,
    providerId: o.id ?? null,
  };
}

function normalizePerson(p: ApolloPerson): DataNormalizedPerson {
  const phone = p.phone_numbers?.find((n) => n?.raw_number)?.raw_number ?? null;
  return {
    fullName: p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? null,
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    email: p.email ?? null,
    phone,
    linkedin: p.linkedin_url ?? null,
    twitter: p.twitter_url ?? null,
    github: p.github_url ?? null,
    title: p.title ?? null,
    seniority: p.seniority ?? null,
    department: p.departments?.[0] ?? null,
    providerId: p.id ?? null,
    confidence: null,
    location: joinLocation(p),
    org: normalizeOrg(p.organization ?? null),
  };
}

// -- enrichPerson ------------------------------------------------------------

async function apolloEnrichPerson(
  input: DataEnrichPersonInput,
): Promise<DataEnrichPersonResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const id = input.identifiers;

  const body: Record<string, unknown> = {};
  if (id.email) body.email = id.email;
  if (id.emailHash) body.hashed_email = id.emailHash;
  if (id.linkedin) body.linkedin_url = id.linkedin;
  if (id.providerId) body.id = id.providerId;
  if (id.name) body.name = id.name;
  if (id.firstName) body.first_name = id.firstName;
  if (id.lastName) body.last_name = id.lastName;
  if (id.company) body.organization_name = id.company;
  if (id.domain) body.domain = id.domain;

  const hasIdentifier =
    id.email ||
    id.emailHash ||
    id.linkedin ||
    id.providerId ||
    id.name ||
    (id.firstName && id.lastName);
  if (!hasIdentifier) {
    throw new AICliError(
      'validation',
      'Apollo people/match requires at least one of: email, linkedin, name, first-name+last-name, providerId.',
    );
  }

  const response = await apolloPost('/people/match', body, input.apiKey, fetchFn, input.abortSignal);

  if (response.status === 404) {
    const raw = await response.json().catch(() => null);
    return { provider: 'apollo', data: { person: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Apollo people/match failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as { person?: ApolloPerson | null };
  if (!payload.person) {
    return { provider: 'apollo', data: { person: null }, raw: payload };
  }
  return { provider: 'apollo', data: { person: normalizePerson(payload.person) }, raw: payload };
}

// -- enrichOrg ---------------------------------------------------------------

async function apolloEnrichOrg(input: DataEnrichOrgInput): Promise<DataEnrichOrgResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const domain = input.identifiers.domain;
  if (!domain) {
    throw new AICliError('validation', 'Apollo organizations/enrich requires --domain.');
  }
  const params = new URLSearchParams({ domain });

  const response = await apolloGet('/organizations/enrich', params, input.apiKey, fetchFn, input.abortSignal);

  // 422 = "company not in graph; we'll add it" — surface as null match.
  if (response.status === 404 || response.status === 422) {
    const raw = await response.json().catch(() => null);
    return { provider: 'apollo', data: { org: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Apollo organizations/enrich failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as { organization?: ApolloOrganization | null };
  return { provider: 'apollo', data: { org: normalizeOrg(payload.organization ?? null) }, raw: payload };
}

// -- lookupPerson ------------------------------------------------------------

async function apolloLookupPerson(
  input: DataLookupPersonInput,
): Promise<DataLookupPersonResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const f = input.filters;

  const body: Record<string, unknown> = {
    page: input.cursor ? Number(input.cursor) : 1,
    per_page: Math.min(Math.max(input.limit ?? 25, 1), 100),
  };
  if (f.title) body.person_titles = [f.title];
  if (f.seniority) body.person_seniorities = [f.seniority];
  if (f.location) body.person_locations = [f.location];
  if (f.domains?.length) body.q_organization_domains_list = f.domains;
  if (f.employees) body.organization_num_employees_ranges = [`${f.employees[0]},${f.employees[1]}`];
  if (f.q) body.q_keywords = f.q;

  const hasFilter =
    f.title || f.seniority || f.location || f.domains?.length || f.employees || f.q || f.industry;
  if (!hasFilter) {
    throw new AICliError(
      'validation',
      'Apollo mixed_people/api_search requires at least one filter (title, seniority, location, domains, employees, q).',
    );
  }

  const response = await apolloPost('/mixed_people/api_search', body, input.apiKey, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Apollo mixed_people/api_search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as {
    people?: ApolloPerson[];
    pagination?: ApolloPagination;
  };
  const results = (payload.people ?? []).map(normalizePerson);
  const page = payload.pagination?.page ?? 1;
  const totalPages = payload.pagination?.total_pages ?? null;
  const nextCursor = totalPages !== null && page < totalPages ? String(page + 1) : null;

  return {
    provider: 'apollo',
    data: {
      results,
      total: payload.pagination?.total_entries ?? null,
      nextCursor,
    },
    raw: payload,
  };
}

// -- lookupOrg ---------------------------------------------------------------

async function apolloLookupOrg(input: DataLookupOrgInput): Promise<DataLookupOrgResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const f = input.filters;

  const body: Record<string, unknown> = {
    page: input.cursor ? Number(input.cursor) : 1,
    per_page: Math.min(Math.max(input.limit ?? 25, 1), 100),
  };
  if (f.domains?.length) body.q_organization_domains_list = f.domains;
  if (f.employees) body.organization_num_employees_ranges = [`${f.employees[0]},${f.employees[1]}`];
  if (f.location) body.organization_locations = [f.location];
  if (f.tech?.length) body.currently_using_any_of_technology_uids = f.tech;
  if (f.industry) body.q_organization_keyword_tags = [f.industry];
  if (f.q) body.q_organization_name = f.q;

  const hasFilter =
    f.domains?.length || f.employees || f.location || f.tech?.length || f.industry || f.q;
  if (!hasFilter) {
    throw new AICliError(
      'validation',
      'Apollo mixed_companies/search requires at least one filter (domains, employees, location, tech, industry, q).',
    );
  }

  const response = await apolloPost('/mixed_companies/search', body, input.apiKey, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Apollo mixed_companies/search failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as {
    organizations?: ApolloOrganization[];
    pagination?: ApolloPagination;
  };
  const results = (payload.organizations ?? [])
    .map((o) => normalizeOrg(o))
    .filter((o): o is DataNormalizedOrg => o !== null);
  const page = payload.pagination?.page ?? 1;
  const totalPages = payload.pagination?.total_pages ?? null;
  const nextCursor = totalPages !== null && page < totalPages ? String(page + 1) : null;

  return {
    provider: 'apollo',
    data: {
      results,
      total: payload.pagination?.total_entries ?? null,
      nextCursor,
    },
    raw: payload,
  };
}

export const apolloAdapter: DataProviderAdapter = {
  slug: 'apollo',
  name: 'Apollo',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: true,
    enrichOrg: true,
    lookupPerson: true,
    lookupOrg: true,
    lookupEmail: false,
    verifyEmail: false,
  },
  enrichPerson: apolloEnrichPerson,
  enrichOrg: apolloEnrichOrg,
  lookupPerson: apolloLookupPerson,
  lookupOrg: apolloLookupOrg,
};
