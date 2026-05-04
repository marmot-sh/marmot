import { describe, expect, it } from 'vitest';

import { bouncerAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errJson = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('bouncerAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(bouncerAdapter.slug).toBe('bouncer');
    expect(bouncerAdapter.name).toBe('Bouncer');
    expect(bouncerAdapter.requiresApiKey).toBe(true);
    expect(bouncerAdapter.capabilities).toEqual({
      enrichPerson: false,
      enrichOrg: false,
      lookupPerson: false,
      lookupOrg: false,
      lookupEmail: false,
      verifyEmail: true,
    });
    expect(typeof bouncerAdapter.verifyEmail).toBe('function');
    expect(bouncerAdapter.enrichPerson).toBeUndefined();
    expect(bouncerAdapter.enrichOrg).toBeUndefined();
    expect(bouncerAdapter.lookupPerson).toBeUndefined();
    expect(bouncerAdapter.lookupOrg).toBeUndefined();
    expect(bouncerAdapter.lookupEmail).toBeUndefined();
  });
});

describe('bouncerAdapter.verifyEmail', () => {
  it('returns deliverable=true when status=deliverable and uses x-api-key auth', async () => {
    let capturedUrl: URL | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await bouncerAdapter.verifyEmail!({
      apiKey: 'bk_test',
      email: 'alice@acme.com',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = new URL(String(url));
        capturedHeaders = init?.headers as Record<string, string>;
        return okJson({
          email: 'alice@acme.com',
          status: 'deliverable',
          reason: 'accepted_email',
          domain: { name: 'acme.com', acceptAll: false, disposable: false, free: false },
          account: { role: false, disabled: false, fullMailbox: false },
          dns: { type: 'MX', record: 'aspmx.l.google.com' },
          provider: 'google.com',
          score: 95,
          toxic: 'safe',
          toxicity: 0,
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v1.1/email/verify');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');
    expect(capturedHeaders?.['x-api-key']).toBe('bk_test');

    expect(result.provider).toBe('bouncer');
    expect(result.data).toMatchObject({
      email: 'alice@acme.com',
      deliverable: true,
      status: 'deliverable',
      score: 95,
    });
    expect(result.data.checks).toMatchObject({
      mxRecords: true,
      acceptAll: false,
      disposable: false,
      webmail: false,
    });
  });

  it('preserves toxicity and provider on result.raw for --raw callers', async () => {
    const result = await bouncerAdapter.verifyEmail!({
      apiKey: 'bk_test',
      email: 'risky@example.com',
      fetchFn: (async () =>
        okJson({
          email: 'risky@example.com',
          status: 'risky',
          reason: 'low_quality',
          domain: { name: 'example.com', acceptAll: true, disposable: false, free: false },
          provider: 'outlook.com',
          score: 50,
          toxic: 'risky',
          toxicity: 4,
        })) as unknown as typeof fetch,
    });

    const raw = result.raw as {
      toxicity?: number;
      provider?: string;
      toxic?: string;
    };
    expect(raw.toxicity).toBe(4);
    expect(raw.provider).toBe('outlook.com');
    expect(raw.toxic).toBe('risky');
  });

  it('maps undeliverable status to deliverable=false', async () => {
    const result = await bouncerAdapter.verifyEmail!({
      apiKey: 'bk_test',
      email: 'noone@nope.test',
      fetchFn: (async () =>
        okJson({
          email: 'noone@nope.test',
          status: 'undeliverable',
          reason: 'invalid_email',
          domain: { name: 'nope.test' },
          score: 0,
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('undeliverable');
  });

  it('maps risky status to deliverable=false', async () => {
    const result = await bouncerAdapter.verifyEmail!({
      apiKey: 'bk_test',
      email: 'maybe@example.com',
      fetchFn: (async () =>
        okJson({
          email: 'maybe@example.com',
          status: 'risky',
          reason: 'low_deliverability',
          score: 40,
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('risky');
  });

  it('maps unknown status to deliverable=false', async () => {
    const result = await bouncerAdapter.verifyEmail!({
      apiKey: 'bk_test',
      email: 'mystery@example.com',
      fetchFn: (async () =>
        okJson({
          email: 'mystery@example.com',
          status: 'unknown',
          reason: 'timeout',
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('unknown');
  });

  it('downgrades greylisted addresses (retryAfter set) to status=unknown', async () => {
    const result = await bouncerAdapter.verifyEmail!({
      apiKey: 'bk_test',
      email: 'grey@example.com',
      fetchFn: (async () =>
        okJson({
          email: 'grey@example.com',
          status: 'risky',
          reason: 'unavailable_smtp',
          retryAfter: '2026-05-02T12:00:00Z',
        })) as unknown as typeof fetch,
    });
    expect(result.data.status).toBe('unknown');
    expect(result.data.deliverable).toBe(false);
    const raw = result.raw as { retryAfter?: string };
    expect(raw.retryAfter).toBe('2026-05-02T12:00:00Z');
  });

  it('throws auth error when apiKey is missing', async () => {
    await expect(
      bouncerAdapter.verifyEmail!({
        email: 'a@b.com',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/Bouncer requires/);
  });

  it('maps 401 to AICliError with category=auth', async () => {
    await expect(
      bouncerAdapter.verifyEmail!({
        apiKey: 'bad',
        email: 'a@b.com',
        fetchFn: (async () =>
          errJson({ status: '401', error: 'Unauthorized', message: 'Invalid API key' }, 401)) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('maps 500 to AICliError with category=provider', async () => {
    await expect(
      bouncerAdapter.verifyEmail!({
        apiKey: 'bk_test',
        email: 'a@b.com',
        fetchFn: (async () =>
          errJson({ status: '500', error: 'Internal Server Error' }, 500)) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });
});
