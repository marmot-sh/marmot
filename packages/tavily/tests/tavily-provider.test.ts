import { describe, expect, it } from 'vitest';

import { tavilyAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errStatus = (status: number): typeof fetch =>
  (async () => new Response('', { status })) as unknown as typeof fetch;

describe('tavilyAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(tavilyAdapter.slug).toBe('tavily');
    expect(tavilyAdapter.name).toBe('Tavily');
    expect(tavilyAdapter.requiresApiKey).toBe(true);
    expect(tavilyAdapter.capabilities).toEqual({
      search: true,
      scrape: true,
      research: true,
      answer: true,
      crawl: true,
      map: true,
      findall: false,
    });
    expect(typeof tavilyAdapter.search).toBe('function');
    expect(typeof tavilyAdapter.scrape).toBe('function');
    expect(typeof tavilyAdapter.answer).toBe('function');
    expect(typeof tavilyAdapter.map).toBe('function');
    expect(typeof tavilyAdapter.crawl).toBe('function');
    expect(typeof tavilyAdapter.research).toBe('function');
    expect(typeof tavilyAdapter.getTask).toBe('function');
    expect(tavilyAdapter.findall).toBeUndefined();
    expect(tavilyAdapter.crawlSubmit).toBeUndefined();
  });
});

describe('tavilyAdapter.search', () => {
  it('POSTs /search with Bearer auth and depth-mapped search_depth', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await tavilyAdapter.search!({
      apiKey: 'tvly-test',
      query: 'openrouter pricing',
      limit: 10,
      depth: 'deep',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tavily.com/search');
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer tvly-test');
        captured = JSON.parse(String(init?.body));
        return okJson({
          query: 'openrouter pricing',
          results: [
            {
              url: 'https://openrouter.ai/pricing',
              title: 'Pricing',
              content: 'snippet',
              score: 0.9,
            },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      query: 'openrouter pricing',
      search_depth: 'advanced',
      max_results: 10,
    });
    expect(result.data.results[0]).toMatchObject({
      url: 'https://openrouter.ai/pricing',
      title: 'Pricing',
      snippet: 'snippet',
      score: 0.9,
    });
  });

  it('maps depth: basic→fast, standard→basic, deep→advanced', async () => {
    const captured: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)).search_depth as string);
      return okJson({ results: [] });
    }) as unknown as typeof fetch;
    for (const d of ['basic', 'standard', 'deep'] as const) {
      await tavilyAdapter.search!({ apiKey: 'k', query: 'x', depth: d, fetchFn });
    }
    expect(captured).toEqual(['fast', 'basic', 'advanced']);
  });

  it('passes time_range when freshness is set', async () => {
    let captured: Record<string, unknown> | undefined;
    await tavilyAdapter.search!({
      apiKey: 'k',
      query: 'x',
      freshness: 'week',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured?.time_range).toBe('week');
  });

  it('passes include_raw_content when includeContent is set', async () => {
    let captured: Record<string, unknown> | undefined;
    await tavilyAdapter.search!({
      apiKey: 'k',
      query: 'x',
      includeContent: true,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured?.include_raw_content).toBe('markdown');
  });

  it('throws on missing apiKey', async () => {
    await expect(tavilyAdapter.search!({ query: 'x' })).rejects.toThrowError(/TAVILY_API_KEY/);
  });

  it('surfaces 401', async () => {
    await expect(
      tavilyAdapter.search!({ apiKey: 'bad', query: 'x', fetchFn: errStatus(401) }),
    ).rejects.toThrowError(/status 401/);
  });
});

describe('tavilyAdapter.scrape', () => {
  it('POSTs /extract with urls + format', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await tavilyAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a', 'https://b'],
      query: 'find prices',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tavily.com/extract');
        captured = JSON.parse(String(init?.body));
        return okJson({
          results: [{ url: 'https://a', raw_content: 'aaa' }],
          failed_results: [{ url: 'https://b' }],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toEqual({
      urls: ['https://a', 'https://b'],
      format: 'markdown',
      query: 'find prices',
    });
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.failed).toEqual(['https://b']);
  });

  it('honors --format text', async () => {
    let captured: Record<string, unknown> | undefined;
    await tavilyAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a'],
      format: 'text',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured?.format).toBe('text');
  });

  it('throws on empty urls', async () => {
    await expect(
      tavilyAdapter.scrape!({ apiKey: 'k', urls: [] }),
    ).rejects.toThrowError(/At least one URL/);
  });

  it('throws on missing apiKey', async () => {
    await expect(
      tavilyAdapter.scrape!({ urls: ['https://x'] }),
    ).rejects.toThrowError(/TAVILY_API_KEY/);
  });
});

