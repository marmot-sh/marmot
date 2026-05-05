// Shared helper for surfacing provider HTTP error bodies. Adapters all
// hit `if (!response.ok) throw with status N` -- the status alone is
// rarely actionable. This helper reads the body once and pulls out the
// most useful summary so users see *why* a 4xx happened instead of just
// "failed with status 400".

const MAX_BODY_PREVIEW = 200;

/**
 * Consume `response`'s body and return a short string suitable for
 * embedding in an error message:
 *   - JSON body with `{ error: { message } }` (OpenAI shape) → that message.
 *   - JSON body with a top-level `error` string → that string.
 *   - Any other text/JSON → first ~200 chars of raw body.
 *   - Empty body or read failure → empty string.
 *
 * Always returns a leading space + parenthesized fragment so callers
 * can append unconditionally:
 *   `provider error with status ${status}.${await readErrorBody(res)}`
 */
export async function readErrorBody(response: Response): Promise<string> {
  let raw: string;
  try {
    raw = (await response.text()).trim();
  } catch {
    return '';
  }
  if (!raw) return '';

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return formatPreview(raw);
  }

  const fromShape = pickMessageFromJson(parsed);
  if (fromShape) return ` (${truncate(fromShape)})`;
  return formatPreview(raw);
}

function pickMessageFromJson(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;

  if (typeof v.error === 'string') return v.error;
  if (v.error && typeof v.error === 'object') {
    const inner = v.error as Record<string, unknown>;
    if (typeof inner.message === 'string') return inner.message;
  }
  if (typeof v.message === 'string') return v.message;
  if (typeof v.detail === 'string') return v.detail;
  return undefined;
}

function formatPreview(raw: string): string {
  return ` (body: ${truncate(raw)})`;
}

function truncate(s: string): string {
  if (s.length <= MAX_BODY_PREVIEW) return s;
  return `${s.slice(0, MAX_BODY_PREVIEW)}…`;
}
