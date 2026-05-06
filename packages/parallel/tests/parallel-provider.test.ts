import { describe, expect, it } from 'vitest';

import { parallelAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errStatus = (status: number): typeof fetch =>
  (async () => new Response('', { status })) as unknown as typeof fetch;

describe('parallelAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(parallelAdapter.slug).toBe('parallel');
    expect(parallelAdapter.name).toBe('Parallel');
    expect(parallelAdapter.requiresApiKey).toBe(true);
    expect(parallelAdapter.capabilities).toEqual({
      search: true,
      scrape: true,
      research: true,
      answer: false,
      crawl: false,
      map: false,
      findall: true,
    });
    expect(typeof parallelAdapter.search).toBe('function');
    expect(typeof parallelAdapter.scrape).toBe('function');
    expect(typeof parallelAdapter.research).toBe('function');
    expect(typeof parallelAdapter.findall).toBe('function');
    expect(typeof parallelAdapter.getTask).toBe('function');
    expect(parallelAdapter.answer).toBeUndefined();
    expect(parallelAdapter.crawl).toBeUndefined();
    expect(parallelAdapter.map).toBeUndefined();
  });
});

describe('parallelAdapter.search', () => {
  it('POSTs /v1/search with x-api-key, objective + search_queries from query', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await parallelAdapter.search!({
      apiKey: 'p-test',
      query: 'postgres pricing',
      depth: 'deep',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.parallel.ai/v1/search');
        const headers = init?.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('p-test');
        captured = JSON.parse(String(init?.body));
        return okJson({
          search_id: 'srch_1',
          results: [
            {
              url: 'https://example.com',
              title: 'Example',
              excerpts: ['line 1', 'line 2'],
            },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      objective: 'postgres pricing',
      search_queries: ['postgres pricing'],
      mode: 'advanced',
    });
    expect(result.data.results[0]).toMatchObject({
      url: 'https://example.com',
      title: 'Example',
      snippet: 'line 1',
      content: 'line 1\n\nline 2',
    });
  });

  it('uses explicit objective + queries when provided', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.search!({
      apiKey: 'k',
      query: 'fallback',
      objective: 'find pricing',
      queries: ['postgres pricing', 'managed db pricing'],
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      objective: 'find pricing',
      search_queries: ['postgres pricing', 'managed db pricing'],
    });
  });

  it('maps depth basic→basic, deep→advanced, standard→basic', async () => {
    const captured: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)).mode as string);
      return okJson({ results: [] });
    }) as unknown as typeof fetch;
    for (const d of ['basic', 'standard', 'deep'] as const) {
      await parallelAdapter.search!({ apiKey: 'k', query: 'x', depth: d, fetchFn });
    }
    expect(captured).toEqual(['basic', 'basic', 'advanced']);
  });

  it('throws on missing apiKey', async () => {
    await expect(parallelAdapter.search!({ query: 'x' })).rejects.toThrowError(/PARALLEL_API_KEY/);
  });

  it('surfaces 401', async () => {
    await expect(
      parallelAdapter.search!({ apiKey: 'bad', query: 'x', fetchFn: errStatus(401) }),
    ).rejects.toThrowError(/status 401/);
  });

  it('passes includeDomains and excludeDomains to the request body (closes 0.4.3 silent-drop bug)', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.search!({
      apiKey: 'k',
      query: 'x',
      includeDomains: ['linkedin.com', 'github.com'],
      excludeDomains: ['spam.com'],
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      include_domains: ['linkedin.com', 'github.com'],
      exclude_domains: ['spam.com'],
    });
  });

  it('passes afterDate as after_date in YYYY-MM-DD form', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.search!({
      apiKey: 'k',
      query: 'x',
      afterDate: '2026-01-15',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ after_date: '2026-01-15' });
  });

  it('maps relative freshness to after_date when afterDate is not set', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.search!({
      apiKey: 'k',
      query: 'x',
      freshness: 'week',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect((captured as Record<string, string>).after_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('explicit afterDate wins over freshness mapping', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.search!({
      apiKey: 'k',
      query: 'x',
      afterDate: '2026-01-15',
      freshness: 'year',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ after_date: '2026-01-15' });
  });

  it('omits date fields entirely when neither afterDate nor freshness is set', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.search!({
      apiKey: 'k',
      query: 'x',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).not.toHaveProperty('after_date');
    expect(captured).not.toHaveProperty('include_domains');
    expect(captured).not.toHaveProperty('exclude_domains');
  });
});

describe('parallelAdapter.scrape', () => {
  it('POSTs /v1/extract with urls + objective', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await parallelAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a.com', 'https://b.com'],
      query: 'find prices',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.parallel.ai/v1/extract');
        captured = JSON.parse(String(init?.body));
        return okJson({
          results: [
            { url: 'https://a.com', title: 'A', excerpts: ['x', 'y'] },
            { url: 'https://b.com', title: 'B', excerpts: ['z'] },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      urls: ['https://a.com', 'https://b.com'],
      objective: 'find prices',
    });
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.failed).toEqual([]);
  });

  it('reports URLs not in response as failed', async () => {
    const result = await parallelAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a.com', 'https://b.com'],
      fetchFn: (async () =>
        okJson({ results: [{ url: 'https://a.com', excerpts: ['x'] }] })) as unknown as typeof fetch,
    });
    expect(result.data.failed).toEqual(['https://b.com']);
  });

  it('throws on empty urls', async () => {
    await expect(
      parallelAdapter.scrape!({ apiKey: 'k', urls: [] }),
    ).rejects.toThrowError(/At least one URL/);
  });

  it('throws on missing apiKey', async () => {
    await expect(
      parallelAdapter.scrape!({ urls: ['https://a'] }),
    ).rejects.toThrowError(/PARALLEL_API_KEY/);
  });
});

