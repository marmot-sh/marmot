import { describe, expect, it } from 'vitest';

import { apolloAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('apolloAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(apolloAdapter.slug).toBe('apollo');
    expect(apolloAdapter.requiresApiKey).toBe(true);
    expect(apolloAdapter.capabilities).toEqual({
      enrichPerson: true,
      enrichOrg: true,
      lookupPerson: true,
      lookupOrg: true,
      lookupEmail: false,
      verifyEmail: false,
    });
    expect(apolloAdapter.lookupEmail).toBeUndefined();
    expect(apolloAdapter.verifyEmail).toBeUndefined();
  });
});

describe('apolloAdapter.enrichPerson', () => {
  it('POSTs to /api/v1/people/match with x-api-key, normalizes person', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: Record<string, unknown> | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await apolloAdapter.enrichPerson!({
      apiKey: 'apollo-test',
      identifiers: { email: 'alice@acme.com', linkedin: 'linkedin.com/in/alice' },
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers as Record<string, string>;
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          person: {
            id: 'p1',
            first_name: 'Alice',
            last_name: 'Smith',
            name: 'Alice Smith',
            email: 'alice@acme.com',
            linkedin_url: 'https://linkedin.com/in/alice',
            title: 'VP Eng',
            seniority: 'vp',
            departments: ['engineering'],
            city: 'New York',
            state: 'NY',
            country: 'United States',
            organization: {
              id: 'org1',
              name: 'Acme',
              primary_domain: 'acme.com',
              estimated_num_employees: 500,
              industry: 'software',
              founded_year: 2010,
            },
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl).toBe('https://api.apollo.io/api/v1/people/match');
    expect(capturedHeaders?.['x-api-key']).toBe('apollo-test');
    expect(capturedHeaders?.['Cache-Control']).toBe('no-cache');
    expect(capturedBody).toMatchObject({
      email: 'alice@acme.com',
      linkedin_url: 'linkedin.com/in/alice',
    });

    expect(result.data.person).toMatchObject({
      fullName: 'Alice Smith',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@acme.com',
      title: 'VP Eng',
      seniority: 'vp',
      department: 'engineering',
      providerId: 'p1',
      location: 'New York, NY, United States',
    });
    expect(result.data.person?.org).toMatchObject({
      name: 'Acme',
      domain: 'acme.com',
      industry: 'software',
      headcount: 500,
      foundedYear: 2010,
      providerId: 'org1',
    });
  });

  it('returns {person: null} on 404', async () => {
    const result = await apolloAdapter.enrichPerson!({
      apiKey: 'apollo-test',
      identifiers: { email: 'unknown@nowhere.test' },
      fetchFn: (async () =>
        new Response(JSON.stringify({ person: null }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(result.data.person).toBeNull();
  });

  it('throws when no identifiers are given', async () => {
    await expect(
      apolloAdapter.enrichPerson!({
        apiKey: 'apollo-test',
        identifiers: {},
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/at least one of/);
  });
});

describe('apolloAdapter.enrichOrg', () => {
  it('GETs /api/v1/organizations/enrich with domain', async () => {
    let capturedUrl: URL | undefined;
    const result = await apolloAdapter.enrichOrg!({
      apiKey: 'apollo-test',
      identifiers: { domain: 'acme.com' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          organization: {
            id: 'org1',
            name: 'Acme',
            primary_domain: 'acme.com',
            short_description: 'A company',
            industry: 'software',
            estimated_num_employees: 500,
            founded_year: 2010,
            raw_address: '1 Acme Way, NYC',
          },
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl?.pathname).toBe('/api/v1/organizations/enrich');
    expect(capturedUrl?.searchParams.get('domain')).toBe('acme.com');
    expect(result.data.org).toMatchObject({
      name: 'Acme',
      domain: 'acme.com',
      industry: 'software',
      headcount: 500,
      foundedYear: 2010,
      location: '1 Acme Way, NYC',
      providerId: 'org1',
    });
  });

  it('returns {org: null} on 422 (not in graph)', async () => {
    const result = await apolloAdapter.enrichOrg!({
      apiKey: 'apollo-test',
      identifiers: { domain: 'newcomer.test' },
      fetchFn: (async () =>
        new Response(JSON.stringify({}), {
          status: 422,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(result.data.org).toBeNull();
  });

  it('throws when no domain is given', async () => {
    await expect(
      apolloAdapter.enrichOrg!({
        apiKey: 'apollo-test',
        identifiers: { name: 'Acme' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/--domain/);
  });
});

describe('apolloAdapter.lookupPerson', () => {
  it('POSTs filters to /mixed_people/api_search, parses pagination', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const result = await apolloAdapter.lookupPerson!({
      apiKey: 'apollo-test',
      filters: {
        title: 'VP Eng',
        seniority: 'vp',
        location: 'New York',
        domains: ['stripe.com'],
        employees: [100, 500],
        q: 'fintech',
      },
      limit: 50,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.apollo.io/api/v1/mixed_people/api_search');
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          people: [
            {
              id: 'p1',
              first_name: 'Alice',
              last_name: 'Smith',
              title: 'VP Eng',
              seniority: 'vp',
            },
          ],
          pagination: { page: 1, per_page: 50, total_entries: 200, total_pages: 4 },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedBody).toMatchObject({
      page: 1,
      per_page: 50,
      person_titles: ['VP Eng'],
      person_seniorities: ['vp'],
      person_locations: ['New York'],
      q_organization_domains_list: ['stripe.com'],
      organization_num_employees_ranges: ['100,500'],
      q_keywords: 'fintech',
    });
    expect(result.data.results).toHaveLength(1);
    expect(result.data.total).toBe(200);
    expect(result.data.nextCursor).toBe('2');
  });

  it('honors cursor as page number', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    await apolloAdapter.lookupPerson!({
      apiKey: 'apollo-test',
      filters: { title: 'engineer' },
      cursor: '3',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          people: [],
          pagination: { page: 3, total_pages: 3 },
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedBody?.page).toBe(3);
  });

  it('throws when no filters are given', async () => {
    await expect(
      apolloAdapter.lookupPerson!({
        apiKey: 'apollo-test',
        filters: {},
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/at least one filter/);
  });
});

describe('apolloAdapter.lookupOrg', () => {
  it('POSTs filters to /mixed_companies/search, normalizes results', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const result = await apolloAdapter.lookupOrg!({
      apiKey: 'apollo-test',
      filters: {
        domains: ['stripe.com'],
        employees: [100, 1000],
        location: 'San Francisco',
        tech: ['salesforce', 'segment'],
        industry: 'fintech',
      },
      limit: 25,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          organizations: [
            {
              id: 'org1',
              name: 'Stripe',
              primary_domain: 'stripe.com',
              estimated_num_employees: 5000,
              industry: 'financial services',
            },
          ],
          pagination: { page: 1, per_page: 25, total_entries: 1, total_pages: 1 },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedBody).toMatchObject({
      q_organization_domains_list: ['stripe.com'],
      organization_num_employees_ranges: ['100,1000'],
      organization_locations: ['San Francisco'],
      currently_using_any_of_technology_uids: ['salesforce', 'segment'],
      q_organization_keyword_tags: ['fintech'],
    });
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      name: 'Stripe',
      domain: 'stripe.com',
    });
    expect(result.data.nextCursor).toBeNull();
  });
});
