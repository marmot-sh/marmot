import { describe, expect, it } from 'vitest';

import { firecrawlAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errStatus = (status: number): typeof fetch =>
  (async () => new Response('', { status })) as unknown as typeof fetch;

describe('firecrawlAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(firecrawlAdapter.slug).toBe('firecrawl');
    expect(firecrawlAdapter.name).toBe('Firecrawl');
    expect(firecrawlAdapter.requiresApiKey).toBe(true);
    expect(firecrawlAdapter.capabilities).toEqual({
      search: true,
      scrape: true,
      research: true,
      answer: false,
      crawl: true,
      map: true,
      findall: false,
    });
    expect(typeof firecrawlAdapter.search).toBe('function');
    expect(typeof firecrawlAdapter.scrape).toBe('function');
    expect(typeof firecrawlAdapter.map).toBe('function');
    expect(typeof firecrawlAdapter.crawlSubmit).toBe('function');
    expect(typeof firecrawlAdapter.research).toBe('function');
    expect(typeof firecrawlAdapter.getTask).toBe('function');
    expect(firecrawlAdapter.answer).toBeUndefined();
    expect(firecrawlAdapter.findall).toBeUndefined();
    expect(firecrawlAdapter.crawl).toBeUndefined();
  });
});

describe('firecrawlAdapter.search', () => {
  it('POSTs /v2/search with Bearer auth and sources:[web]', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await firecrawlAdapter.search!({
      apiKey: 'fc-test',
      query: 'next.js',
      limit: 10,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.firecrawl.dev/v2/search');
        const headers = init?.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer fc-test');
        captured = JSON.parse(String(init?.body));
        return okJson({
          success: true,
          data: {
            web: [
              { url: 'https://nextjs.org', title: 'Next.js', description: 'react' },
            ],
          },
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ query: 'next.js', sources: ['web'], limit: 10 });
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      url: 'https://nextjs.org',
      title: 'Next.js',
      snippet: 'react',
    });
  });

  it('passes scrapeOptions when includeContent is set', async () => {
    let captured: Record<string, unknown> | undefined;
    await firecrawlAdapter.search!({
      apiKey: 'k',
      query: 'x',
      includeContent: true,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ success: true, data: { web: [] } });
      }) as unknown as typeof fetch,
    });
    expect(captured?.scrapeOptions).toEqual({ formats: ['markdown'] });
  });

  it('throws on missing apiKey', async () => {
    await expect(firecrawlAdapter.search!({ query: 'x' })).rejects.toThrowError(/FIRECRAWL_API_KEY/);
  });

  it('surfaces 401', async () => {
    await expect(
      firecrawlAdapter.search!({ apiKey: 'bad', query: 'x', fetchFn: errStatus(401) }),
    ).rejects.toThrowError(/status 401/);
  });

  it('returns empty when data.web is missing', async () => {
    const result = await firecrawlAdapter.search!({
      apiKey: 'k',
      query: 'x',
      fetchFn: (async () => okJson({ success: true, data: {} })) as unknown as typeof fetch,
    });
    expect(result.data.results).toEqual([]);
  });
});

describe('firecrawlAdapter.scrape', () => {
  it('issues one POST per URL and merges results', async () => {
    const calls: string[] = [];
    const result = await firecrawlAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a.com', 'https://b.com'],
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body));
        return okJson({
          data: { markdown: `md-${body.url}`, metadata: { title: `T-${body.url}` } },
        });
      }) as unknown as typeof fetch,
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c === 'https://api.firecrawl.dev/v2/scrape')).toBe(true);
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[0]!.url).toBe('https://a.com');
    expect(result.data.pages[0]!.content).toBe('md-https://a.com');
    expect(result.data.pages[0]!.format).toBe('markdown');
    expect(result.data.failed).toEqual([]);
  });

  it('records failed URLs separately', async () => {
    const result = await firecrawlAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://ok.com', 'https://broken.com'],
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (body.url === 'https://broken.com') {
          return new Response('', { status: 500 });
        }
        return okJson({ data: { markdown: 'ok' } });
      }) as unknown as typeof fetch,
    });
    expect(result.data.pages).toHaveLength(1);
    expect(result.data.pages[0]!.url).toBe('https://ok.com');
    expect(result.data.failed).toEqual(['https://broken.com']);
  });

  it('honors --format html', async () => {
    let capturedFormats: unknown;
    await firecrawlAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://x'],
      format: 'html',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        capturedFormats = JSON.parse(String(init?.body)).formats;
        return okJson({ data: { html: '<p>x</p>' } });
      }) as unknown as typeof fetch,
    });
    expect(capturedFormats).toEqual(['html']);
  });

  it('throws on empty urls', async () => {
    await expect(firecrawlAdapter.scrape!({ apiKey: 'k', urls: [] })).rejects.toThrowError(
      /At least one URL/,
    );
  });

  it('throws on missing apiKey', async () => {
    await expect(
      firecrawlAdapter.scrape!({ urls: ['https://x'] }),
    ).rejects.toThrowError(/FIRECRAWL_API_KEY/);
  });
});

