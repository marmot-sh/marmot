import { describe, expect, it } from 'vitest';

import { datagmaAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errJson = (status: number, body: unknown = { error: 'nope' }): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('datagmaAdapter shape', () => {
  it('declares the expected slug, name, and capabilities', () => {
    expect(datagmaAdapter.slug).toBe('datagma');
    expect(datagmaAdapter.name).toBe('Datagma');
    expect(datagmaAdapter.requiresApiKey).toBe(true);
    expect(datagmaAdapter.capabilities).toEqual({
      enrichPerson: true,
      enrichOrg: false,
      lookupPerson: false,
      lookupOrg: false,
      lookupEmail: false,
      verifyEmail: true,
    });
    expect(datagmaAdapter.enrichPerson).toBeDefined();
    expect(datagmaAdapter.verifyEmail).toBeDefined();
    expect(datagmaAdapter.enrichOrg).toBeUndefined();
    expect(datagmaAdapter.lookupPerson).toBeUndefined();
    expect(datagmaAdapter.lookupOrg).toBeUndefined();
    expect(datagmaAdapter.lookupEmail).toBeUndefined();
  });
});

describe('datagmaAdapter.enrichPerson', () => {
  it('GETs /full with email, captures phone, full name, title, and org info', async () => {
    let capturedUrl: URL | undefined;
    const result = await datagmaAdapter.enrichPerson!({
      apiKey: 'dk',
      identifiers: { email: 'alice@acme.com' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          person: {
            id: 'p1',
            fullName: 'Alice Smith',
            firstName: 'Alice',
            lastName: 'Smith',
            email: 'alice@acme.com',
            mobilePhone: '+15551234567',
            jobTitle: 'VP Engineering',
            seniority: 'executive',
            department: 'engineering',
            linkedInUrl: 'https://linkedin.com/in/alice',
            confidence: 92,
            city: 'San Francisco',
            country: 'United States',
          },
          company: {
            id: 'c1',
            name: 'Acme',
            domain: 'acme.com',
            industry: 'software',
            employeeCount: 500,
            employeeRange: '501-1000',
            foundedYear: 2010,
          },
        });
      }) as unknown as typeof fetch,
    });

    // Authenticates via ?apiId= query parameter and routes to /full.
    expect(capturedUrl?.pathname).toBe('/api/ingress/v8/full');
    expect(capturedUrl?.searchParams.get('apiId')).toBe('dk');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');
    expect(capturedUrl?.searchParams.get('phoneFull')).toBe('true');

    expect(result.provider).toBe('datagma');
    expect(result.data.person).toMatchObject({
      fullName: 'Alice Smith',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@acme.com',
      // Mobile phone is the Datagma differentiator — must surface on the envelope.
      phone: '+15551234567',
      title: 'VP Engineering',
      seniority: 'executive',
      department: 'engineering',
      linkedin: 'https://linkedin.com/in/alice',
      providerId: 'p1',
      confidence: 92,
      location: 'San Francisco, United States',
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

  it('routes linkedin → /full with username param', async () => {
    let capturedUrl: URL | undefined;
    await datagmaAdapter.enrichPerson!({
      apiKey: 'dk',
      identifiers: { linkedin: 'https://linkedin.com/in/alice' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({ person: { fullName: 'Alice Smith' } });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl?.searchParams.get('username')).toBe(
      'https://linkedin.com/in/alice',
    );
    expect(capturedUrl?.searchParams.get('email')).toBeNull();
  });

  it('routes firstName+lastName+company → /full with fullName + company params', async () => {
    let capturedUrl: URL | undefined;
    await datagmaAdapter.enrichPerson!({
      apiKey: 'dk',
      identifiers: { firstName: 'Alice', lastName: 'Smith', company: 'Acme' },
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({ person: { fullName: 'Alice Smith' } });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl?.searchParams.get('fullName')).toBe('Alice Smith');
    expect(capturedUrl?.searchParams.get('company')).toBe('Acme');
  });

  it('captures phones[] when Datagma returns a phone array rather than mobilePhone', async () => {
    const result = await datagmaAdapter.enrichPerson!({
      apiKey: 'dk',
      identifiers: { email: 'a@b.com' },
      fetchFn: (async () =>
        okJson({
          person: {
            fullName: 'Bob',
            phones: [{ number: '+15555550100', type: 'mobile' }],
          },
        })) as unknown as typeof fetch,
    });
    expect(result.data.person?.phone).toBe('+15555550100');
  });

  it('throws validation when no required identifier is provided', async () => {
    await expect(
      datagmaAdapter.enrichPerson!({
        apiKey: 'dk',
        identifiers: { firstName: 'Alice' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/email.*linkedin.*first-name.*last-name.*company/);
  });

  it('returns {person: null} on 404', async () => {
    const result = await datagmaAdapter.enrichPerson!({
      apiKey: 'dk',
      identifiers: { email: 'unknown@nowhere.test' },
      fetchFn: (async () =>
        errJson(404, { error: 'not found' })) as unknown as typeof fetch,
    });
    expect(result.data.person).toBeNull();
  });

  it('returns {person: null} when payload has no person block', async () => {
    const result = await datagmaAdapter.enrichPerson!({
      apiKey: 'dk',
      identifiers: { email: 'alice@acme.com' },
      fetchFn: (async () => okJson({ company: { name: 'Acme' } })) as unknown as typeof fetch,
    });
    expect(result.data.person).toBeNull();
  });

  it('throws auth error when no apiKey is provided', async () => {
    await expect(
      datagmaAdapter.enrichPerson!({
        identifiers: { email: 'alice@acme.com' },
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Datagma requires --api-key or DATAGMA_API_KEY/);
  });

  it('maps 401 → AICliError category=auth', async () => {
    await expect(
      datagmaAdapter.enrichPerson!({
        apiKey: 'bad',
        identifiers: { email: 'alice@acme.com' },
        fetchFn: (async () => errJson(401, { error: 'bad key' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('maps 500 → AICliError category=provider', async () => {
    await expect(
      datagmaAdapter.enrichPerson!({
        apiKey: 'dk',
        identifiers: { email: 'alice@acme.com' },
        fetchFn: (async () => errJson(500, { error: 'boom' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });
});

describe('datagmaAdapter.verifyEmail', () => {
  it('maps status=valid → deliverable=true and surfaces score + checks', async () => {
    let capturedUrl: URL | undefined;
    const result = await datagmaAdapter.verifyEmail!({
      apiKey: 'dk',
      email: 'alice@acme.com',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          email: 'alice@acme.com',
          status: 'valid',
          score: 99,
          regex: true,
          mxRecord: true,
          smtpProvider: true,
          smtpCheck: true,
          acceptAll: false,
          disposable: false,
          freeEmail: false,
          gibberish: false,
          block: false,
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/api/ingress/v8/email');
    expect(capturedUrl?.searchParams.get('apiId')).toBe('dk');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');

    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('valid');
    expect(result.data.score).toBe(99);
    expect(result.data.checks).toEqual({
      regexp: true,
      mxRecords: true,
      smtpServer: true,
      smtpCheck: true,
      acceptAll: false,
      disposable: false,
      webmail: false,
      gibberish: false,
      block: false,
    });
  });

  it('maps status=catch-all → deliverable=true', async () => {
    const result = await datagmaAdapter.verifyEmail!({
      apiKey: 'dk',
      email: 'info@acme.com',
      fetchFn: (async () =>
        okJson({
          email: 'info@acme.com',
          status: 'catch-all',
          catchAll: true,
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('catch-all');
    expect(result.data.checks.acceptAll).toBe(true);
  });

  it('maps status=invalid → deliverable=false', async () => {
    const result = await datagmaAdapter.verifyEmail!({
      apiKey: 'dk',
      email: 'nobody@nowhere.test',
      fetchFn: (async () =>
        okJson({
          email: 'nobody@nowhere.test',
          status: 'invalid',
          regex: true,
          mxRecord: false,
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('invalid');
    expect(result.data.checks.regexp).toBe(true);
    expect(result.data.checks.mxRecords).toBe(false);
  });

  it('maps status=do_not_mail (risky) → deliverable=false', async () => {
    const result = await datagmaAdapter.verifyEmail!({
      apiKey: 'dk',
      email: 'spamtrap@acme.com',
      fetchFn: (async () =>
        okJson({ email: 'spamtrap@acme.com', status: 'do_not_mail' })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('do_not_mail');
  });

  it('throws auth error when no apiKey is provided', async () => {
    await expect(
      datagmaAdapter.verifyEmail!({
        email: 'a@b.com',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Datagma requires --api-key or DATAGMA_API_KEY/);
  });

  it('maps 401 → AICliError category=auth', async () => {
    await expect(
      datagmaAdapter.verifyEmail!({
        apiKey: 'bad',
        email: 'a@b.com',
        fetchFn: (async () => errJson(401, { error: 'bad key' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('maps 500 → AICliError category=provider', async () => {
    await expect(
      datagmaAdapter.verifyEmail!({
        apiKey: 'dk',
        email: 'a@b.com',
        fetchFn: (async () => errJson(500, { error: 'boom' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });
});
