import { describe, expect, it } from 'vitest';

import { hunterAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('hunterAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(hunterAdapter.slug).toBe('hunter');
    expect(hunterAdapter.requiresApiKey).toBe(true);
    expect(hunterAdapter.capabilities).toEqual({
      enrichPerson: true,
      enrichOrg: true,
      lookupPerson: false,
      lookupOrg: false,
      lookupEmail: true,
      verifyEmail: true,
    });
    expect(hunterAdapter.lookupPerson).toBeUndefined();
    expect(hunterAdapter.lookupOrg).toBeUndefined();
  });
});

describe('hunterAdapter.enrichPerson', () => {
  it('routes email → /v2/combined/find with Bearer auth', async () => {
    let capturedUrl: URL | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await hunterAdapter.enrichPerson!({
      apiKey: 'hunter-test',
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
              location: 'New York',
              employment: { title: 'VP Eng', role: 'engineering', seniority: 'executive', domain: 'acme.com', name: 'Acme' },
              linkedin: { handle: 'in/alice' },
              twitter: { handle: 'alice' },
            },
            company: {
              id: 'c1',
              name: 'Acme',
              domain: 'acme.com',
              category: { industry: 'software' },
              metrics: { employees: 500, employeesRange: '501-1000' },
              foundedYear: 2010,
              location: 'New York',
            },
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v2/combined/find');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');
    expect(capturedHeaders?.Authorization).toBe('Bearer hunter-test');

    expect(result.data.person).toMatchObject({
      fullName: 'Alice Smith',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@acme.com',
      title: 'VP Eng',
      seniority: 'executive',
      department: 'engineering',
      providerId: 'p1',
    });
    expect(result.data.person?.org).toMatchObject({
      name: 'Acme',
      domain: 'acme.com',
      industry: 'software',
      headcount: 500,
      headcountRange: '501-1000',
      foundedYear: 2010,
      providerId: 'c1',
    });
  });

  it('routes name+domain → /v2/email-finder', async () => {
    let capturedUrl: URL | undefined;
    const result = await hunterAdapter.enrichPerson!({
      apiKey: 'hunter-test',
      identifiers: { firstName: 'Alice', lastName: 'Smith', domain: 'acme.com' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          data: {
            first_name: 'Alice',
            last_name: 'Smith',
            email: 'alice@acme.com',
            score: 92,
            domain: 'acme.com',
            company: 'Acme',
            position: 'VP Eng',
            linkedin_url: 'https://linkedin.com/in/alice',
          },
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v2/email-finder');
    expect(capturedUrl?.searchParams.get('domain')).toBe('acme.com');
    expect(capturedUrl?.searchParams.get('first_name')).toBe('Alice');
    expect(capturedUrl?.searchParams.get('last_name')).toBe('Smith');
    expect(result.data.person).toMatchObject({
      email: 'alice@acme.com',
      title: 'VP Eng',
      confidence: 92,
    });
    expect(result.data.person?.org?.domain).toBe('acme.com');
  });

  it('throws validation when neither email nor name+domain is given', async () => {
    await expect(
      hunterAdapter.enrichPerson!({
        apiKey: 'hunter-test',
        identifiers: { firstName: 'Alice' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/email.*first-name.*last-name.*domain/);
  });
});

describe('hunterAdapter.enrichOrg', () => {
  it('GETs /v2/companies/find with domain', async () => {
    let capturedUrl: URL | undefined;
    const result = await hunterAdapter.enrichOrg!({
      apiKey: 'hunter-test',
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
            location: 'New York',
            linkedin: { handle: 'company/acme' },
          },
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl?.pathname).toBe('/v2/companies/find');
    expect(capturedUrl?.searchParams.get('domain')).toBe('acme.com');
    expect(result.data.org).toMatchObject({
      name: 'Acme',
      domain: 'acme.com',
      headcount: 500,
      foundedYear: 2010,
    });
  });

  it('throws when no domain is given', async () => {
    await expect(
      hunterAdapter.enrichOrg!({
        apiKey: 'hunter-test',
        identifiers: { name: 'Acme' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/--domain/);
  });
});

describe('hunterAdapter.lookupEmail', () => {
  it('GETs /v2/domain-search, normalizes per-email shape, exposes pattern + acceptAll', async () => {
    const result = await hunterAdapter.lookupEmail!({
      apiKey: 'hunter-test',
      filters: { domain: 'acme.com', department: 'engineering' },
      limit: 5,
      fetchFn: (async (url: string | URL | Request) => {
        const u = new URL(String(url));
        expect(u.pathname).toBe('/v2/domain-search');
        expect(u.searchParams.get('domain')).toBe('acme.com');
        expect(u.searchParams.get('department')).toBe('engineering');
        expect(u.searchParams.get('limit')).toBe('5');
        return okJson({
          data: {
            domain: 'acme.com',
            pattern: '{first}.{last}',
            accept_all: false,
            organization: 'Acme',
            emails: [
              {
                value: 'alice@acme.com',
                type: 'personal',
                confidence: 95,
                first_name: 'Alice',
                last_name: 'Smith',
                position: 'VP Eng',
                seniority: 'executive',
                department: 'engineering',
                verification: { status: 'valid' },
              },
            ],
          },
          meta: { results: 1 },
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
      department: 'engineering',
    });
  });
});

describe('hunterAdapter.verifyEmail', () => {
  it('returns deliverable=true on status=valid', async () => {
    const result = await hunterAdapter.verifyEmail!({
      apiKey: 'hunter-test',
      email: 'alice@acme.com',
      fetchFn: (async () =>
        okJson({
          data: {
            status: 'valid',
            email: 'alice@acme.com',
            score: 99,
            regexp: true,
            mx_records: true,
            smtp_check: true,
            accept_all: false,
            disposable: false,
            webmail: false,
            gibberish: false,
            block: false,
          },
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('valid');
    expect(result.data.score).toBe(99);
    expect(result.data.checks.mxRecords).toBe(true);
  });

  it('polls when 202, then returns final status', async () => {
    let calls = 0;
    const result = await hunterAdapter.verifyEmail!({
      apiKey: 'hunter-test',
      email: 'alice@acme.com',
      fetchFn: (async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({ data: { status: 'unknown', email: 'alice@acme.com' } }), {
            status: 202,
            headers: { 'content-type': 'application/json' },
          });
        }
        return okJson({ data: { status: 'invalid', email: 'alice@acme.com' } });
      }) as unknown as typeof fetch,
    });
    expect(calls).toBe(2);
    expect(result.data.status).toBe('invalid');
    expect(result.data.deliverable).toBe(false);
  }, 10_000);

  it('maps accept_all status to deliverable=true', async () => {
    const result = await hunterAdapter.verifyEmail!({
      apiKey: 'hunter-test',
      email: 'info@acme.com',
      fetchFn: (async () =>
        okJson({
          data: { status: 'accept_all', email: 'info@acme.com', accept_all: true },
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(true);
  });
});
