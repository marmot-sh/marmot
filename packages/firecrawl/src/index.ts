// @marmot-sh/firecrawl — Firecrawl adapter.

import {
  AICliError,
  WEB_PROVIDER_BASE_URLS,
  toAICliError,
  type WebCrawlInput,
  type WebCrawlSubmission,
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

export const PROVIDER_SLUG = 'firecrawl' as const;

const BASE_URL = WEB_PROVIDER_BASE_URLS.firecrawl;

type FirecrawlSearchItem = {
  url?: string;
  title?: string;
  description?: string;
  markdown?: string;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: {
    web?: FirecrawlSearchItem[];
    news?: FirecrawlSearchItem[];
    images?: FirecrawlSearchItem[];
  };
  warning?: string;
};

/** Convert marmot's date / freshness filters to Firecrawl's `tbs`
 *  parameter (Google-style time-based search). When explicit
 *  afterDate or beforeDate is set, emit a custom date range
 *  (`cdr:1,cd_min:M/D/YYYY,cd_max:M/D/YYYY`). When only freshness is
 *  set, emit a quick-date-range (`qdr:d|w|m|y`). Returns null when
 *  no filter is requested. Exported for tests. */
export function buildFirecrawlTbs(input: WebSearchInput): string | null {
  if (input.afterDate || input.beforeDate) {
    const fmt = (d: string): string => {
      // YYYY-MM-DD → M/D/YYYY (the Google-search format Firecrawl expects).
      const [y, m, day] = d.split('-');
      return `${Number(m)}/${Number(day)}/${y}`;
    };
    const parts = ['cdr:1'];
    if (input.afterDate) parts.push(`cd_min:${fmt(input.afterDate)}`);
    if (input.beforeDate) parts.push(`cd_max:${fmt(input.beforeDate)}`);
    return parts.join(',');
  }
  if (input.freshness) {
    const map: Record<NonNullable<WebSearchInput['freshness']>, string> = {
      day: 'qdr:d',
      week: 'qdr:w',
      month: 'qdr:m',
      year: 'qdr:y',
    };
    return map[input.freshness];
  }
  return null;
}

async function firecrawlSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Firecrawl requires --api-key or FIRECRAWL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;

  const body: Record<string, unknown> = {
    query: input.query,
    sources: ['web'],
  };
  if (typeof input.limit === 'number') body.limit = input.limit;
  if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
  if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
  // Firecrawl exposes Google's `tbs` time-based search parameter. We
  // honor explicit afterDate/beforeDate first (Google `cdr` custom
  // date range), then fall back to relative freshness (`qdr:d/w/m/y`).
  // Explicit absolute bounds win over freshness.
  const tbs = buildFirecrawlTbs(input);
  if (tbs) body.tbs = tbs;
  if (input.includeContent) {
    body.scrapeOptions = { formats: ['markdown'] };
  }

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/v2/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Firecrawl search request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Firecrawl search failed with status ${response.status}.`,
    );
  }

  let payload: FirecrawlSearchResponse;
  try {
    payload = (await response.json()) as FirecrawlSearchResponse;
  } catch (error) {
    throw new AICliError('provider', 'Firecrawl returned invalid JSON.', { cause: error });
  }

  const web = payload.data?.web ?? [];
  const items = web.map((r) => ({
    url: r.url ?? '',
    title: r.title ?? null,
    snippet: r.description ?? null,
    score: null,
    publishedAt: null,
    content: r.markdown ?? null,
  }));

  return {
    provider: 'firecrawl',
    data: { results: items, total: items.length },
    raw: payload,
  };
}

async function firecrawlScrape(input: WebScrapeInput): Promise<WebScrapeResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Firecrawl requires --api-key or FIRECRAWL_API_KEY.',
    );
  }
  if (!input.urls.length) {
    throw new AICliError('validation', 'At least one URL is required for scrape.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const formats = [input.format ?? 'markdown'];

  const calls = input.urls.map(async (url) => {
    const body: Record<string, unknown> = { url, formats };
    let response: Response;
    try {
      response = await fetchFn(`${BASE_URL}/v2/scrape`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: input.abortSignal,
      });
    } catch (error) {
      throw toAICliError(error, 'network', 'Firecrawl scrape request failed.');
    }
    if (!response.ok) {
      const category =
        response.status === 401 || response.status === 403 ? 'auth' : 'provider';
      throw new AICliError(
        category,
        `Firecrawl scrape failed with status ${response.status} for ${url}.`,
      );
    }
    const payload = (await response.json()) as {
      data?: {
        markdown?: string;
        html?: string;
        rawHtml?: string;
        metadata?: { title?: string };
      };
    };
    return {
      url,
      content:
        payload.data?.markdown
        ?? payload.data?.html
        ?? payload.data?.rawHtml
        ?? null,
      format: (input.format ?? 'markdown') as 'markdown' | 'text' | 'html',
      title: payload.data?.metadata?.title ?? null,
      raw: payload,
    };
  });

  const settled = await Promise.allSettled(calls);
  const pages: WebScrapeResult['data']['pages'] = [];
  const failed: string[] = [];
  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]!;
    if (r.status === 'fulfilled') {
      pages.push({
        url: r.value.url,
        content: r.value.content,
        format: r.value.format,
        title: r.value.title,
      });
    } else {
      failed.push(input.urls[i]!);
    }
  }
  return {
    provider: 'firecrawl',
    data: { pages, failed },
    raw: settled,
  };
}

async function firecrawlMap(input: WebMapInput): Promise<WebMapResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Firecrawl requires --api-key or FIRECRAWL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = { url: input.url };
  if (input.search) body.search = input.search;
  if (typeof input.limit === 'number') body.limit = input.limit;

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/v2/map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Firecrawl map request failed.');
  }
  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Firecrawl map failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    success?: boolean;
    links?: Array<{ url?: string; title?: string; description?: string }>;
  };
  const urls = (payload.links ?? []).map((l) => ({
    url: l.url ?? '',
    title: l.title ?? null,
    description: l.description ?? null,
  }));
  return {
    provider: 'firecrawl',
    data: { urls, total: urls.length },
    raw: payload,
  };
}

async function firecrawlCrawlSubmit(input: WebCrawlInput): Promise<WebCrawlSubmission> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Firecrawl requires --api-key or FIRECRAWL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = { url: input.url };
  if (typeof input.maxPages === 'number') body.limit = input.maxPages;
  if (typeof input.maxDepth === 'number') body.maxDiscoveryDepth = input.maxDepth;
  if (input.includePaths?.length) body.includePaths = input.includePaths;
  if (input.excludePaths?.length) body.excludePaths = input.excludePaths;
  if (input.allowExternal === true) body.allowExternalLinks = true;

  const response = await fetchFn(`${BASE_URL}/v2/crawl`, {
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
      `Firecrawl crawl submission failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new AICliError('provider', 'Firecrawl crawl did not return an id.');
  }
  return { taskId: payload.id };
}