describe('firecrawlAdapter.map', () => {
  it('POSTs /v2/map with url + search + limit', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await firecrawlAdapter.map!({
      apiKey: 'k',
      url: 'https://docs.example.com',
      search: 'pricing',
      limit: 100,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.firecrawl.dev/v2/map');
        captured = JSON.parse(String(init?.body));
        return okJson({
          success: true,
          links: [
            { url: 'https://docs.example.com/pricing', title: 'Pricing', description: '' },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toEqual({
      url: 'https://docs.example.com',
      search: 'pricing',
      limit: 100,
    });
    expect(result.data.urls).toHaveLength(1);
    expect(result.data.urls[0]!.url).toBe('https://docs.example.com/pricing');
    expect(result.data.urls[0]!.title).toBe('Pricing');
  });

  it('throws on missing apiKey', async () => {
    await expect(firecrawlAdapter.map!({ url: 'https://x' })).rejects.toThrowError(
      /FIRECRAWL_API_KEY/,
    );
  });

  it('surfaces 5xx as provider error', async () => {
    await expect(
      firecrawlAdapter.map!({ apiKey: 'k', url: 'https://x', fetchFn: errStatus(503) }),
    ).rejects.toThrowError(/status 503/);
  });
});

describe('firecrawlAdapter.crawlSubmit', () => {
  it('POSTs /v2/crawl with url + limit + maxDiscoveryDepth and returns id', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await firecrawlAdapter.crawlSubmit!({
      apiKey: 'k',
      url: 'https://example.com',
      maxPages: 200,
      maxDepth: 3,
      includePaths: ['^/docs/'],
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.firecrawl.dev/v2/crawl');
        captured = JSON.parse(String(init?.body));
        return okJson({ id: 'crawl_42' });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      url: 'https://example.com',
      limit: 200,
      maxDiscoveryDepth: 3,
      includePaths: ['^/docs/'],
    });
    expect(result.taskId).toBe('crawl_42');
  });

  it('throws when response has no id', async () => {
    await expect(
      firecrawlAdapter.crawlSubmit!({
        apiKey: 'k',
        url: 'https://x',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return an id/);
  });
});

describe('firecrawlAdapter.research', () => {
  it('POSTs /v1/deep-research and returns id', async () => {
    // Firecrawl has migrated search/scrape/map/crawl to /v2 but deep-research
    // is still on /v1. Adapter follows the live API; this test follows suit.
    const result = await firecrawlAdapter.research!({
      apiKey: 'k',
      query: 'study postgres',
      depth: 'deep',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.firecrawl.dev/v1/deep-research');
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({ query: 'study postgres', maxDepth: 4 });
        return okJson({ id: 'rs_99' });
      }) as unknown as typeof fetch,
    });
    expect(result.taskId).toBe('rs_99');
  });

  it('throws when response has no id', async () => {
    await expect(
      firecrawlAdapter.research!({
        apiKey: 'k',
        query: 'x',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return an id/);
  });
});

describe('firecrawlAdapter.getTask', () => {
  it('routes crawl → /v2/crawl/{id} and parses pages', async () => {
    let capturedUrl: string | undefined;
    const status = await firecrawlAdapter.getTask!({
      taskId: 'crawl_1',
      verb: 'crawl',
      apiKey: 'k',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return okJson({
          status: 'completed',
          completed: 2,
          total: 2,
          data: [
            { url: 'https://x.com/a', markdown: '# A', metadata: { title: 'A' } },
            { url: 'https://x.com/b', markdown: '# B', metadata: { title: 'B' } },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe('https://api.firecrawl.dev/v2/crawl/crawl_1');
    expect(status.status).toBe('done');
    const data = status.data as { pages: Array<{ url: string }>; stats: unknown };
    expect(data.pages).toHaveLength(2);
    expect(data.stats).toEqual({ crawled: 2, errors: 0 });
  });

  it('routes research → /v2/deep-research/{id} and parses finalAnalysis', async () => {
    const status = await firecrawlAdapter.getTask!({
      taskId: 'rs_1',
      verb: 'research',
      apiKey: 'k',
      fetchFn: (async () =>
        okJson({
          status: 'completed',
          finalAnalysis: 'final result',
        })) as unknown as typeof fetch,
    });
    expect(status.status).toBe('done');
    expect((status.data as { output: string }).output).toBe('final result');
  });

  it('rejects unsupported verbs', async () => {
    await expect(
      firecrawlAdapter.getTask!({
        taskId: 't',
        verb: 'findall',
        apiKey: 'k',
      }),
    ).rejects.toThrowError(/does not support task polling for verb "findall"/);
  });

  it('returns 404 as validation error', async () => {
    await expect(
      firecrawlAdapter.getTask!({
        taskId: 'gone',
        verb: 'crawl',
        apiKey: 'k',
        fetchFn: errStatus(404),
      }),
    ).rejects.toThrowError(/not found on Firecrawl/);
  });

  it('maps unknown status to running', async () => {
    const status = await firecrawlAdapter.getTask!({
      taskId: 't',
      verb: 'crawl',
      apiKey: 'k',
      fetchFn: (async () => okJson({ status: 'scraping' })) as unknown as typeof fetch,
    });
    expect(status.status).toBe('running');
  });
});
