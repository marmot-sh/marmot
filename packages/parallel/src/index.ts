// @marmot-sh/parallel — Parallel adapter.

import {
  AICliError,
  WEB_PROVIDER_BASE_URLS,
  toAICliError,
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

export const PROVIDER_SLUG = 'parallel' as const;

const BASE_URL = WEB_PROVIDER_BASE_URLS.parallel;

type ParallelSearchItem = {
  url?: string;
  title?: string;
  excerpts?: string[];
};

type ParallelSearchResponse = {
  search_id?: string;
  results?: ParallelSearchItem[];
};

/** Convert marmot's relative freshness window to an ISO `YYYY-MM-DD`
 *  for providers that only accept absolute date floors (Parallel
 *  currently). `now` defaulted for normal use; injectable for tests. */
function freshnessToAfterDate(
  freshness: NonNullable<WebSearchInput['freshness']>,
  now: Date = new Date(),
): string {
  const days = { day: 1, week: 7, month: 30, year: 365 }[freshness];
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 10);
}

function depthToMode(depth: WebSearchInput['depth'] | undefined): 'basic' | 'advanced' {
  return depth === 'deep' ? 'advanced' : 'basic';
}

async function parallelSearch(input: WebSearchInput): Promise<WebSearchResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Parallel requires --api-key or PARALLEL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;

  // Parallel takes objective + search_queries; we accept either the unified
  // {query} or explicit {objective, queries}.
  const objective = input.objective ?? input.query;
  const queries = input.queries ?? [input.query];

  const body: Record<string, unknown> = {
    objective,
    search_queries: queries,
    mode: depthToMode(input.depth),
  };
  if (typeof input.limit === 'number') {
    // Parallel caps via max_chars_total rather than result count;
    // approximate result count by allowing ~500 chars/result.
    body.max_chars_total = Math.max(1500, input.limit * 500);
  }
  if (input.includeDomains?.length) body.include_domains = input.includeDomains;
  if (input.excludeDomains?.length) body.exclude_domains = input.excludeDomains;
  if (input.afterDate) body.after_date = input.afterDate;
  // Parallel doesn't currently document a relative-freshness primitive
  // (`day`/`week`/`month`/`year`). The honest mapping is to translate it
  // into `after_date` here so the user's `--freshness week` still does
  // what they expect on Parallel. Caller's explicit `--after-date` wins
  // over the mapped freshness.
  if (!input.afterDate && input.freshness) {
    body.after_date = freshnessToAfterDate(input.freshness);
  }

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/v1/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Parallel search request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Parallel search failed with status ${response.status}.`,
    );
  }

  let payload: ParallelSearchResponse;
  try {
    payload = (await response.json()) as ParallelSearchResponse;
  } catch (error) {
    throw new AICliError('provider', 'Parallel returned invalid JSON.', { cause: error });
  }

  const items = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    title: r.title ?? null,
    snippet: r.excerpts?.[0] ?? null,
    score: null,
    publishedAt: null,
    content: r.excerpts?.join('\n\n') ?? null,
  }));

  return {
    provider: 'parallel',
    data: { results: items, total: items.length },
    raw: payload,
  };
}

async function parallelScrape(input: WebScrapeInput): Promise<WebScrapeResult> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Parallel requires --api-key or PARALLEL_API_KEY.',
    );
  }
  if (!input.urls.length) {
    throw new AICliError('validation', 'At least one URL is required for scrape.');
  }
  const fetchFn = input.fetchFn ?? fetch;
  const body: Record<string, unknown> = {
    urls: input.urls,
  };
  if (input.query) body.objective = input.query;

  let response: Response;
  try {
    response = await fetchFn(`${BASE_URL}/v1/extract`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': input.apiKey,
      },
      body: JSON.stringify(body),
      signal: input.abortSignal,
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Parallel extract request failed.');
  }

  if (!response.ok) {
    const category =
      response.status === 401 || response.status === 403 ? 'auth' : 'provider';
    throw new AICliError(
      category,
      `Parallel extract failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as {
    results?: Array<{ url?: string; excerpts?: string[]; title?: string }>;
  };
  const pages = (payload.results ?? []).map((r) => ({
    url: r.url ?? '',
    content: r.excerpts?.join('\n\n') ?? null,
    format: 'markdown' as const,
    title: r.title ?? null,
  }));
  const fetched = new Set(pages.map((p) => p.url));
  const failed = input.urls.filter((u) => !fetched.has(u));

  return {
    provider: 'parallel',
    data: { pages, failed },
    raw: payload,
  };
}

