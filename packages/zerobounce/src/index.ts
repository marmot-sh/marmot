// @marmot-sh/zerobounce — ZeroBounce adapter.
//
// Backs marmot's verify --type email cell. ZeroBounce's `/v2/validate`
// returns the deepest sub_status taxonomy in the verifier set; the adapter
// preserves the raw payload and projects to marmot's normalized envelope.

import {
  AICliError,
  DATA_PROVIDER_BASE_URLS,
  toAICliError,
  type DataProviderAdapter,
  type DataVerifyEmailInput,
  type DataVerifyEmailResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'zerobounce' as const;

// NOTE: ZeroBounce also exposes regional hostnames `api-us.zerobounce.net`
// and `api-eu.zerobounce.net` for data-residency pinning. v1 of this adapter
// uses only the default. Regional URL selection is a future enhancement.
const BASE_URL = DATA_PROVIDER_BASE_URLS.zerobounce;

type ZeroBounceValidateResponse = {
  address?: string;
  status?: string;
  sub_status?: string;
  free_email?: boolean | string;
  did_you_mean?: string | null;
  account?: string | null;
  domain?: string | null;
  domain_age_days?: string | number | null;
  smtp_provider?: string | null;
  mx_record?: string | null;
  mx_found?: boolean | string;
  firstname?: string | null;
  lastname?: string | null;
  gender?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  zipcode?: string | null;
  processed_at?: string;
  error?: string;
};

function authError(): AICliError {
  return new AICliError(
    'auth',
    'ZeroBounce requires --api-key or ZEROBOUNCE_API_KEY.',
  );
}

function categoryFor(status: number): 'auth' | 'provider' {
  return status === 401 || status === 403 ? 'auth' : 'provider';
}

/**
 * Coerce ZeroBounce's boolean-ish field into a real boolean.
 * ZeroBounce returns string-encoded booleans ("true"/"false") for some
 * fields like `mx_found` and `free_email`; tolerate either shape.
 */
function parseBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true') return true;
    if (v === 'false') return false;
  }
  return null;
}

const DISPOSABLE_SUB_STATUSES = new Set(['disposable']);
const SMTP_FAIL_SUB_STATUSES = new Set([
  'failed_smtp_connection',
  'forcible_disconnect',
  'mail_server_did_not_respond',
  'mail_server_temporary_error',
]);
const REGEX_FAIL_SUB_STATUSES = new Set([
  'invalid_email_format',
  'invalid_email',
  'invalid_address',
  'leading_period_removed',
]);
const BLOCK_SUB_STATUSES = new Set([
  'global_suppression',
  'antispam_system',
  'unroutable_ip_address',
  'does_not_accept_mail',
]);
const GIBBERISH_SUB_STATUSES = new Set(['possible_typo', 'alias_address']);

async function zerobounceVerifyEmail(
  input: DataVerifyEmailInput,
): Promise<DataVerifyEmailResult> {
  if (!input.apiKey) throw authError();
  const fetchFn = input.fetchFn ?? fetch;

  const params = new URLSearchParams({
    api_key: input.apiKey,
    email: input.email,
  });

  const url = `${BASE_URL}/validate?${params.toString()}`;

  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'ZeroBounce /validate request failed.');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new AICliError(
      categoryFor(response.status),
      `ZeroBounce /validate failed with status ${response.status}. ${text.slice(0, 400)}`,
    );
  }

  const payload = (await response.json()) as ZeroBounceValidateResponse;

  // ZeroBounce occasionally returns 200 with an `error` field (e.g. invalid
  // API key, malformed input). Promote that into a structured error.
  if (payload.error) {
    const message = payload.error;
    const isAuthError = /api[\s_-]?key/i.test(message);
    throw new AICliError(
      isAuthError ? 'auth' : 'provider',
      `ZeroBounce /validate returned error: ${message}`,
    );
  }

  const status = (payload.status ?? 'unknown').toLowerCase();
  const subStatus = (payload.sub_status ?? '').toLowerCase();

  const deliverable = status === 'valid' || status === 'catch-all';
  const acceptAll = status === 'catch-all';
  const mxRecords = parseBool(payload.mx_found);
  const webmail = parseBool(payload.free_email);

  const regexp = subStatus
    ? !REGEX_FAIL_SUB_STATUSES.has(subStatus)
    : status !== 'invalid' || null;
  const smtpServer = subStatus ? !SMTP_FAIL_SUB_STATUSES.has(subStatus) : null;
  const smtpCheck = status === 'valid';
  const disposable = subStatus ? DISPOSABLE_SUB_STATUSES.has(subStatus) : null;
  const gibberish = subStatus ? GIBBERISH_SUB_STATUSES.has(subStatus) : null;
  const block = subStatus ? BLOCK_SUB_STATUSES.has(subStatus) : null;

  return {
    provider: 'zerobounce',
    data: {
      email: payload.address ?? input.email,
      deliverable,
      status,
      // ZeroBounce's /validate has no numeric score; AI scoring is a separate
      // async file-only endpoint and is out of scope for v1.
      score: null,
      checks: {
        regexp: typeof regexp === 'boolean' ? regexp : null,
        mxRecords,
        smtpServer,
        smtpCheck,
        acceptAll,
        disposable,
        webmail,
        gibberish,
        block,
      },
    },
    raw: payload,
  };
}

export const zerobounceAdapter: DataProviderAdapter = {
  slug: 'zerobounce',
  name: 'ZeroBounce',
  requiresApiKey: true,
  capabilities: {
    enrichPerson: false,
    enrichOrg: false,
    lookupPerson: false,
    lookupOrg: false,
    lookupEmail: false,
    verifyEmail: true,
  },
  verifyEmail: zerobounceVerifyEmail,
};
