// @marmot-sh/exa — Exa adapter.

import {
  AICliError,
  WEB_PROVIDER_BASE_URLS,
  toAICliError,
  type WebAnswerInput,
  type WebAnswerResult,
  type WebFindallInput,
  type WebFindallSubmission,
  type WebProviderAdapter,
  type WebResearchInput,
  type WebResearchSubmission,
  type WebScrapeInput,
  type WebScrapeResult,
  type WebSearchInput,
  type WebSearchResult,
  type WebTaskStatus,
  type WebVerb,
} from '@marmot-sh/core';

export const PROVIDER_SLUG = 'exa' as const;

const BASE_URL = WEB_PROVIDER_BASE_URLS.exa;

type ExaResult = {
  url?: string;
  title?: string;
  score?: number;
  publishedDate?: string;
  author?: string;
  text?: string;
};

type ExaSearchResponse = {
  results?: ExaResult[];
  autopromptString?: string;
};

/** Convert marmot's relative freshness window to a `YYYY-MM-DD` floor
 *  for providers that only accept absolute date filtering. `now`
 *  defaulted for normal use; injectable for tests. */
function freshnessToIsoDate(
  freshness: NonNullable<WebSearchInput['freshness']>,
  now: Date = new Date(),
): string {
  const days = { day: 1, week: 7, month: 30, year: 365 }[freshness];
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

function depthToType(
  depth: WebSearchInput['depth'] | undefined,
): 'auto' | 'fast' | 'neural' {
  switch (depth) {
    case 'basic':
      return 'fast';
    case 'deep':
      return 'neural';
    case 'standard':
    default:
      return 'auto';
  }
}

async function exaSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    query: input.query,
    type: depthToType(input.depth),
  };
  if (typeof input.limit === 'number') body.numResults = input.limit;
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
  // Exa uses ISO-8601 datetimes for date filtering. Map from marmot's
  // YYYY-MM-DD afterDate/beforeDate (start of day for after, end of
  // day for before so the bound is inclusive of the named day) and
  // also map relative freshness to startPublishedDate when no
  // afterDate is set. Explicit afterDate wins over freshness.
  if (input.afterDate) {
    body.startPublishedDate = `${input.afterDate}T00:00:00.000Z`;
  } else if (input.freshness) {
    body.startPublishedDate = `${freshnessToIsoDate(input.freshness)}T00:00:00.000Z`;
  }
  if (input.beforeDate) {
    body.endPublishedDate = `${input.beforeDate}T23:59:59.999Z`;
  }
  if (input.includeContent) body.contents = { text: true };

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Exa search request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Exa search failed with status ${response.status}.`,
    );
  }

  let payload: ExaSearchResponse;
  try {
    payload = (await response.json()) as ExaSearchResponse;
  } catch (error) {
    throw new AICliError('provider', 'Exa returned invalid JSON.', { cause: error });
  }

  const items = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    title: r.title ?? null,
    snippet: r.text ? r.text.slice(0, 200) : null,
    score: typeof r.score === 'number' ? r.score : null,
    publishedAt: r.publishedDate ?? null,
    content: r.text ?? null,
  }));

  return {
    provider: 'exa',
    data: { results: items, total: items.length },
    raw: payload,
  };
}

async function exaScrape(input: WebScrapeInput): Promise<WebScrapeResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  }
  if (!input.urls.length) {
    throw new AICliError('validation', 'At least one URL is required for scrape.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    urls: input.urls,
    text: true,
  };

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/contents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Exa contents request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Exa contents failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    results?: Array<{ url?: string; title?: string; text?: string }>;
  };
  const pages = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    content: r.text ?? null,
    format: 'markdown' as const,
    title: r.title ?? null,
  }));
  const fetched = new Set(pages.map((p) => p.url));
  const failed = input.urls.filter((u) => !fetched.has(u));

  return {
    provider: 'exa',
    data: { pages, failed },
    raw: payload,
  };
}

async function exaAnswer(input: WebAnswerInput): Promise<WebAnswerResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    query: input.query,
    text: input.includeSearch ?? false,
  };

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/answer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Exa answer request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Exa answer failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    answer?: string;
    citations?: Array<{ url?: string; title?: string; snippet?: string }>;
  };

  const citations = (payload.citations ?? []).map((c) => ({
    url: c.url ?? '',
    title: c.title ?? null,
    snippet: c.snippet ?? null,
  }));

  return {
    provider: 'exa',
    data: { answer: payload.answer ?? '', citations },
    raw: payload,
  };
}

async function exaResearch(input: WebResearchInput): Promise<WebResearchSubmission> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    instructions: input.query,
  };
  if (input.schema) body.output = { schema: input.schema };
  if (input.depth === 'deep') body.model = 'exa-research-pro';
  else body.model = 'exa-research';

  const response = await fetchFn(`${BASE_URL}/research/v0/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
    },
    body: JSON.stringify(body),
    signal: input.abortSignal,
  });
  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Exa research submission failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new AICliError('provider', 'Exa research did not return a task id.');
  }
  return { taskId: payload.id };
}

