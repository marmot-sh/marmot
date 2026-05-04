// @marmot-sh/kickbox — Kickbox adapter.
//
// Backs marmot's verify --type email cell. Kickbox returns a clean four-value
// `result` taxonomy plus a 0-1 Sendex confidence score, and is owned by
// Sendgrid/Twilio. The free `open.kickbox.com/v1/disposable/{email}` endpoint
// is exposed as auxiliary; main verify uses /v2/verify with key auth.

import {
  AICliError,
  DATA_PROVIDER_BASE_URLS,
  toAICliError,
  type DataProviderAdapter,
  type DataVerifyEmailInput,
  type DataVerifyEmailResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'kickbox' as const;

const BASE_URL = DATA_PROVIDER_BASE_URLS.kickbox;

type KickboxVerifyResponse = {
  result?: 'deliverable' | 'undeliverable' | 'risky' | 'unknown';
  reason?: string;
  role?: boolean;
  free?: boolean;
  disposable?: boolean;
  accept_all?: boolean;
  did_you_mean?: string | null;
  sendex?: number;
  email?: string;
  user?: string;
  domain?: string;
  success?: boolean;
  message?: string;
};

function authError(): AICliError {
  return new AICliError('auth', 'Kickbox requires --api-key or KICKBOX_API_KEY.');
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

// Reasons that imply the SMTP probe failed to complete cleanly. Maps to
// checks.smtpServer = false.
const SMTP_FAIL_REASONS = new Set([
  'no_connect',
  'timeout',
  'unavailable_smtp',
  'invalid_smtp',
]);

// Reasons that imply the regex/parser rejected the address shape.
const REGEX_FAIL_REASONS = new Set(['invalid_email']);

async function kickboxVerifyEmail(
  input: DataVerifyEmailInput,
): Promise<DataVerifyEmailResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;

  const params = new URLSearchParams({ email: input.email });
  const url = `${BASE_URL}/verify?${params.toString()}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        // Kickbox accepts `Authorization: <key>` (no Bearer prefix) or
        // `?apikey=`; the header form is preferred since query strings leak
        // into proxy logs.
        Authorization: input.apiKey,
        accept: 'application/json',
      },
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Kickbox /v2/verify request failed.');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `Kickbox /v2/verify failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as KickboxVerifyResponse;

  // Kickbox occasionally returns 200 with success=false plus a message
  // (malformed key, suspended account). Promote into a structured error.
  if (payload.success === false) {
    const message = payload.message ?? 'Kickbox returned success=false';
    const isAuthError = /api\s?key|invalid\s?key|unauthorized/i.test(message);
    throw new AICliError(
      isAuthError ? 'auth' : 'provider',
      `Kickbox /v2/verify error: ${message}`,
    );
  }

  const result = (payload.result ?? 'unknown').toLowerCase();
  const reason = (payload.reason ?? '').toLowerCase();

  // Map Kickbox's four-value taxonomy onto marmot's normalized envelope.
  // `deliverable` is true only for the explicit "deliverable" outcome;
  // `accept_all` domains land in `risky` and intentionally do not count
  // as deliverable here.
  const deliverable = result === 'deliverable';
  const acceptAll = payload.accept_all ?? null;

  const regexp = reason ? !REGEX_FAIL_REASONS.has(reason) : null;
  const smtpServer = reason ? !SMTP_FAIL_REASONS.has(reason) : null;
  const smtpCheck = result === 'deliverable';

  return {
    provider: 'kickbox',
    data: {
      email: payload.email ?? input.email,
      deliverable,
      status: result,
      // Kickbox's Sendex (0-1) is its native confidence. Project to 0-100
      // to match the rest of the verify envelope's score scale.
      score: typeof payload.sendex === 'number' ? Math.round(payload.sendex * 100) : null,
      checks: {
        regexp,
        // Kickbox doesn't expose a raw MX-records boolean; smtpServer
        // covers the closest signal.
        mxRecords: null,
        smtpServer,
        smtpCheck,
        acceptAll,
        disposable: payload.disposable ?? null,
        webmail: payload.free ?? null,
        gibberish: null,
        // Role-based addresses (info@, sales@) are surfaced as block since
        // they're a deliverability red flag downstream.
        block: payload.role ?? null,
      },
    },
    raw: payload,
  };
}

export const kickboxAdapter: DataProviderAdapter = {
  slug: 'kickbox',
  name: 'Kickbox',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: false,
    enrichOrg: false,
    lookupPerson: false,
    lookupOrg: false,
    lookupEmail: false,
    verifyEmail: true,
  },
  verifyEmail: kickboxVerifyEmail,
};
