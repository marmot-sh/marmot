// @marmot-sh/tavily — Tavily adapter.

import {
  AICliError,
  WEB_PROVIDER_BASE_URLS,
  toAICliError,
  type WebAnswerInput,
  type WebAnswerResult,
  type WebCrawlInput,
  type WebCrawlResult,
  type WebMapInput,
  type WebMapResult,
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

export const PROVIDER_SLUG = 'tavily' as const;

const BASE_URL = WEB_PROVIDER_BASE_URLS.tavily;

type TavilyResult = {
  url?: string;
  title?: string;
  content?: string;
  score?: number;
  raw_content?: string;
  published_date?: string;
};

type TavilySearchResponse = {
  query?: string;
  answer?: string;
  results?: TavilyResult[];
  response_time?: number;
};

function depthToTier(
  depth: WebSearchInput['depth'] | undefined,
): 'basic' | 'advanced' | 'fast' {
  switch (depth) {
    case 'basic':
      return 'fast';
    case 'deep':
      return 'advanced';
    case 'standard':
    default:
      return 'basic';
  }
}

function freshnessToTimeRange(
  f: WebSearchInput['freshness'] | undefined,
): 'day' | 'week' | 'month' | 'year' | undefined {
  return f;
}

async function tavilySearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    query: input.query,
    search_depth: depthToTier(input.depth),
  };
  if (typeof input.limit === 'number') body.max_results = input.limit;
  if (input.includeDomains?.length) body.include_domains = input.includeDomains;
  if (input.excludeDomains?.length) body.exclude_domains = input.excludeDomains;
  if (input.includeContent) body.include_raw_content = 'markdown';
  const tr = freshnessToTimeRange(input.freshness);
  if (tr) body.time_range = tr;

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Tavily search request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Tavily search failed with status ${response.status}.`,
    );
  }

  let payload: TavilySearchResponse;
  try {
    payload = (await response.json()) as TavilySearchResponse;
  } catch (error) {
    throw new AICliError('provider', 'Tavily returned invalid JSON.', { cause: error });
  }

  const items = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    title: r.title ?? null,
    snippet: r.content ?? null,
    score: typeof r.score === 'number' ? r.score : null,
    publishedAt: r.published_date ?? null,
    content: r.raw_content ?? null,
  }));

  return {
    provider: 'tavily',
    data: { results: items, total: items.length },
    raw: payload,
  };
}

async function tavilyScrape(input: WebScrapeInput): Promise<WebScrapeResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  if (!input.urls.length) {
    throw new AICliError('validation', 'At least one URL is required for scrape.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    urls: input.urls,
    format: input.format === 'text' ? 'text' : 'markdown',
  };
  if (input.query) body.query = input.query;

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Tavily extract request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Tavily extract failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    results?: Array<{ url?: string; raw_content?: string }>;
    failed_results?: Array<{ url?: string }>;
  };
  const pages = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    content: r.raw_content ?? null,
    format: (input.format ?? 'markdown') as 'markdown' | 'text' | 'html',
    title: null,
  }));
  const failed = (payload.failed_results ?? []).map((f) => f.url ?? '').filter(Boolean);

  return {
    provider: 'tavily',
    data: { pages, failed },
    raw: payload,
  };
}

async function tavilyAnswer(input: WebAnswerInput): Promise<WebAnswerResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    query: input.query,
    include_answer: 'advanced',
  };

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Tavily answer request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Tavily answer failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    answer?: string;
    results?: Array<{ url?: string; title?: string; content?: string }>;
  };
  const citations = (payload.results ?? [])
    .slice(0, input.maxCitations ?? 8)
    .map((r) => ({
      url: r.url ?? '',
      title: r.title ?? null,
      snippet: r.content ?? null,
    }));
  return {
    provider: 'tavily',
    data: { answer: payload.answer ?? '', citations },
    raw: payload,
  };
}

async function tavilyMap(input: WebMapInput): Promise<WebMapResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = { url: input.url };
  if (typeof input.limit === 'number') body.limit = input.limit;

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Tavily map request failed.');
  }
  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Tavily map failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as { results?: string[] };
  const urls = (payload.results ?? []).map((u) => ({
    url: u,
    title: null,
    description: null,
  }));
  return {
    provider: 'tavily',
    data: { urls, total: urls.length },
    raw: payload,
  };
}

async function tavilyCrawl(input: WebCrawlInput): Promise<WebCrawlResult> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = { url: input.url };
  if (typeof input.maxPages === 'number') body.limit = input.maxPages;
  if (typeof input.maxDepth === 'number') body.max_depth = input.maxDepth;
  if (input.instructions) body.instructions = input.instructions;
  if (input.includePaths?.length) body.select_paths = input.includePaths;
  if (input.excludePaths?.length) body.exclude_paths = input.excludePaths;
  if (input.allowExternal !== undefined) body.allow_external = input.allowExternal;

  const response = await fetchFn(`${BASE_URL}/crawl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: input.abortSignal,
  });
  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Tavily crawl failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    base_url?: string;
    results?: Array<{ url?: string; raw_content?: string }>;
  };
  const pages = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    content: r.raw_content ?? null,
    title: null,
  }));
  return {
    provider: 'tavily',
    data: { pages, stats: { crawled: pages.length, errors: 0 } },
    raw: payload,
  };
}