async function exaFindall(input: WebFindallInput): Promise<WebFindallSubmission> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  // Websets API expects { search: { query, count? } }. The objective lives
  // under search.query; targetCount maps to search.count.
  const search: Record<string, unknown> = { query: input.objective };
  if (typeof input.limit === 'number') search.count = input.limit;
  const body: Record<string, unknown> = { search };

  const response = await fetchFn(`${BASE_URL}/websets/v0/websets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
    },
    body: JSON.stringify(body),
    signal: input.abortSignal,
  });
  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    const body = await response.text().catch(() => '');
    throw new AICliError(
      category,
      `Exa websets create failed with status ${response.status}. Response: ${body.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new AICliError('provider', 'Exa websets did not return a webset id.');
  }
  return { taskId: payload.id };
}

async function exaGetTask(input: {
  taskId: string;
  verb: WebVerb;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<WebTaskStatus> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Exa requires --api-key or EXA_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const url =
    input.verb === 'research'
      ? `${BASE_URL}/research/v0/tasks/${encodeURIComponent(input.taskId)}`
      : input.verb === 'findall'
        ? `${BASE_URL}/websets/v0/websets/${encodeURIComponent(input.taskId)}`
        : null;
  if (!url) {
    throw new AICliError(
      'validation',
      `Exa does not support task polling for verb "${input.verb}".`,
    );
  }
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      'x-api-key': input.apiKey,
    },
    signal: input.abortSignal,
  });
  if (response.status === 404) {
    throw new AICliError(
      'validation',
      `Task "${input.taskId}" not found on Exa.`,
    );
  }
  if (!response.ok) {
    throw new AICliError(
      'provider',
      `Exa task fetch failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    status?: string;
    output?: unknown;
    answer?: string;
    citations?: Array<{ url?: string; title?: string }>;
    items?: unknown[];
  };
  const rawStatus = (payload.status ?? 'running').toLowerCase();
  const status =
    rawStatus === 'completed' || rawStatus === 'done'
      ? 'done'
      : rawStatus === 'failed'
        ? 'failed'
        : rawStatus === 'cancelled'
          ? 'cancelled'
          : rawStatus === 'queued'
            ? 'queued'
            : 'running';

  let data: WebTaskStatus['data'];
  if (status === 'done') {
    if (input.verb === 'research') {
      data = {
        output: (payload.answer ?? payload.output ?? '') as string | Record<string, unknown>,
        citations: (payload.citations ?? []).map((c) => ({
          url: c.url ?? '',
          title: c.title ?? null,
        })),
      };
    } else if (input.verb === 'findall') {
      data = {
        items: (payload.items ?? []) as Array<Record<string, unknown>>,
      };
    }
  }

  return {
    taskId: input.taskId,
    provider: 'exa',
    verb: input.verb,
    status,
    data,
    raw: payload,
  };
}

export const exaAdapter: WebProviderAdapter = {
  slug: 'exa',
  name: 'Exa',
  requiresApiKey: true,
  capabilities: {
    search: true,
    scrape: true,
    research: true,
    answer: true,
    crawl: false,
    map: false,
    findall: true,
  },
  search: exaSearch,
  scrape: exaScrape,
  answer: exaAnswer,
  research: exaResearch,
  findall: exaFindall,
  getTask: exaGetTask,
};
