import { describe, expect, it } from 'vitest';

import { tombaAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('tombaAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(tombaAdapter.slug).toBe('tomba');
    expect(tombaAdapter.requiresApiKey).toBe(true);
    expect(tombaAdapter.capabilities).toEqual({
      enrichPerson: true,
      enrichOrg: true,
      lookupPerson: false,
      lookupOrg: true,
      lookupEmail: true,
      verifyEmail: true,
    });
    expect(tombaAdapter.lookupPerson).toBeUndefined();
  });

  it('rejects calls missing either credential', async () => {
    await expect(
      tombaAdapter.enrichPerson!({
        identifiers: { email: 'a@b.com' },
        apiKey: 'k',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Tomba requires/);
    await expect(
      tombaAdapter.enrichPerson!({
        identifiers: { email: 'a@b.com' },
        apiSecret: 's',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Tomba requires/);
  });
});

describe('tombaAdapter.enrichPerson', () => {
  it('routes email → /v1/combined/find with both Tomba headers', async () => {
    let capturedUrl: URL | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await tombaAdapter.enrichPerson!({
      apiKey: 'tk',
      apiSecret: 'ts',
      identifiers: { email: 'alice@acme.com' },
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = new URL(String(url));
        capturedHeaders = init?.headers as Record<string, string>;
        return okJson({
          data: {
            person: {
              id: 'p1',
              name: { fullName: 'Alice Smith', givenName: 'Alice', familyName: 'Smith' },
              email: 'alice@acme.com',
              employment: { title: 'VP Eng', role: 'engineering', seniority: 'executive' },
              linkedin: { handle: 'in/alice' },
            },
            company: {
              id: 'c1',
              name: 'Acme',
              domain: 'acme.com',
              category: { industry: 'software' },
              metrics: { employees: 500, employeesRange: '501-1000' },
            },
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v1/combined/find');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');
    expect(capturedHeaders?.['X-Tomba-Key']).toBe('tk');
    expect(capturedHeaders?.['X-Tomba-Secret']).toBe('ts');

    expect(result.data.person).toMatchObject({
      fullName: 'Alice Smith',
      email: 'alice@acme.com',
      title: 'VP Eng',
      providerId: 'p1',
    });
    expect(result.data.person?.org).toMatchObject({
      name: 'Acme',
      domain: 'acme.com',
      industry: 'software',
      headcount: 500,
    });
  });

  it('routes name+domain → /v1/email-finder', async () => {
    let capturedUrl: URL | undefined;
    const result = await tombaAdapter.enrichPerson!({
      apiKey: 'tk',
      apiSecret: 'ts',
      identifiers: { firstName: 'Alice', lastName: 'Smith', domain: 'acme.com' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          data: {
            email: 'alice@acme.com',
            first_name: 'Alice',
            last_name: 'Smith',
            full_name: 'Alice Smith',
            score: 95,
            domain: 'acme.com',
            company: 'Acme',
            position: 'VP Eng',
            linkedin: 'https://linkedin.com/in/alice',
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v1/email-finder');
    expect(capturedUrl?.searchParams.get('domain')).toBe('acme.com');
    expect(capturedUrl?.searchParams.get('first_name')).toBe('Alice');
    expect(result.data.person).toMatchObject({
      email: 'alice@acme.com',
      title: 'VP Eng',
      confidence: 95,
    });
    expect(result.data.person?.org?.domain).toBe('acme.com');
  });

  it('throws when neither email nor name+domain is supplied', async () => {
    await expect(
      tombaAdapter.enrichPerson!({
        apiKey: 'tk',
        apiSecret: 'ts',
        identifiers: { firstName: 'Alice' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/email.*first-name.*last-name.*domain/);
  });
});

describe('tombaAdapter.enrichOrg', () => {
  it('GETs /v1/companies/find with domain', async () => {
    let capturedUrl: URL | undefined;
    const result = await tombaAdapter.enrichOrg!({
      apiKey: 'tk',
      apiSecret: 'ts',
      identifiers: { domain: 'acme.com' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          data: {
            id: 'c1',
            name: 'Acme',
            domain: 'acme.com',
            category: { industry: 'software' },
            metrics: { employees: 500, employeesRange: '501-1000' },
            foundedYear: 2010,
          },
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl?.pathname).toBe('/v1/companies/find');
    expect(result.data.org).toMatchObject({
      name: 'Acme',
      domain: 'acme.com',
      foundedYear: 2010,
    });
  });

  it('throws without --domain', async () => {
    await expect(
      tombaAdapter.enrichOrg!({
        apiKey: 'tk',
        apiSecret: 'ts',
        identifiers: { name: 'Acme' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/--domain/);
  });
});

describe('tombaAdapter.lookupEmail', () => {
  it('GETs /v1/domain-search and surfaces pattern + acceptAll', async () => {
    const result = await tombaAdapter.lookupEmail!({
      apiKey: 'tk',
      apiSecret: 'ts',
      filters: { domain: 'acme.com', department: 'engineering' },
      limit: 5,
      fetchFn: (async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe('/v1/domain-search');
        expect(u.searchParams.get('domain')).toBe('acme.com');
        expect(u.searchParams.get('department')).toBe('engineering');
        expect(u.searchParams.get('limit')).toBe('5');
        return okJson({
          data: {
            organization: {
              website_url: 'acme.com',
              pattern: '{first}.{last}',
              accept_all: false,
            },
            emails: [
              {
                email: 'alice@acme.com',
                first_name: 'Alice',
                last_name: 'Smith',
                full_name: 'Alice Smith',
                position: 'VP Eng',
                seniority: 'executive',
                department: 'engineering',
                type: 'personal',
                score: 95,
                verification: { status: 'valid' },
              },
            ],
          },
          meta: { total: 1, current: 1, total_pages: 1, pageSize: 5 },
        });
      }) as unknown as typeof fetch,
    });
    expect(result.data.domain).toBe('acme.com');
    expect(result.data.pattern).toBe('{first}.{last}');
    expect(result.data.acceptAll).toBe(false);
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      email: 'alice@acme.com',
      type: 'personal',
      confidence: 95,
      verificationStatus: 'valid',
    });
  });
});

describe('tombaAdapter.lookupOrg', () => {
  it('POSTs include filters to /v1/reveal/search', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const result = await tombaAdapter.lookupOrg!({
      apiKey: 'tk',
      apiSecret: 'ts',
      filters: {
        domains: ['stripe.com'],
        location: 'United States',
        industry: 'fintech',
        tech: ['react', 'kubernetes'],
        employees: [100, 1000],
      },
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tomba.io/v1/reveal/search');
        capturedBody = JSON.parse(String(init?.body));
        return okJson({
          data: {
            companies: [
              {
                name: 'Stripe',
                website_url: 'stripe.com',
                industry: 'fintech',
                country: 'United States',
                city: 'San Francisco',
                state: 'CA',
                company_size: '5001-10000',
                founded: 2010,
              },
            ],
          },
          meta: { total: 1, page: 1, total_pages: 1 },
        });
      }) as unknown as typeof fetch,
    });

    const filters = capturedBody?.filters as Record<string, { include?: string[] } | undefined>;
    expect(filters.company?.include).toEqual(['stripe.com']);
    expect(filters.location_country?.include).toEqual(['United States']);
    expect(filters.industry?.include).toEqual(['fintech']);
    expect(filters.technologies?.include).toEqual(['react', 'kubernetes']);
    expect(filters.size?.include).toEqual(['100-1000']);

    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      name: 'Stripe',
      domain: 'stripe.com',
      industry: 'fintech',
      location: 'San Francisco, CA, United States',
      headcountRange: '5001-10000',
      foundedYear: 2010,
    });
  });

  it('throws when no filters are provided', async () => {
    await expect(
      tombaAdapter.lookupOrg!({
        apiKey: 'tk',
        apiSecret: 'ts',
        filters: {},
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/at least one filter/);
  });
});

describe('tombaAdapter.verifyEmail', () => {
  it('returns deliverable=true on status=valid', async () => {
    const result = await tombaAdapter.verifyEmail!({
      apiKey: 'tk',
      apiSecret: 'ts',
      email: 'alice@acme.com',
      fetchFn: (async () =>
        okJson({
          data: {
            email: {
              status: 'valid',
              email: 'alice@acme.com',
              score: 99,
              regex: true,
              mx: true,
              smtp_check: true,
              accept_all: false,
              disposable: false,
              webmail: false,
              gibberish: false,
              block: false,
            },
          },
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('valid');
    expect(result.data.score).toBe(99);
    expect(result.data.checks.mxRecords).toBe(true);
  });

  it('maps accept_all status to deliverable=true', async () => {
    const result = await tombaAdapter.verifyEmail!({
      apiKey: 'tk',
      apiSecret: 'ts',
      email: 'info@acme.com',
      fetchFn: (async () =>
        okJson({
          data: { email: { status: 'accept_all', email: 'info@acme.com', accept_all: true } },
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(true);
  });
});
