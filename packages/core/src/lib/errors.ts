export const ERROR_CATEGORIES = [
  'validation',
  'auth',
  'cache',
  'network',
  'provider',
  'io',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

type ErrorOptions = {
  cause?: unknown;
};

export class AICliError extends Error {
  readonly category: ErrorCategory;

  constructor(category: ErrorCategory, message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'AICliError';
    this.category = category;
  }
}

export function isAICliError(error: unknown): error is AICliError {
  return error instanceof AICliError;
}

export function toAICliError(
  error: unknown,
  fallbackCategory: ErrorCategory,
  fallbackMessage?: string,
): AICliError {
  if (error instanceof AICliError) {
    // Recategorize auth-shaped provider errors so the CLI can show a
    // useful hint and return a stable exit code. Providers throw with
    // category 'provider' for any non-2xx, but 401/403 are user-fix-able
    // and deserve their own treatment. Inspect the message AND the
    // underlying cause chain (provider SDKs often hide the status text
    // one or two levels deep).
    if (
      error.category === 'provider' &&
      (looksLikeAuthError(error.message) || causeLooksLikeAuthError(error.cause))
    ) {
      return new AICliError('auth', error.message, { cause: error.cause });
    }
    return error;
  }

  if (error instanceof TypeError) {
    return new AICliError(
      'network',
      fallbackMessage ?? error.message,
      { cause: error },
    );
  }

  const errorCode = getErrorCode(error);

  if (errorCode && ['ENOENT', 'EACCES', 'EISDIR', 'ENOTDIR'].includes(errorCode)) {
    return new AICliError(
      'io',
      fallbackMessage ?? getErrorMessage(error, 'I/O failure.'),
      { cause: error },
    );
  }

  // For unwrapped errors with a fallbackMessage, peek at the underlying
  // text first — it often carries the real signal the wrapping is hiding
  // (e.g. "401 Unauthorized"). If it looks auth-shaped, route to 'auth'
  // instead of the default fallback category.
  const underlyingMessage = getErrorMessage(error, '');
  if (underlyingMessage && looksLikeAuthError(underlyingMessage)) {
    return new AICliError(
      'auth',
      fallbackMessage
        ? `${fallbackMessage} (${underlyingMessage})`
        : underlyingMessage,
      { cause: error },
    );
  }

  return new AICliError(
    fallbackCategory,
    fallbackMessage ?? getErrorMessage(error, 'Unknown failure.'),
    { cause: error },
  );
}

function causeLooksLikeAuthError(cause: unknown, depth = 0): boolean {
  if (!cause || depth > 3) return false;
  if (cause instanceof Error) {
    if (looksLikeAuthError(cause.message)) return true;
    if ('cause' in cause && cause.cause) {
      return causeLooksLikeAuthError(cause.cause, depth + 1);
    }
  }
  return false;
}

/**
 * Stable exit codes per error category. Stable enough that agent harnesses
 * and CI scripts can branch on `$?`. 0 = success, 2 = misuse / bad invocation
 * (matches commander/getopt convention), other categories get distinct codes.
 */
export function getExitCode(error: unknown): number {
  if (!isAICliError(error)) return 1;
  switch (error.category) {
    case 'validation':
      return 2;
    case 'auth':
      return 3;
    case 'network':
      return 4;
    case 'provider':
      return 5;
    case 'io':
      return 6;
    case 'cache':
      return 7;
    default:
      return 1;
  }
}

export function formatCliError(error: unknown): string {
  const cliError = toAICliError(error, 'provider', 'Unexpected failure.');
  const base = `[${cliError.category}] ${cliError.message}`;
  if (cliError.category === 'auth') {
    return `${base}\nHint: check the relevant API key env var (e.g. OPENROUTER_API_KEY) or pass --api-key.`;
  }
  return base;
}

/**
 * JSON-shaped error envelope. Agent harnesses and scripts that pass --json
 * can grep stderr for `"ok":false` to detect failures without parsing
 * human-formatted text. Returns a single line, no trailing newline.
 */
export function formatCliErrorJson(error: unknown): string {
  const cliError = toAICliError(error, 'provider', 'Unexpected failure.');
  return JSON.stringify({
    ok: false,
    error: {
      category: cliError.category,
      message: cliError.message,
    },
  });
}

function looksLikeAuthError(message: string): boolean {
  const m = message.toLowerCase();
  // Match HTTP status codes, common auth error vocabulary, and provider-
  // specific phrasings ("API key", "authentication", "credentials").
  return (
    /\b(401|403)\b/.test(m) ||
    m.includes('unauthorized') ||
    m.includes('authentication') ||
    m.includes('invalid api key') ||
    m.includes('invalid_api_key') ||
    m.includes('missing api key') ||
    m.includes('api key is required') ||
    m.includes('forbidden')
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}
