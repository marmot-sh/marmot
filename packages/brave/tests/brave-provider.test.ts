import { describe, expect, it } from 'vitest';

import { braveAdapter } from '../src/index.js';

describe('braveAdapter shape', () => {
  it('declares search + answer capabilities only', () => {
    expect(braveAdapter.slug).toBe('brave');
    expect(braveAdapter.name).toBe('Brave Search');
    expect(braveAdapter.requiresApiKey).toBe(true);
    expect(braveAdapter.capabilities).toEqual({
      search: true,
      scrape: false,
      research: false,
      answer: true,
      crawl: false,
      map: false,
      findall: false,
    });
    expect(typeof braveAdapter.search).toBe('function');
    expect(typeof braveAdapter.answer).toBe('function');
    expect(braveAdapter.scrape).toBeUndefined();
    expect(braveAdapter.research).toBeUndefined();
    expect(braveAdapter.crawl).toBeUndefined();
    expect(braveAdapter.map).toBeUndefined();
    expect(braveAdapter.findall).toBeUndefined();
    expect(braveAdapter.getTask).toBeUndefined();
  });
});

describe('braveAdapter.search', () => {
  it('builds the GET URL with q + count + freshness and passes X-Subscription-Token', async () => {
    let capturedUrl: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;

    const result = await braveAdapter.search!({
      apiKey: 'brave-test',
      query: 'openrouter pricing',
      limit: 10,
      freshness: 'week',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  url: 'https://example.com',
                  title: 'Example',
                  description: 'snippet',
                  age: '1d',
                },
              ],
            },
            query: { original: 'openrouter pricing' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch,
    });

    expect(capturedUrl).toContain('api.search.brave.com/res/v1/web/search');
    expect(capturedUrl).toContain('q=openrouter+pricing');
    expect(capturedUrl).toContain('count=10');
    expect(capturedUrl).toContain('freshness=pw');
    expect(capturedHeaders!['X-Subscription-Token']).toBe('brave-test');
    expect(result.provider).toBe('brave');
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      url: 'https://example.com',
      title: 'Example',
      snippet: 'snippet',
      publishedAt: '1d',
    });
  });

  it('caps limit at 20 (Brave page max)', async () => {
    let capturedUrl: string | undefined;
    await braveAdapter.search!({
      apiKey: 'k',
      query: 'x',
      limit: 200,
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toContain('count=20');
  });

  it('omits freshness param when not provided', async () => {
    let capturedUrl: string | undefined;
    await braveAdapter.search!({
      apiKey: 'k',
      query: 'x',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).not.toContain('freshness');
  });

  it('throws auth error when apiKey is missing', async () => {
    await expect(
      braveAdapter.search!({ query: 'x' }),
    ).rejects.toThrowError(/BRAVE_API_KEY/);
  });

  it('throws auth error on 401', async () => {
    await expect(
      braveAdapter.search!({
        apiKey: 'bad',
        query: 'x',
        fetchFn: (async () => new Response('', { status: 401 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/status 401/);
  });

  it('throws provider error on 5xx', async () => {
    await expect(
      braveAdapter.search!({
        apiKey: 'k',
        query: 'x',
        fetchFn: (async () => new Response('boom', { status: 502 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/status 502/);
  });

  it('throws cache error on malformed JSON', async () => {
    await expect(
      braveAdapter.search!({
        apiKey: 'k',
        query: 'x',
        fetchFn: (async () =>
          new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/invalid JSON/);
  });

  it('returns empty results array when web.results is missing', async () => {
    const result = await braveAdapter.search!({
      apiKey: 'k',
      query: 'x',
      fetchFn: (async () =>
        new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.data.results).toEqual([]);
  });
});

describe('braveAdapter.answer (chained 2-call)', () => {
  it('calls web/search with summary=1, then summarizer/search with the returned key', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request, _init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/web/search')) {
        return new Response(
          JSON.stringify({
            summarizer: { key: 'sum_abc123' },
            web: {
              results: [
                { url: 'https://a.com', title: 'A', description: 'first' },
                { url: 'https://b.com', title: 'B', description: 'second' },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          summary: [{ data: 'Final answer text.', type: 'text' }],
          title: 'Result',
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const result = await braveAdapter.answer!({
      apiKey: 'k',
      query: 'what is openrouter',
      fetchFn,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('/web/search');
    expect(calls[0]).toContain('summary=1');
    expect(calls[1]).toContain('/summarizer/search');
    expect(calls[1]).toContain('key=sum_abc123');
    expect(result.provider).toBe('brave');
    expect(result.data.answer).toBe('Final answer text.');
    expect(result.data.citations).toHaveLength(2);
    expect(result.data.citations[0]).toMatchObject({
      url: 'https://a.com',
      title: 'A',
      snippet: 'first',
    });
  });

  it('respects maxCitations cap', async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/web/search')) {
        return new Response(
          JSON.stringify({
            summarizer: { key: 'k1' },
            web: {
              results: Array.from({ length: 20 }, (_, i) => ({
                url: `https://r${i}.com`,
                title: `T${i}`,
              })),
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ summary: [{ data: 'ok' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await braveAdapter.answer!({
      apiKey: 'k',
      query: 'x',
      maxCitations: 3,
      fetchFn,
    });
    expect(result.data.citations).toHaveLength(3);
  });

  it('throws when web/search response has no summarizer key (not summarizable)', async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ web: { results: [] } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await expect(
      braveAdapter.answer!({ apiKey: 'k', query: 'x', fetchFn }),
    ).rejects.toThrowError(/summarizer key/);
  });

  it('throws on auth failure during the search step', async () => {
    const fetchFn = (async () =>
      new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(
      braveAdapter.answer!({ apiKey: 'bad', query: 'x', fetchFn }),
    ).rejects.toThrowError(/status 401/);
  });

  it('throws on auth failure during the summarizer step', async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/web/search')) {
        return new Response(
          JSON.stringify({
            summarizer: { key: 'k' },
            web: { results: [] },
          }),
          { status: 200 },
        );
      }
      return new Response('', { status: 403 });
    }) as unknown as typeof fetch;
    await expect(
      braveAdapter.answer!({ apiKey: 'k', query: 'x', fetchFn }),
    ).rejects.toThrowError(/status 403/);
  });

  it('throws auth error when apiKey is missing', async () => {
    await expect(
      braveAdapter.answer!({ query: 'x' }),
    ).rejects.toThrowError(/BRAVE_API_KEY/);
  });
});
