// @marmot-sh/brave — Brave Search adapter.

import {
  AICliError,
  WEB_PROVIDER_BASE_URLS,
  toAICliError,
  type WebAnswerInput,
  type WebAnswerResult,
  type WebProviderAdapter,
  type WebSearchInput,
  type WebSearchResult,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'brave' as const;

const BASE_URL = WEB_PROVIDER_BASE_URLS.brave;

type BraveWebResult = {
  url?: string;
  title?: string;
  description?: string;
  extra_snippets?: string[];
  age?: string;
};

type BraveSearchResponse = {
  web?: { results?: BraveWebResult[] };
  query?: { original?: string };
};

function buildBraveSearchUrl(input: WebSearchInput): string {
  const url = new URL(`${BASE_URL}/web/search`);
  url.searchParams.set('q', input.query);
  if (typeof input.limit === 'number') {
    // Brave caps at 20 per page. Higher limits would require pagination
    // which we'll add later if needed.
    url.searchParams.set('count', String(Math.min(input.limit, 20)));
  }
  if (input.freshness) {
    const map: Record<NonNullable<WebSearchInput['freshness']>, string> = {
      day: 'pd',
      week: 'pw',
      month: 'pm',
      year: 'py',
    };
    url.searchParams.set('freshness', map[input.freshness]);
  }
  return url.toString();
}

async function braveSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Brave Search requires --api-key or BRAVE_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const url = buildBraveSearchUrl(input);

  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: {
        accept: 'application/json',
        'X-Subscription-Token': input.apiKey,
      },
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Brave search request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Brave search failed with status ${response.status}.`,
    );
  }

  let payload: BraveSearchResponse;
  try {
    payload = (await response.json()) as BraveSearchResponse;
  } catch (error) {
    throw new AICliError('provider', 'Brave returned invalid JSON.', { cause: error });
  }

  const items = (payload.web?.results ?? []).map((r) => ({
    url: r.url ?? '',
    title: r.title ?? null,
    snippet: r.description ?? null,
    score: null,
    publishedAt: r.age ?? null,
    content: null,
  }));

  return {
    provider: 'brave',
    data: { results: items, total: items.length },
    raw: payload,
  };
}

async function braveFetchWithRetry(
  url: string,
  apiKey: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
  attempt = 0,
): Promise<Response> {
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal,
  });
  // Brave free tier ~1 req/s; chained calls hit 429. One retry after a
  // ~1.2s sleep covers the common case without making paid-tier users wait.
  if (response.status === 429 && attempt < 1) {
    await new Promise((r) => setTimeout(r, 1200));
    return braveFetchWithRetry(url, apiKey, fetchFn, signal, attempt + 1);
  }
  return response;
}

async function braveAnswer(input: WebAnswerInput): Promise<WebAnswerResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Brave Search requires --api-key or BRAVE_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;

  // Step 1: web/search with summary=1 to get a summarizer key.
  const searchUrl = new URL(`${BASE_URL}/web/search`);
  searchUrl.searchParams.set('q', input.query);
  searchUrl.searchParams.set('summary', '1');

  let stepOne: Response;
  try {
    stepOne = await braveFetchWithRetry(
      searchUrl.toString(),
      input.apiKey,
      fetchFn,
      input.abortSignal,
    );
  } catch (error) {
    throw toAICliError(error, 'network', 'Brave answer (search step) failed.');
  }
  if (!stepOne.ok) {
    const category =
      stepOne.status === 401 || stepOne.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Brave answer (search step) failed with status ${stepOne.status}.`,
    );
  }
  const searchPayload = (await stepOne.json()) as {
    summarizer?: { key?: string };
    web?: { results?: Array<{ url?: string; title?: string; description?: string }> };
  };
  const key = searchPayload.summarizer?.key;
  if (!key) {
    throw new AICliError(
      'provider',
      'Brave web/search did not return a summarizer key. Summarizer is a Pro-tier feature on Brave Search; free-tier keys never receive one. (If you are on Pro, the query may not be summarizable — try a more factual question.)',
    );
  }

  // Step 2: summarizer/search with that key.
  const sumUrl = new URL(`${BASE_URL}/summarizer/search`);
  sumUrl.searchParams.set('key', key);
  sumUrl.searchParams.set('inline_references', '1');

  let stepTwo: Response;
  try {
    stepTwo = await braveFetchWithRetry(
      sumUrl.toString(),
      input.apiKey,
      fetchFn,
      input.abortSignal,
    );
  } catch (error) {
    throw toAICliError(error, 'network', 'Brave summarizer step failed.');
  }
  if (!stepTwo.ok) {
    const category =
      stepTwo.status === 401 || stepTwo.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Brave summarizer failed with status ${stepTwo.status}.`,
    );
  }
  const sumPayload = (await stepTwo.json()) as {
    summary?: Array<{ data?: string; type?: string }>;
    title?: string;
  };

  const answer = (sumPayload.summary ?? [])
    .map((s) => s.data ?? '')
    .join('')
    .trim();

  const citations = (searchPayload.web?.results ?? [])
    .slice(0, input.maxCitations ?? 8)
    .map((r) => ({
      url: r.url ?? '',
      title: r.title ?? null,
      snippet: r.description ?? null,
    }));

  return {
    provider: 'brave',
    data: { answer, citations },
    raw: { search: searchPayload, summarizer: sumPayload },
  };
}

export const braveAdapter: WebProviderAdapter = {
  slug: 'brave',
  name: 'Brave Search',
  requiresApiKey: true,
  capabilities: {
    search: true,
    scrape: false,
    research: false,
    answer: true,
    crawl: false,
    map: false,
    findall: false,
  },
  search: braveSearch,
  answer: braveAnswer,
};
