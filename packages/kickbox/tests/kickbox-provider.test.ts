import { describe, expect, it } from 'vitest';

import { kickboxAdapter } from '../src/index.js';

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

describe('kickboxAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(kickboxAdapter.slug).toBe('kickbox');
    expect(kickboxAdapter.name).toBe('Kickbox');
    expect(kickboxAdapter.requiresApiKey).toBe(true);
    expect(kickboxAdapter.capabilities).toEqual({
      enrichPerson: false,
      enrichOrg: false,
      lookupPerson: false,
      lookupOrg: false,
      lookupEmail: false,
      verifyEmail: true,
    });
    expect(typeof kickboxAdapter.verifyEmail).toBe('function');
    expect(kickboxAdapter.enrichPerson).toBeUndefined();
    expect(kickboxAdapter.enrichOrg).toBeUndefined();
    expect(kickboxAdapter.lookupPerson).toBeUndefined();
  });
});

describe('kickboxAdapter.verifyEmail', () => {
  it('GETs /v2/verify with Authorization header (no Bearer prefix)', async () => {
    let capturedUrl: URL | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await kickboxAdapter.verifyEmail!({
      apiKey: 'test_kickbox_key',
      email: 'alice@acme.com',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = new URL(String(url));
        capturedHeaders = init?.headers as Record<string, string>;
        return okJson({
          result: 'deliverable',
          reason: 'accepted_email',
          role: false,
          free: false,
          disposable: false,
          accept_all: false,
          did_you_mean: null,
          sendex: 0.92,
          email: 'alice@acme.com',
          user: 'alice',
          domain: 'acme.com',
          success: true,
        });
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl?.pathname).toBe('/v2/verify');
    expect(capturedUrl?.searchParams.get('email')).toBe('alice@acme.com');
    expect(capturedHeaders?.Authorization).toBe('test_kickbox_key');
    // Specifically: no Bearer prefix
    expect(capturedHeaders?.Authorization?.startsWith('Bearer')).toBe(false);

    expect(result.provider).toBe('kickbox');
    expect(result.data.email).toBe('alice@acme.com');
    expect(result.data.deliverable).toBe(true);
    expect(result.data.status).toBe('deliverable');
    // Sendex 0.92 → 92 on the 0-100 scale
    expect(result.data.score).toBe(92);
    expect(result.data.checks.acceptAll).toBe(false);
    expect(result.data.checks.disposable).toBe(false);
    expect(result.data.checks.webmail).toBe(false);
    expect(result.data.checks.smtpCheck).toBe(true);
  });

  it('returns deliverable=false on result=undeliverable', async () => {
    const result = await kickboxAdapter.verifyEmail!({
      apiKey: 'k',
      email: 'noone@nowhere.test',
      fetchFn: (async () =>
        okJson({
          result: 'undeliverable',
          reason: 'rejected_email',
          email: 'noone@nowhere.test',
          sendex: 0.05,
          success: true,
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('undeliverable');
    expect(result.data.score).toBe(5);
  });

  it('returns deliverable=false on result=risky (catch-all domains)', async () => {
    const result = await kickboxAdapter.verifyEmail!({
      apiKey: 'k',
      email: 'info@acme.com',
      fetchFn: (async () =>
        okJson({
          result: 'risky',
          reason: 'low_deliverability',
          accept_all: true,
          email: 'info@acme.com',
          sendex: 0.55,
          success: true,
        })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('risky');
    expect(result.data.checks.acceptAll).toBe(true);
  });

  it('returns deliverable=false on result=unknown', async () => {
    const result = await kickboxAdapter.verifyEmail!({
      apiKey: 'k',
      email: 'a@b.com',
      fetchFn: (async () =>
        okJson({ result: 'unknown', reason: 'no_connect', success: true })) as unknown as typeof fetch,
    });
    expect(result.data.deliverable).toBe(false);
    expect(result.data.status).toBe('unknown');
    expect(result.data.checks.smtpServer).toBe(false);
  });

  it('flags disposable / role / freemail in checks', async () => {
    const result = await kickboxAdapter.verifyEmail!({
      apiKey: 'k',
      email: 'sales@gmail.com',
      fetchFn: (async () =>
        okJson({
          result: 'risky',
          reason: 'low_quality',
          role: true,
          free: true,
          disposable: false,
          accept_all: false,
          email: 'sales@gmail.com',
          sendex: 0.3,
          success: true,
        })) as unknown as typeof fetch,
    });
    expect(result.data.checks.webmail).toBe(true);
    expect(result.data.checks.block).toBe(true);
    expect(result.data.checks.disposable).toBe(false);
  });

  it('throws auth error when no api key', async () => {
    await expect(
      kickboxAdapter.verifyEmail!({
        email: 'a@b.com',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/KICKBOX_API_KEY/);
  });

  it('promotes 200 + success=false (api key error) into auth-category AICliError', async () => {
    await expect(
      kickboxAdapter.verifyEmail!({
        apiKey: 'bad-key',
        email: 'a@b.com',
        fetchFn: (async () =>
          okJson({ success: false, message: 'Invalid API key' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'auth' });
  });

  it('promotes 200 + success=false (other error) into provider-category', async () => {
    await expect(
      kickboxAdapter.verifyEmail!({
        apiKey: 'k',
        email: 'a@b.com',
        fetchFn: (async () =>
          okJson({ success: false, message: 'Account suspended' })) as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });

  it('maps 401 to auth and 500 to provider', async () => {
    await expect(
      kickboxAdapter.verifyEmail!({
        apiKey: 'k',
        email: 'a@b.com',
        fetchFn: errStatus(401),
      }),
    ).rejects.toMatchObject({ category: 'auth' });
    await expect(
      kickboxAdapter.verifyEmail!({
        apiKey: 'k',
        email: 'a@b.com',
        fetchFn: errStatus(500),
      }),
    ).rejects.toMatchObject({ category: 'provider' });
  });

  it('preserves Kickbox payload under raw', async () => {
    const result = await kickboxAdapter.verifyEmail!({
      apiKey: 'k',
      email: 'a@b.com',
      fetchFn: (async () =>
        okJson({
          result: 'deliverable',
          email: 'a@b.com',
          sendex: 0.85,
          success: true,
          did_you_mean: 'a@bb.com',
        })) as unknown as typeof fetch,
    });
    expect(result.raw).toMatchObject({ did_you_mean: 'a@bb.com', sendex: 0.85 });
  });
});
