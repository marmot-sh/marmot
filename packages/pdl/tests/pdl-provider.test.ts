import { describe, expect, it } from 'vitest';

import { pdlAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errStatus = (status: number, body: unknown = ''): typeof fetch =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
    })) as unknown as typeof fetch;

describe('pdlAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(pdlAdapter.slug).toBe('pdl');
    expect(pdlAdapter.name).toBe('People Data Labs');
    expect(pdlAdapter.requiresApiKey).toBe(true);
    expect(pdlAdapter.capabilities).toEqual({
      enrichPerson: true,
      enrichOrg: true,
      lookupPerson: true,
      lookupOrg: true,
      lookupEmail: false,
      verifyEmail: false,
    });
    expect(typeof pdlAdapter.enrichPerson).toBe('function');
    expect(typeof pdlAdapter.enrichOrg).toBe('function');
    expect(typeof pdlAdapter.lookupPerson).toBe('function');
    expect(typeof pdlAdapter.lookupOrg).toBe('function');
    expect(pdlAdapter.lookupEmail).toBeUndefined();
    expect(pdlAdapter.verifyEmail).toBeUndefined();
  });
});

describe('pdlAdapter.enrichPerson', () => {
  it('GETs /v5/person/enrich with X-API-Key, maps identifiers, normalizes person', async () => {
    let capturedUrl: URL | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await pdlAdapter.enrichPerson!({
      apiKey: 'pdl-test',
      identifiers: {
        email: 'a@b.com',
        linkedin: 'linkedin.com/in/foo',
        firstName: 'John',
        lastName: 'Doe',
        company: 'example.com',
      },
      controls: { minLikelihood: 6, require: 'emails', fields: ['emails', 'phone_numbers'] },
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = new URL(String(url));
        capturedHeaders = init?.headers as Record<string, string>;
        return okJson({
          status: 200,
          likelihood: 9,
          data: {
            id: 'pdl-id-1',
            full_name: 'John Doe',
            first_name: 'John',
            last_name: 'Doe',
            linkedin_url: 'https://linkedin.com/in/foo',
            work_email: 'johndoe@example.com',
            personal_emails: ['a@b.com'],
            mobile_phone: '+1-555-1234',
            job_title: 'Founder',
            job_title_role: 'engineering',
            job_title_levels: ['cxo'],
            job_company_name: 'Example',
            job_company_website: 'example.com',
            job_company_industry: 'software',
            job_company_employee_count: 25,
            location_name: 'San Francisco, California, United States',
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v5/person/enrich');
    expect(capturedUrl?.searchParams.get('email')).toBe('a@b.com');
    expect(capturedUrl?.searchParams.get('profile')).toBe('linkedin.com/in/foo');
    expect(capturedUrl?.searchParams.get('first_name')).toBe('John');
    expect(capturedUrl?.searchParams.get('last_name')).toBe('Doe');
    expect(capturedUrl?.searchParams.get('company')).toBe('example.com');
    expect(capturedUrl?.searchParams.get('min_likelihood')).toBe('6');
    expect(capturedUrl?.searchParams.get('required')).toBe('emails');
    expect(capturedUrl?.searchParams.get('data_include')).toBe('emails,phone_numbers');
    expect(capturedHeaders?.['X-API-Key']).toBe('pdl-test');

    expect(result.provider).toBe('pdl');
    expect(result.data.person).toMatchObject({
      fullName: 'John Doe',
      firstName: 'John',
      lastName: 'Doe',
      email: 'johndoe@example.com',
      phone: '+1-555-1234',
      linkedin: 'https://linkedin.com/in/foo',
      title: 'Founder',
      seniority: 'cxo',
      department: 'engineering',
      providerId: 'pdl-id-1',
      confidence: 90,
      location: 'San Francisco, California, United States',
    });
    expect(result.data.person?.org).toMatchObject({
      name: 'Example',
      domain: 'example.com',
      industry: 'software',
      headcount: 25,
    });
    expect(result.data.person?.emails).toEqual(['johndoe@example.com', 'a@b.com']);
  });

  it('returns {person: null} on 404 (no match)', async () => {
    const result = await pdlAdapter.enrichPerson!({
      apiKey: 'pdl-test',
      identifiers: { email: 'unknown@nowhere.test' },
      fetchFn: (async () =>
        new Response(JSON.stringify({ status: 404, error: { type: 'not_found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(result.data.person).toBeNull();
  });

  it('throws auth error without an api key', async () => {
    await expect(
      pdlAdapter.enrichPerson!({
        identifiers: { email: 'a@b.com' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/PDL_API_KEY/);
  });

  it('throws when no identifiers are provided (only controls)', async () => {
    await expect(
      pdlAdapter.enrichPerson!({
        apiKey: 'pdl-test',
        identifiers: {},
        controls: { minLikelihood: 6 },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/at least one identifier/);
  });

  it('maps 401 to auth and 500 to provider', async () => {
    await expect(
      pdlAdapter.enrichPerson!({
        apiKey: 'pdl-test',
        identifiers: { email: 'a@b.com' },
        fetchFn: errStatus(401),
      }),
    ).rejects.toMatchObject({ category: 'auth' });
    await expect(
      pdlAdapter.enrichPerson!({
        apiKey: 'pdl-test',
        identifiers: { email: 'a@b.com' },
        fetchFn: errStatus(500),
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });
});

describe('pdlAdapter.enrichOrg', () => {
  it('GETs /v5/company/enrich with website param when domain is given', async () => {
    let capturedUrl: URL | undefined;
    const result = await pdlAdapter.enrichOrg!({
      apiKey: 'pdl-test',
      identifiers: { domain: 'stripe.com' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          status: 200,
          data: {
            id: 'co-1',
            name: 'Stripe',
            website: 'stripe.com',
            industry: 'financial services',
            summary: 'Online payments',
            employee_count: 5000,
            size: '1001-5000',
            founded: 2010,
            location: { name: 'San Francisco, California, United States' },
            linkedin_url: 'https://linkedin.com/company/stripe',
            tags: ['payments', 'fintech'],
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v5/company/enrich');
    expect(capturedUrl?.searchParams.get('website')).toBe('stripe.com');
    expect(result.data.org).toMatchObject({
      name: 'Stripe',
      domain: 'stripe.com',
      industry: 'financial services',
      headcount: 5000,
      headcountRange: '1001-5000',
      foundedYear: 2010,
      location: 'San Francisco, California, United States',
      linkedin: 'https://linkedin.com/company/stripe',
      providerId: 'co-1',
    });
  });

  it('returns {org: null} on 404', async () => {
    const result = await pdlAdapter.enrichOrg!({
      apiKey: 'pdl-test',
      identifiers: { domain: 'nope.test' },
      fetchFn: (async () =>
        new Response(JSON.stringify({ status: 404 }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(result.data.org).toBeNull();
  });

  it('throws when no identifiers are provided', async () => {
    await expect(
      pdlAdapter.enrichOrg!({
        apiKey: 'pdl-test',
        identifiers: {},
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/at least one of/);
  });
});

describe('pdlAdapter.lookupPerson', () => {
  it('POSTs ES DSL bool/must, caps size, threads cursor', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const result = await pdlAdapter.lookupPerson!({
      apiKey: 'pdl-test',
      filters: {
        title: 'engineer',
        seniority: 'senior',
        location: 'New York',
        domains: ['stripe.com', 'plaid.com'],
        employees: [100, 500],
        industry: 'software',
        q: 'kubernetes',
      },
      limit: 250,
      cursor: 'scroll-abc',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.peopledatalabs.com/v5/person/search');
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          status: 200,
          total: 42,
          scroll_token: 'scroll-next',
          data: [
            {
              id: 'p1',
              full_name: 'Alice Smith',
              first_name: 'Alice',
              last_name: 'Smith',
              job_title: 'Senior Engineer',
              job_company_name: 'Stripe',
              job_company_website: 'stripe.com',
            },
          ],
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedBody?.size).toBe(100);
    expect(capturedBody?.scroll_token).toBe('scroll-abc');
    const must = ((capturedBody?.query as { bool: { must: Array<Record<string, unknown>> } }).bool.must);
    expect(must).toContainEqual({ match: { job_title: 'engineer' } });
    expect(must).toContainEqual({ match: { job_title_levels: 'senior' } });
    expect(must).toContainEqual({ terms: { job_company_website: ['stripe.com', 'plaid.com'] } });
    expect(must).toContainEqual({
      range: { job_company_employee_count: { gte: 100, lte: 500 } },
    });

    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      fullName: 'Alice Smith',
      title: 'Senior Engineer',
    });
    expect(result.data.total).toBe(42);
    expect(result.data.nextCursor).toBe('scroll-next');
  });

  it('throws when no filters are given', async () => {
    await expect(
      pdlAdapter.lookupPerson!({
        apiKey: 'pdl-test',
        filters: {},
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/at least one filter/);
  });
});

describe('pdlAdapter.lookupOrg', () => {
  it('POSTs ES DSL with terms[website], range[employee_count], terms[tags]', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const result = await pdlAdapter.lookupOrg!({
      apiKey: 'pdl-test',
      filters: {
        domains: ['stripe.com'],
        employees: [50, 1000],
        tech: ['kubernetes', 'react'],
        industry: 'fintech',
      },
      limit: 5,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          status: 200,
          total: 1,
          data: [
            {
              id: 'co-1',
              name: 'Stripe',
              website: 'stripe.com',
              industry: 'fintech',
              employee_count: 5000,
              location: { name: 'SF' },
            },
          ],
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedBody?.size).toBe(5);
    const must = ((capturedBody?.query as { bool: { must: Array<Record<string, unknown>> } }).bool.must);
    expect(must).toContainEqual({ terms: { website: ['stripe.com'] } });
    expect(must).toContainEqual({ terms: { tags: ['kubernetes', 'react'] } });
    expect(must).toContainEqual({ range: { employee_count: { gte: 50, lte: 1000 } } });
    expect(must).toContainEqual({ match: { industry: 'fintech' } });

    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({ name: 'Stripe', domain: 'stripe.com' });
  });
});