async function firecrawlResearch(
  input: WebResearchInput,
): Promise<WebResearchSubmission> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Firecrawl requires --api-key or FIRECRAWL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = { query: input.query };
  if (input.depth === 'deep') body.maxDepth = 4;

  const response = await fetchFn(`${BASE_URL}/v1/deep-research`, {
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
    const errBody = await response.text().catch(() => '');
    throw new AICliError(
      category,
      `Firecrawl research submission failed with status ${response.status}. Response: ${errBody.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as { id?: string };
  if (!payload.id) {
    throw new AICliError('provider', 'Firecrawl research did not return an id.');
  }
  return { taskId: payload.id };
}

async function firecrawlGetTask(input: {
  taskId: string;
  verb: WebVerb;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<WebTaskStatus> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Firecrawl requires --api-key or FIRECRAWL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const url =
    input.verb === 'crawl'
      ? `${BASE_URL}/v2/crawl/${encodeURIComponent(input.taskId)}`
      : input.verb === 'research'
        ? `${BASE_URL}/v1/deep-research/${encodeURIComponent(input.taskId)}`
        : null;
  if (!url) {
    throw new AICliError(
      'validation',
      `Firecrawl does not support task polling for verb "${input.verb}".`,
    );
  }

  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${input.apiKey}`,
    },
    signal: input.abortSignal,
  });
  if (response.status === 404) {
    throw new AICliError(
      'validation',
      `Task "${input.taskId}" not found on Firecrawl.`,
    );
  }
  if (!response.ok) {
    throw new AICliError(
      'provider',
      `Firecrawl task fetch failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    status?: string;
    completed?: number;
    total?: number;
    data?: Array<{ url?: string; markdown?: string; metadata?: { title?: string } }>;
    finalAnalysis?: string;
  };
  const rawStatus = (payload.status ?? 'scraping').toLowerCase();
  const status =
    rawStatus === 'completed' || rawStatus === 'done'
      ? 'done'
      : rawStatus === 'failed'
        ? 'failed'
        : rawStatus === 'cancelled'
          ? 'cancelled'
          : 'running';

  let data: WebTaskStatus['data'];
  if (status === 'done') {
    if (input.verb === 'crawl') {
      const pages = (payload.data ?? []).map((p) => ({
        url: p.url ?? '',
        content: p.markdown ?? null,
        title: p.metadata?.title ?? null,
      }));
      data = {
        pages,
        stats: {
          crawled: payload.completed ?? pages.length,
          errors: Math.max(0, (payload.total ?? pages.length) - pages.length),
        },
      };
    } else if (input.verb === 'research') {
      data = {
        output: payload.finalAnalysis ?? '',
      };
    }
  }
  return {
    taskId: input.taskId,
    provider: 'firecrawl',
    verb: input.verb,
    status,
    data,
    raw: payload,
  };
}

export const firecrawlAdapter: WebProviderAdapter = {
  slug: 'firecrawl',
  name: 'Firecrawl',
  requiresApiKey: true,
  capabilities: {
    search: true,
    scrape: true,
    research: true,
    answer: false,
    crawl: true,
    map: true,
    findall: false,
  },
  search: firecrawlSearch,
  scrape: firecrawlScrape,
  map: firecrawlMap,
  crawlSubmit: firecrawlCrawlSubmit,
  research: firecrawlResearch,
  getTask: firecrawlGetTask,
};
