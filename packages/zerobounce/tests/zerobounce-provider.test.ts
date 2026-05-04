import { describe, expect, it } from 'vitest';

import { zerobounceAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('zerobounceAdapter shape', () => {
  it('declares the expected slug, name, and capabilities', () => {
    expect(zerobounceAdapter.slug).toBe('zerobounce');
    expect(zerobounceAdapter.name).toBe('ZeroBounce');
    expect(zerobounceAdapter.requiresApiKey).toBe(true);
    expect(zerobounceAdapter.capabilities).toEqual({
      enrichPerson: false,
      enrichOrg: false,
      lookupPerson: false,
      lookupOrg: false,
      lookupEmail: false,
      verifyEmail: true,
    });
  });

  it('exposes only verifyEmail among adapter methods', () => {
    expect(typeof zerobounceAdapter.verifyEmail).toBe('function');
    expect(zerobounceAdapter.enrichPerson).toBeUndefined();
    expect(zerobounceAdapter.enrichOrg).toBeUndefined();
    expect(zerobounceAdapter.lookupPerson).toBeUndefined();
    expect(zerobounceAdapter.lookupOrg).toBeUndefined();
    expect(zerobounceAdapter.lookupEmail).toBeUndefined();
  });
});

describe('zerobounceAdapter.verifyEmail', () => {
  it('returns deliverable=true on status=valid and coerces mx_found="true"', async () => {
    let capturedUrl: URL | undefined;
    const result = await zerobounceAdapter.verifyEmail!({
      apiKey: 'test-key',
      email: 'alice@acme.com',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({
          address: 'alice@acme.com',
          status: 'valid',
          sub_status: '',
          free_email: 'false',
          mx_found: 'true',
          mx_record: 'mx.acme.com',
          smtp_provider: 'google',
          domain: 'acme.com',
          firstname: 'Alice',
          lastname: 'Smith',
          processed_at: '2026-05-02 12:00:00.000',
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v2/validate');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');

    expect(result.provider).toBe('zerobounce');
    expect(result.data.email).toBe('alice@acme.com');
    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('valid');
    expect(result.data.score).toBeNull();
    expect(result.data.checks.mxRecords).toBe(true);
    expect(result.data.checks.smtpCheck).toBe(true);
    expect(result.data.checks.acceptAll).toBe(false);
    expect(result.data.checks.webmail).toBe(false);
  });

  it('passes the api_key as a query parameter', async () => {
    let capturedUrl: URL | undefined;
    await zerobounceAdapter.verifyEmail!({
      apiKey: 'test-key',
      email: 'alice@acme.com',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = new URL(String(url));
        return okJson({ address: 'alice@acme.com', status: 'valid', mx_found: 'true' });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl?.searchParams.get('api_key')).toBe('test-key');
    expect(String(capturedUrl)).toContain('api_key=test-key');
  });

  it('returns deliverable=false on status=invalid', async () => {
    const result = await zerobounceAdapter.verifyEmail!({
      apiKey: 'test-key',
      email: 'bogus@nowhere.tld',
      fetchFn: (async () =>
        okJson({
          address: 'bogus@nowhere.tld',
          status: 'invalid',
          sub_status: 'mailbox_not_found',
          mx_found: 'true',
          free_email: 'false',
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('invalid');
    expect(result.data.checks.smtpCheck).toBe(false);
    expect(result.data.checks.acceptAll).toBe(false);
  });

  it('treats catch-all as deliverable=true with acceptAll=true', async () => {
    const result = await zerobounceAdapter.verifyEmail!({
      apiKey: 'test-key',
      email: 'info@acme.com',
      fetchFn: (async () =>
        okJson({
          address: 'info@acme.com',
          status: 'catch-all',
          sub_status: '',
          mx_found: 'true',
          free_email: 'false',
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('catch-all');
    expect(result.data.checks.acceptAll).toBe(true);
    // smtpCheck only true on status=valid
    expect(result.data.checks.smtpCheck).toBe(false);
  });

  it('flags disposable from sub_status', async () => {
    const result = await zerobounceAdapter.verifyEmail!({
      apiKey: 'test-key',
      email: 'temp@mailinator.com',
      fetchFn: (async () =>
        okJson({
          address: 'temp@mailinator.com',
          status: 'do_not_mail',
          sub_status: 'disposable',
          mx_found: 'true',
          free_email: 'true',
        })) as unknown as typeof fetch,
    });
    expect(result.data.checks.disposable).toBe(true);
    expect(result.data.checks.webmail).toBe(true);
    expect(result.data.deliverable).toBe(false);
  });

  it('throws auth error when 200 body contains {error: "Invalid API Key"}', async () => {
    await expect(
      zerobounceAdapter.verifyEmail!({
        apiKey: 'bad-key',
        email: 'alice@acme.com',
        fetchFn: (async () => okJson({ error: 'Invalid API Key' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('throws auth error when no apiKey is supplied', async () => {
    await expect(
      zerobounceAdapter.verifyEmail!({
        email: 'alice@acme.com',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('maps 401 to AICliError category=auth', async () => {
    await expect(
      zerobounceAdapter.verifyEmail!({
        apiKey: 'test-key',
        email: 'alice@acme.com',
        fetchFn: (async () =>
          new Response('Unauthorized', { status: 401 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('maps 500 to AICliError category=provider', async () => {
    await expect(
      zerobounceAdapter.verifyEmail!({
        apiKey: 'test-key',
        email: 'alice@acme.com',
        fetchFn: (async () =>
          new Response('boom', { status: 500 })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });
});
