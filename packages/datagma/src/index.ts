// @marmot-sh/datagma — Datagma adapter.
//
// Backs marmot's enrich --type person and verify --type email cells. Datagma's
// differentiator is the mobile-phone finder bundled into person enrichment, so
// we surface it on the normalized envelope when the wire payload includes it.
//
// Auth is `?apiId=<key>` query parameter (Datagma calls the key the "API ID").

import {
  AICliError,
  DATA_PROVIDER_BASE_URLS,
  toAICliError,
  type DataEnrichPersonInput,
  type DataEnrichPersonResult,
  type DataNormalizedOrg,
  type DataNormalizedPerson,
  type DataProviderAdapter,
  type DataVerifyEmailInput,
  type DataVerifyEmailResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'datagma' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.datagma;

// -- wire-format types -------------------------------------------------------

type DatagmaPersonBlock = {
  id?: string | null;
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  emails?: string[] | null;
  /** Datagma surfaces mobile phones here; sometimes a string, sometimes an array. */
  phone?: string | null;
  phones?: Array<string | { number?: string | null; type?: string | null }> | null;
  mobilePhone?: string | null;
  linkedInUrl?: string | null;
  twitterHandle?: string | null;
  jobTitle?: string | null;
  seniority?: string | null;
  department?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  confidence?: number | null;
};

type DatagmaCompanyBlock = {
  id?: string | null;
  name?: string | null;
  legalName?: string | null;
  website?: string | null;
  domain?: string | null;
  description?: string | null;
  industry?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
  foundedYear?: number | null;
  location?: string | null;
  linkedInUrl?: string | null;
  twitterHandle?: string | null;
};

type DatagmaFullResponse = {
  person?: DatagmaPersonBlock | null;
  company?: DatagmaCompanyBlock | null;
};

type DatagmaVerifyResponse = {
  email?: string | null;
  /** Datagma's verifier mirrors ZeroBounce status enums. */
  status?: string | null;
  /** Sub-status / reason. */
  subStatus?: string | null;
  score?: number | null;
  regex?: boolean | null;
  mxRecord?: boolean | null;
  mxFound?: boolean | null;
  smtpProvider?: boolean | null;
  smtpCheck?: boolean | null;
  acceptAll?: boolean | null;
  catchAll?: boolean | null;
  disposable?: boolean | null;
  freeEmail?: boolean | null;
  webmail?: boolean | null;
  role?: boolean | null;
  gibberish?: boolean | null;
  block?: boolean | null;
};

// -- helpers -----------------------------------------------------------------

function authError(): AICliError {
  return new AICliError('auth', 'Datagma requires --api-key or DATAGMA_API_KEY.');
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

async function datagmaGet(
  path: string,
  params: URLSearchParams,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> {
  // Datagma authenticates via `?apiId=` rather than a header.
  params.set('apiId', apiKey);
  const url = `${BASE_URL}${path}?${params.toString()}`;
  try {
    return await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Datagma ${path} request failed.`);
  }
}

function pickPhone(p: DatagmaPersonBlock): string | null {
  if (typeof p.mobilePhone === 'string' && p.mobilePhone) return p.mobilePhone;
  if (typeof p.phone === 'string' && p.phone) return p.phone;
  if (Array.isArray(p.phones) && p.phones.length > 0) {
    const first = p.phones[0];
    if (typeof first === 'string') return first || null;
    if (first && typeof first.number === 'string') return first.number || null;
  }
  return null;
}

function joinLocation(p: DatagmaPersonBlock): string | null {
  if (p.location) return p.location;
  const parts = [p.city, p.country].filter((s): s is string => Boolean(s));
  return parts.length ? parts.join(', ') : null;
}

function normalizeOrg(c: DatagmaCompanyBlock | null | undefined): DataNormalizedOrg | null {
  if (!c) return null;
  return {
    name: c.name ?? c.legalName ?? null,
    domain: c.domain ?? c.website ?? null,
    description: c.description ?? null,
    industry: c.industry ?? null,
    headcount: typeof c.employeeCount === 'number' ? c.employeeCount : null,
    headcountRange: c.employeeRange ?? null,
    foundedYear: typeof c.foundedYear === 'number' ? c.foundedYear : null,
    location: c.location ?? null,
    linkedin: c.linkedInUrl ?? null,
    twitter: c.twitterHandle ?? null,
    providerId: c.id ?? null,
  };
}

function normalizePerson(
  p: DatagmaPersonBlock,
  org: DataNormalizedOrg | null,
): DataNormalizedPerson {
  const fullName =
    p.fullName ?? ([p.firstName, p.lastName].filter(Boolean).join(' ') || null);
  return {
    fullName,
    firstName: p.firstName ?? null,
    lastName: p.lastName ?? null,
    email: p.email ?? null,
    emails: Array.isArray(p.emails) && p.emails.length > 0 ? p.emails : undefined,
    phone: pickPhone(p),
    linkedin: p.linkedInUrl ?? null,
    twitter: p.twitterHandle ?? null,
    title: p.jobTitle ?? null,
    seniority: p.seniority ?? null,
    department: p.department ?? null,
    providerId: p.id ?? null,
    confidence: typeof p.confidence === 'number' ? p.confidence : null,
    location: joinLocation(p),
    org,
  };
}

// -- enrichPerson ------------------------------------------------------------

async function datagmaEnrichPerson(
  input: DataEnrichPersonInput,
): Promise<DataEnrichPersonResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const id = input.identifiers;

  const params = new URLSearchParams();
  if (id.email) {
    params.set('email', id.email);
  } else if (id.linkedin) {
    // Datagma calls the LinkedIn URL/slug `username`.
    params.set('username', id.linkedin);
  } else {
    const company = id.company ?? id.domain;
    const fullName =
      id.name ?? ([id.firstName, id.lastName].filter(Boolean).join(' ') || null);
    if (fullName && company) {
      params.set('fullName', fullName);
      params.set('company', company);
    } else {
      throw new AICliError(
        'validation',
        'Datagma enrich-person requires --email, --linkedin, or (--first-name + --last-name + --company).',
      );
    }
  }

  // Always resolve mobile phone alongside enrichment — that's the value-add.
  params.set('phoneFull', 'true');

  const response = await datagmaGet('/full', params, input.apiKey, fetchFn, input.abortSignal);

  if (response.status === 404) {
    const raw = await response.json().catch(() => null);
    return { provider: 'datagma', data: { person: null }, raw };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Datagma /full failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as DatagmaFullResponse;
  if (!payload.person) {
    return { provider: 'datagma', data: { person: null }, raw: payload };
  }
  const org = normalizeOrg(payload.company);
  const person = normalizePerson(payload.person, org);
  return { provider: 'datagma', data: { person }, raw: payload };
}

// -- verifyEmail -------------------------------------------------------------

const DELIVERABLE_STATUSES = new Set([
  'valid',
  'accept_all',
  'accept-all',
  'acceptall',
  'catch_all',
  'catch-all',
  'catchall',
]);

async function datagmaVerifyEmail(
  input: DataVerifyEmailInput,
): Promise<DataVerifyEmailResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const params = new URLSearchParams({ email: input.email });

  const response = await datagmaGet('/email', params, input.apiKey, fetchFn, input.abortSignal);

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Datagma /email failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as DatagmaVerifyResponse;
  const status = (payload.status ?? 'unknown').toLowerCase();
  return {
    provider: 'datagma',
    data: {
      email: payload.email ?? input.email,
      deliverable: DELIVERABLE_STATUSES.has(status),
      status,
      score: typeof payload.score === 'number' ? payload.score : null,
      checks: {
        regexp: payload.regex ?? null,
        mxRecords: payload.mxRecord ?? payload.mxFound ?? null,
        smtpServer: payload.smtpProvider ?? null,
        smtpCheck: payload.smtpCheck ?? null,
        acceptAll: payload.acceptAll ?? payload.catchAll ?? null,
        disposable: payload.disposable ?? null,
        webmail: payload.webmail ?? payload.freeEmail ?? null,
        gibberish: payload.gibberish ?? null,
        block: payload.block ?? null,
      },
    },
    raw: payload,
  };
}

export const datagmaAdapter: DataProviderAdapter = {
  slug: 'datagma',
  name: 'Datagma',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: true,
    enrichOrg: false,
    lookupPerson: false,
    lookupOrg: false,
    lookupEmail: false,
    verifyEmail: true,
  },
  enrichPerson: datagmaEnrichPerson,
  verifyEmail: datagmaVerifyEmail,
};