async function tavilyResearch(input: WebResearchInput): Promise<WebResearchSubmission> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    input: input.query,
    model: input.depth === 'deep' ? 'pro' : input.depth === 'basic' ? 'mini' : 'auto',
  };
  if (input.schema) body.output_schema = input.schema;

  const response = await fetchFn(`${BASE_URL}/research`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: input.abortSignal,
  });
  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Tavily research submission failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as { request_id?: string };
  if (!payload.request_id) {
    throw new AICliError('provider', 'Tavily research did not return a request id.');
  }
  return { taskId: payload.request_id };
}

async function tavilyGetTask(input: {
  taskId: string;
  verb: WebVerb;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<WebTaskStatus> {
  if (!input.apiKey) {
    throw new AICliError('auth', 'Tavily requires --api-key or TAVILY_API_KEY.');
  }
  if (input.verb !== 'research') {
    throw new AICliError(
      'validation',
      `Tavily does not support task polling for verb "${input.verb}".`,
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const response = await fetchFn(
    `${BASE_URL}/research/${encodeURIComponent(input.taskId)}`,
    {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      signal: input.abortSignal,
    },
  );
  if (response.status === 404) {
    throw new AICliError(
      'validation',
      `Task "${input.taskId}" not found on Tavily.`,
    );
  }
  if (!response.ok && response.status !== 202) {
    throw new AICliError(
      'provider',
      `Tavily task fetch failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    status?: string;
    content?: string | Record<string, unknown>;
    sources?: Array<{ url?: string; title?: string }>;
  };
  const rawStatus = (payload.status ?? 'pending').toLowerCase();
  const status =
    rawStatus === 'completed' || rawStatus === 'done'
      ? 'done'
      : rawStatus === 'failed'
        ? 'failed'
        : rawStatus === 'cancelled'
          ? 'cancelled'
          : rawStatus === 'pending'
            ? 'queued'
            : 'running';

  let data: WebTaskStatus['data'];
  if (status === 'done') {
    data = {
      output: payload.content ?? '',
      citations: (payload.sources ?? []).map((s) => ({
        url: s.url ?? '',
        title: s.title ?? null,
      })),
    };
  }

  return {
    taskId: input.taskId,
    provider: 'tavily',
    verb: input.verb,
    status,
    data,
    raw: payload,
  };
}

export const tavilyAdapter: WebProviderAdapter = {
  slug: 'tavily',
  name: 'Tavily',
  requiresApiKey: true,
  capabilities: {
    search: true,
    scrape: true,
    research: true,
    answer: true,
    crawl: true,
    map: true,
    findall: false,
  },
  search: tavilySearch,
  scrape: tavilyScrape,
  answer: tavilyAnswer,
  map: tavilyMap,
  crawl: tavilyCrawl,
  research: tavilyResearch,
  getTask: tavilyGetTask,
};
