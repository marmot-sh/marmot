// @marmot-sh/bouncer — Bouncer adapter.
//
// Backs marmot's verify --type email cell. Single x-api-key auth.
// Bouncer-specific signals (toxicity 0-5, resolved MX provider, retryAfter
// for greylisting) are preserved on `result.raw` for --raw callers; the
// normalized envelope only carries the standard checks.

import {
  AICliError,
  DATA_PROVIDER_BASE_URLS,
  toAICliError,
  type DataProviderAdapter,
  type DataVerifyEmailInput,
  type DataVerifyEmailResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'bouncer' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.bouncer;

type BouncerDomain = {
  name?: string | null;
  acceptAll?: boolean | null;
  disposable?: boolean | null;
  free?: boolean | null;
};

type BouncerAccount = {
  role?: boolean | null;
  disabled?: boolean | null;
  fullMailbox?: boolean | null;
};

type BouncerVerifyResponse = {
  email?: string;
  status?: string;
  reason?: string;
  domain?: BouncerDomain;
  account?: BouncerAccount;
  dns?: { type?: string | null; record?: string | null } | null;
  provider?: string | null;
  score?: number | null;
  toxic?: string | null;
  toxicity?: number | null;
  retryAfter?: string | null;
  did_you_mean?: string | null;
  result_details?: string | null;
};

const authError = (): AICliError =>
  new AICliError('auth', 'Bouncer requires --api-key or BOUNCER_API_KEY.');

const categoryFor = (status: number): 'auth' | 'provider' =>
  status === 401 || status === 403 ? 'auth' : 'provider';

const bouncerGet = async (
  path: string,
  params: URLSearchParams,
  apiKey: string,
  fetchFn: typeof fetch,
  abortSignal: AbortSignal | undefined,
): Promise<Response> => {
  const url = `${BASE_URL}${path}?${params.toString()}`;
  try {
    return await fetchFn(url, {
      headers: {
        'x-api-key': apiKey,
        accept: 'application/json',
      },
      signal: abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', `Bouncer ${path} request failed.`);
  }
};

const bouncerVerifyEmail = async (
  input: DataVerifyEmailInput,
): Promise<DataVerifyEmailResult> => {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;
  const params = new URLSearchParams({ email: input.email });

  const response = await bouncerGet(
    '/email/verify',
    params,
    input.apiKey,
    fetchFn,
    input.abortSignal,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Bouncer email/verify failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as BouncerVerifyResponse;
  const rawStatus = (payload.status ?? 'unknown').toLowerCase();
  // Bouncer returns retryAfter for greylisted addresses; treat as `unknown`
  // so callers can re-check rather than marking the address terminal.
  const status = payload.retryAfter ? 'unknown' : rawStatus;
  const deliverable = status === 'deliverable';

  return {
    provider: 'bouncer',
    data: {
      email: payload.email ?? input.email,
      deliverable,
      status,
      score: typeof payload.score === 'number' ? payload.score : null,
      checks: {
        regexp: null,
        mxRecords: payload.dns?.record ? true : null,
        smtpServer: null,
        smtpCheck: null,
        acceptAll: payload.domain?.acceptAll ?? null,
        disposable: payload.domain?.disposable ?? null,
        webmail: payload.domain?.free ?? null,
        gibberish: null,
        block: null,
      },
    },
    raw: payload,
  };
};

export const bouncerAdapter: DataProviderAdapter = {
  slug: 'bouncer',
  name: 'Bouncer',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: false,
    enrichOrg: false,
    lookupPerson: false,
    lookupOrg: false,
    lookupEmail: false,
    verifyEmail: true,
  },
  verifyEmail: bouncerVerifyEmail,
};