async function parallelResearch(input: WebResearchInput): Promise<WebResearchSubmission> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Parallel requires --api-key or PARALLEL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const processor =
    input.depth === 'deep' ? 'pro' : input.depth === 'basic' ? 'lite' : 'base';
  const body: Record<string, unknown> = {
    processor,
    input: input.query,
  };
  if (input.schema) {
    body.task_spec = { output_schema: input.schema };
  }

  const response = await fetchFn(`${BASE_URL}/v1/tasks/runs`, {
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
      `Parallel research submission failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as { run_id?: string };
  if (!payload.run_id) {
    throw new AICliError('provider', 'Parallel research did not return a run id.');
  }
  return { taskId: payload.run_id };
}

async function parallelFindall(input: WebFindallInput): Promise<WebFindallSubmission> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Parallel requires --api-key or PARALLEL_API_KEY.',
    );
  }
  if (!input.entityType) {
    throw new AICliError(
      'validation',
      'Parallel findall requires `entityType` (e.g. "company", "person", "product"). Pass `--entity-type <name>`.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  // match_limit must be 5-1000 inclusive per OpenAPI; clamp gracefully.
  const desiredLimit = input.limit ?? 10;
  const matchLimit = Math.max(5, Math.min(desiredLimit, 1000));
  // Parallel rejects empty match_conditions ("At least one match condition is
  // required."). When the user hasn't supplied any, default to a single
  // condition restating the objective — Parallel will use it as the
  // top-level evaluation criterion. Users with specific conditions should
  // pass --match-conditions.
  const matchConditions =
    input.matchConditions && input.matchConditions.length > 0
      ? input.matchConditions
      : [{ name: 'Objective', description: input.objective }];
  const body: Record<string, unknown> = {
    objective: input.objective,
    entity_type: input.entityType,
    match_conditions: matchConditions,
    generator: 'base',
    match_limit: matchLimit,
  };

  const response = await fetchFn(`${BASE_URL}/v1beta/findall/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': input.apiKey,
      // FindAll is a beta feature and requires explicit opt-in via header.
      // Pinning to the version we tested against; bump when Parallel ships
      // a new findall API revision.
      'parallel-beta': 'findall-2025-09-15',
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
      `Parallel findall submission failed with status ${response.status}. Response: ${errBody.slice(0, 400)}`,
    );
  }
  const payload = (await response.json()) as { findall_id?: string };
  if (!payload.findall_id) {
    throw new AICliError('provider', 'Parallel findall did not return an id.');
  }
  return { taskId: payload.findall_id };
}

async function parallelGetTask(input: {
  taskId: string;
  verb: WebVerb;
  apiKey?: string;
  fetchFn?: typeof fetch;
  abortSignal?: AbortSignal;
}): Promise<WebTaskStatus> {
  if (!input.apiKey) {
    throw new AICliError(
      'auth',
      'Parallel requires --api-key or PARALLEL_API_KEY.',
    );
  }
  const fetchFn = input.fetchFn ?? fetch;
  const url =
    input.verb === 'research'
      ? `${BASE_URL}/v1/tasks/runs/${encodeURIComponent(input.taskId)}`
      : input.verb === 'findall'
        ? `${BASE_URL}/v1beta/findall/runs/${encodeURIComponent(input.taskId)}`
        : null;
  if (!url) {
    throw new AICliError(
      'validation',
      `Parallel does not support task polling for verb "${input.verb}".`,
    );
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-api-key': input.apiKey,
  };
  // findall is gated behind the beta header on every endpoint.
  if (input.verb === 'findall') {
    headers['parallel-beta'] = 'findall-2025-09-15';
  }
  const response = await fetchFn(url, {
    headers,
    signal: input.abortSignal,
  });
  if (response.status === 404) {
    throw new AICliError(
      'validation',
      `Task "${input.taskId}" not found on Parallel.`,
    );
  }
  if (!response.ok) {
    throw new AICliError(
      'provider',
      `Parallel task fetch failed with status ${response.status}.`,
    );
  }
  const payload = (await response.json()) as {
    status?: string;
    output?: { content?: string | Record<string, unknown> };
    matches?: Array<Record<string, unknown>>;
  };
  const rawStatus = (payload.status ?? 'running').toLowerCase();
  const status =
    rawStatus === 'completed' || rawStatus === 'done' || rawStatus === 'success'
      ? 'done'
      : rawStatus === 'failed' || rawStatus === 'error'
        ? 'failed'
        : rawStatus === 'cancelled'
          ? 'cancelled'
          : rawStatus === 'queued' || rawStatus === 'pending'
            ? 'queued'
            : 'running';

  let data: WebTaskStatus['data'];
  if (status === 'done') {
    if (input.verb === 'research') {
      data = {
        output: payload.output?.content ?? '',
      };
    } else if (input.verb === 'findall') {
      data = { items: payload.matches ?? [] };
    }
  }

  return {
    taskId: input.taskId,
    provider: 'parallel',
    verb: input.verb,
    status,
    data,
    raw: payload,
  };
}

export const parallelAdapter: WebProviderAdapter = {
  slug: 'parallel',
  name: 'Parallel',
  requiresApiKey: true,
  capabilities: {
    search: true,
    scrape: true,
    research: true,
    answer: false,
    crawl: false,
    map: false,
    findall: true,
  },
  search: parallelSearch,
  scrape: parallelScrape,
  research: parallelResearch,
  findall: parallelFindall,
  getTask: parallelGetTask,
};