describe('parallelAdapter.research', () => {
  it('POSTs /v1/tasks/runs with processor + input + task_spec', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await parallelAdapter.research!({
      apiKey: 'k',
      query: 'study postgres',
      depth: 'deep',
      schema: { type: 'object', properties: { foo: { type: 'string' } } },
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.parallel.ai/v1/tasks/runs');
        captured = JSON.parse(String(init?.body));
        return okJson({ run_id: 'run_42' });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      processor: 'pro',
      input: 'study postgres',
      task_spec: { output_schema: { type: 'object' } },
    });
    expect(result.taskId).toBe('run_42');
  });

  it('maps depth: basic→lite, standard→base, deep→pro', async () => {
    const captured: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)).processor as string);
      return okJson({ run_id: 'r' });
    }) as unknown as typeof fetch;
    for (const d of ['basic', 'standard', 'deep'] as const) {
      await parallelAdapter.research!({ apiKey: 'k', query: 'x', depth: d, fetchFn });
    }
    expect(captured).toEqual(['lite', 'base', 'pro']);
  });

  it('throws when response has no run_id', async () => {
    await expect(
      parallelAdapter.research!({
        apiKey: 'k',
        query: 'x',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return a run id/);
  });
});

describe('parallelAdapter.findall', () => {
  it('POSTs /v1beta/findall/runs with all required fields and the beta header', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    const result = await parallelAdapter.findall!({
      apiKey: 'k',
      objective: 'YC startups',
      entityType: 'company',
      matchConditions: [{ name: 'Industry', description: 'Y Combinator alumni' }],
      limit: 50,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.parallel.ai/v1beta/findall/runs');
        capturedBody = JSON.parse(String(init?.body));
        capturedHeaders = init?.headers as Record<string, string>;
        return okJson({ findall_id: 'fa_1' });
      }) as unknown as typeof fetch,
    });
    expect(capturedBody).toEqual({
      objective: 'YC startups',
      entity_type: 'company',
      match_conditions: [{ name: 'Industry', description: 'Y Combinator alumni' }],
      generator: 'base',
      match_limit: 50,
    });
    expect(capturedHeaders!['parallel-beta']).toBe('findall-2025-09-15');
    expect(result.taskId).toBe('fa_1');
  });

  it('clamps match_limit to the [5, 1000] range', async () => {
    const captured: number[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)).match_limit as number);
      return okJson({ findall_id: 'r' });
    }) as unknown as typeof fetch;
    await parallelAdapter.findall!({
      apiKey: 'k',
      objective: 'x',
      entityType: 'thing',
      limit: 3,
      fetchFn,
    });
    await parallelAdapter.findall!({
      apiKey: 'k',
      objective: 'x',
      entityType: 'thing',
      limit: 5000,
      fetchFn,
    });
    await parallelAdapter.findall!({
      apiKey: 'k',
      objective: 'x',
      entityType: 'thing',
      fetchFn,
    });
    expect(captured).toEqual([5, 1000, 10]);
  });

  it('synthesizes a default match condition from the objective when none provided', async () => {
    let captured: Record<string, unknown> | undefined;
    await parallelAdapter.findall!({
      apiKey: 'k',
      objective: 'major US cloud providers',
      entityType: 'cloud_provider',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ findall_id: 'r' });
      }) as unknown as typeof fetch,
    });
    expect(captured?.match_conditions).toEqual([
      { name: 'Objective', description: 'major US cloud providers' },
    ]);
  });

  it('throws when entityType is missing', async () => {
    await expect(
      parallelAdapter.findall!({
        apiKey: 'k',
        objective: 'x',
      }),
    ).rejects.toThrowError(/requires `entityType`/);
  });

  it('throws when response has no findall_id', async () => {
    await expect(
      parallelAdapter.findall!({
        apiKey: 'k',
        objective: 'x',
        entityType: 'thing',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return an id/);
  });
});