describe('tavilyAdapter.answer', () => {
  it('POSTs /search with include_answer:advanced and parses answer + citations', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await tavilyAdapter.answer!({
      apiKey: 'k',
      query: 'what is openrouter',
      maxCitations: 2,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tavily.com/search');
        captured = JSON.parse(String(init?.body));
        return okJson({
          answer: 'OpenRouter is a model gateway.',
          results: [
            { url: 'https://r1', title: 'R1', content: 's1' },
            { url: 'https://r2', title: 'R2', content: 's2' },
            { url: 'https://r3', title: 'R3', content: 's3' },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      query: 'what is openrouter',
      include_answer: 'advanced',
    });
    expect(result.data.answer).toBe('OpenRouter is a model gateway.');
    expect(result.data.citations).toHaveLength(2);
  });

  it('throws on missing apiKey', async () => {
    await expect(tavilyAdapter.answer!({ query: 'x' })).rejects.toThrowError(
      /TAVILY_API_KEY/,
    );
  });
});

describe('tavilyAdapter.map', () => {
  it('POSTs /map with url + limit', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await tavilyAdapter.map!({
      apiKey: 'k',
      url: 'https://docs.example.com',
      limit: 100,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tavily.com/map');
        captured = JSON.parse(String(init?.body));
        return okJson({
          results: ['https://docs.example.com/a', 'https://docs.example.com/b'],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toEqual({ url: 'https://docs.example.com', limit: 100 });
    expect(result.data.urls).toHaveLength(2);
    expect(result.data.urls[0]!.url).toBe('https://docs.example.com/a');
    expect(result.data.urls[0]!.title).toBeNull();
  });

  it('throws on missing apiKey', async () => {
    await expect(tavilyAdapter.map!({ url: 'https://x' })).rejects.toThrowError(/TAVILY_API_KEY/);
  });
});

describe('tavilyAdapter.crawl (sync)', () => {
  it('POSTs /crawl with url + max_depth + instructions and returns pages directly', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await tavilyAdapter.crawl!({
      apiKey: 'k',
      url: 'https://docs.example.com',
      maxPages: 50,
      maxDepth: 3,
      instructions: 'API reference only',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tavily.com/crawl');
        captured = JSON.parse(String(init?.body));
        return okJson({
          base_url: 'https://docs.example.com',
          results: [
            { url: 'https://docs.example.com/api/x', raw_content: 'page x' },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      url: 'https://docs.example.com',
      limit: 50,
      max_depth: 3,
      instructions: 'API reference only',
    });
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.stats.crawled).toBe(1);
  });

  it('throws on missing apiKey', async () => {
    await expect(tavilyAdapter.crawl!({ url: 'https://x' })).rejects.toThrowError(
      /TAVILY_API_KEY/,
    );
  });
});

describe('tavilyAdapter.research', () => {
  it('POSTs /research with input + model and returns request_id', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await tavilyAdapter.research!({
      apiKey: 'k',
      query: 'study postgres',
      depth: 'deep',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.tavily.com/research');
        captured = JSON.parse(String(init?.body));
        return okJson({ request_id: 'req_42' });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ input: 'study postgres', model: 'pro' });
    expect(result.taskId).toBe('req_42');
  });

  it('maps depth: basic→mini, standard→auto, deep→pro', async () => {
    const captured: string[] = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)).model as string);
      return okJson({ request_id: 'r' });
    }) as unknown as typeof fetch;
    for (const d of ['basic', 'standard', 'deep'] as const) {
      await tavilyAdapter.research!({ apiKey: 'k', query: 'x', depth: d, fetchFn });
    }
    expect(captured).toEqual(['mini', 'auto', 'pro']);
  });

  it('throws when response has no request_id', async () => {
    await expect(
      tavilyAdapter.research!({
        apiKey: 'k',
        query: 'x',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return a request id/);
  });
});

describe('tavilyAdapter.getTask', () => {
  it('routes research → /research/{id} and parses content + sources', async () => {
    let capturedUrl: string | undefined;
    const status = await tavilyAdapter.getTask!({
      taskId: 'req_1',
      verb: 'research',
      apiKey: 'k',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return okJson({
          status: 'completed',
          content: 'final answer',
          sources: [{ url: 'https://x', title: 'X' }],
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe('https://api.tavily.com/research/req_1');
    expect(status.status).toBe('done');
    const data = status.data as { output: string; citations: unknown[] };
    expect(data.output).toBe('final answer');
    expect(data.citations).toHaveLength(1);
  });

  it('rejects unsupported verbs (only research is async on Tavily)', async () => {
    await expect(
      tavilyAdapter.getTask!({
        taskId: 't',
        verb: 'crawl',
        apiKey: 'k',
      }),
    ).rejects.toThrowError(/does not support task polling for verb "crawl"/);
  });

  it('treats 202 as in-flight, not error', async () => {
    const status = await tavilyAdapter.getTask!({
      taskId: 't',
      verb: 'research',
      apiKey: 'k',
      fetchFn: (async () =>
        new Response(JSON.stringify({ status: 'pending' }), {
          status: 202,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
    expect(status.status).toBe('queued');
  });

  it('returns 404 as validation error', async () => {
    await expect(
      tavilyAdapter.getTask!({
        taskId: 'gone',
        verb: 'research',
        apiKey: 'k',
        fetchFn: errStatus(404),
      }),
    ).rejects.toThrowError(/not found on Tavily/);
  });

  it('throws on missing apiKey', async () => {
    await expect(
      tavilyAdapter.getTask!({ taskId: 't', verb: 'research' }),
    ).rejects.toThrowError(/TAVILY_API_KEY/);
  });
});