describe('parallelAdapter.getTask', () => {
  it('routes research → /v1/tasks/runs/{id}', async () => {
    let capturedUrl: string | undefined;
    const status = await parallelAdapter.getTask!({
      taskId: 'r1',
      verb: 'research',
      apiKey: 'k',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return okJson({
          status: 'completed',
          output: { content: 'final answer' },
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe('https://api.parallel.ai/v1/tasks/runs/r1');
    expect(status.status).toBe('done');
    expect((status.data as { output: string }).output).toBe('final answer');
  });

  it('routes findall → /v1beta/findall/runs/{id}', async () => {
    let capturedUrl: string | undefined;
    const status = await parallelAdapter.getTask!({
      taskId: 'f1',
      verb: 'findall',
      apiKey: 'k',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return okJson({
          status: 'completed',
          matches: [{ name: 'A' }, { name: 'B' }],
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe('https://api.parallel.ai/v1beta/findall/runs/f1');
    expect(status.status).toBe('done');
    expect((status.data as { items: unknown[] }).items).toHaveLength(2);
  });

  it('rejects unsupported verbs', async () => {
    await expect(
      parallelAdapter.getTask!({
        taskId: 't',
        verb: 'crawl',
        apiKey: 'k',
      }),
    ).rejects.toThrowError(/does not support task polling for verb "crawl"/);
  });

  it('maps status: pending → queued, success → done, failed → failed', async () => {
    const variants: Array<{ raw: string; mapped: string }> = [
      { raw: 'pending', mapped: 'queued' },
      { raw: 'success', mapped: 'done' },
      { raw: 'failed', mapped: 'failed' },
      { raw: 'whatever', mapped: 'running' },
    ];
    for (const { raw, mapped } of variants) {
      const status = await parallelAdapter.getTask!({
        taskId: 't',
        verb: 'research',
        apiKey: 'k',
        fetchFn: (async () => okJson({ status: raw })) as unknown as typeof fetch,
      });
      expect(status.status).toBe(mapped);
    }
  });

  it('returns 404 as validation error', async () => {
    await expect(
      parallelAdapter.getTask!({
        taskId: 'gone',
        verb: 'research',
        apiKey: 'k',
        fetchFn: errStatus(404),
      }),
    ).rejects.toThrowError(/not found on Parallel/);
  });

  it('throws on missing apiKey', async () => {
    await expect(
      parallelAdapter.getTask!({ taskId: 't', verb: 'research' }),
    ).rejects.toThrowError(/PARALLEL_API_KEY/);
  });
});
