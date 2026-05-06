import { describe, expect, it } from 'vitest';

import { exaAdapter } from '../src/index.js';

const okJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const errStatus = (status: number): typeof fetch =>
  (async () => new Response('', { status })) as unknown as typeof fetch;

describe('exaAdapter shape', () => {
  it('declares the expected capabilities', () => {
    expect(exaAdapter.slug).toBe('exa');
    expect(exaAdapter.name).toBe('Exa');
    expect(exaAdapter.requiresApiKey).toBe(true);
    expect(exaAdapter.capabilities).toEqual({
      search: true,
      scrape: true,
      research: true,
      answer: true,
      crawl: false,
      map: false,
      findall: true,
    });
    expect(typeof exaAdapter.search).toBe('function');
    expect(typeof exaAdapter.scrape).toBe('function');
    expect(typeof exaAdapter.answer).toBe('function');
    expect(typeof exaAdapter.research).toBe('function');
    expect(typeof exaAdapter.findall).toBe('function');
    expect(typeof exaAdapter.getTask).toBe('function');
    expect(exaAdapter.crawl).toBeUndefined();
    expect(exaAdapter.map).toBeUndefined();
  });
});

describe('exaAdapter.search', () => {
  it('POSTs to /search with x-api-key, normalizes results', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await exaAdapter.search!({
      apiKey: 'exa-test',
      query: 'postgres pricing',
      limit: 5,
      depth: 'standard',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.exa.ai/search');
        const headers = init?.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('exa-test');
        captured = JSON.parse(String(init?.body));
        return okJson({
          results: [
            {
              url: 'https://example.com',
              title: 'Example',
              score: 0.85,
              publishedDate: '2026-01-01',
              text: 'full content here',
            },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ query: 'postgres pricing', type: 'auto', numResults: 5 });
    expect(result.provider).toBe('exa');
    expect(result.data.results).toHaveLength(1);
    expect(result.data.results[0]).toMatchObject({
      url: 'https://example.com',
      title: 'Example',
      score: 0.85,
      publishedAt: '2026-01-01',
      content: 'full content here',
    });
  });

  it('maps depth basic→fast, deep→neural, standard→auto', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      captured.push(JSON.parse(String(init?.body)));
      return okJson({ results: [] });
    }) as unknown as typeof fetch;

    for (const d of ['basic', 'standard', 'deep'] as const) {
      await exaAdapter.search!({ apiKey: 'k', query: 'x', depth: d, fetchFn });
    }
    expect(captured.map((b) => b.type)).toEqual(['fast', 'auto', 'neural']);
  });

  it('passes includeContent → contents:{text:true}', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.search!({
      apiKey: 'k',
      query: 'x',
      includeContent: true,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured?.contents).toEqual({ text: true });
  });

  it('throws auth error when apiKey missing', async () => {
    await expect(exaAdapter.search!({ query: 'x' })).rejects.toThrowError(/EXA_API_KEY/);
  });

  it('surfaces 401 as auth error', async () => {
    await expect(
      exaAdapter.search!({ apiKey: 'bad', query: 'x', fetchFn: errStatus(401) }),
    ).rejects.toThrowError(/status 401/);
  });

  it('surfaces 5xx as provider error', async () => {
    await expect(
      exaAdapter.search!({ apiKey: 'k', query: 'x', fetchFn: errStatus(503) }),
    ).rejects.toThrowError(/status 503/);
  });

  it('passes afterDate as startPublishedDate in ISO datetime form', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.search!({
      apiKey: 'k',
      query: 'x',
      afterDate: '2026-01-15',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ startPublishedDate: '2026-01-15T00:00:00.000Z' });
  });

  it('passes beforeDate as endPublishedDate at end-of-day', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.search!({
      apiKey: 'k',
      query: 'x',
      beforeDate: '2026-02-15',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ endPublishedDate: '2026-02-15T23:59:59.999Z' });
  });

  it('maps relative freshness to startPublishedDate when afterDate is not set', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.search!({
      apiKey: 'k',
      query: 'x',
      freshness: 'week',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect((captured as Record<string, string>).startPublishedDate).toMatch(
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/,
    );
  });

  it('explicit afterDate wins over freshness mapping', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.search!({
      apiKey: 'k',
      query: 'x',
      afterDate: '2026-01-15',
      freshness: 'year',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ startPublishedDate: '2026-01-15T00:00:00.000Z' });
  });

  it('omits date fields entirely when neither afterDate nor beforeDate nor freshness is set', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.search!({
      apiKey: 'k',
      query: 'x',
      fetchFn: (async (_u: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ results: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured).not.toHaveProperty('startPublishedDate');
    expect(captured).not.toHaveProperty('endPublishedDate');
  });
});

describe('exaAdapter.scrape', () => {
  it('POSTs to /contents with urls + text:true', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await exaAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a.com', 'https://b.com'],
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.exa.ai/contents');
        captured = JSON.parse(String(init?.body));
        return okJson({
          results: [
            { url: 'https://a.com', title: 'A', text: 'aaa' },
            { url: 'https://b.com', title: 'B', text: 'bbb' },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(captured).toEqual({ urls: ['https://a.com', 'https://b.com'], text: true });
    expect(result.data.pages).toHaveLength(2);
    expect(result.data.pages[0]!.format).toBe('markdown');
    expect(result.data.pages[0]!.content).toBe('aaa');
    expect(result.data.failed).toEqual([]);
  });

  it('reports failed URLs (those not present in response)', async () => {
    const result = await exaAdapter.scrape!({
      apiKey: 'k',
      urls: ['https://a.com', 'https://b.com'],
      fetchFn: (async () =>
        okJson({ results: [{ url: 'https://a.com', text: 'aaa' }] })) as unknown as typeof fetch,
    });
    expect(result.data.failed).toEqual(['https://b.com']);
  });

  it('throws when urls is empty', async () => {
    await expect(
      exaAdapter.scrape!({ apiKey: 'k', urls: [] }),
    ).rejects.toThrowError(/At least one URL/);
  });

  it('throws auth error when apiKey missing', async () => {
    await expect(
      exaAdapter.scrape!({ urls: ['https://a'] }),
    ).rejects.toThrowError(/EXA_API_KEY/);
  });

  it('surfaces 401', async () => {
    await expect(
      exaAdapter.scrape!({
        apiKey: 'bad',
        urls: ['https://a'],
        fetchFn: errStatus(401),
      }),
    ).rejects.toThrowError(/status 401/);
  });
});

describe('exaAdapter.answer', () => {
  it('POSTs to /answer and parses {answer, citations}', async () => {
    const result = await exaAdapter.answer!({
      apiKey: 'k',
      query: 'what is exa',
      fetchFn: (async (url: string | URL | Request) => {
        expect(String(url)).toBe('https://api.exa.ai/answer');
        return okJson({
          answer: 'Exa is a search API.',
          citations: [
            { url: 'https://exa.ai', title: 'Home', snippet: 'about' },
          ],
        });
      }) as unknown as typeof fetch,
    });
    expect(result.provider).toBe('exa');
    expect(result.data.answer).toBe('Exa is a search API.');
    expect(result.data.citations[0]).toEqual({
      url: 'https://exa.ai',
      title: 'Home',
      snippet: 'about',
    });
  });

  it('passes text:true when includeSearch is set', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.answer!({
      apiKey: 'k',
      query: 'x',
      includeSearch: true,
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ answer: '', citations: [] });
      }) as unknown as typeof fetch,
    });
    expect(captured?.text).toBe(true);
  });

  it('handles empty citations array', async () => {
    const result = await exaAdapter.answer!({
      apiKey: 'k',
      query: 'x',
      fetchFn: (async () => okJson({ answer: 'ok' })) as unknown as typeof fetch,
    });
    expect(result.data.citations).toEqual([]);
  });

  it('throws on missing apiKey', async () => {
    await expect(
      exaAdapter.answer!({ query: 'x' }),
    ).rejects.toThrowError(/EXA_API_KEY/);
  });
});

describe('exaAdapter.research (submission)', () => {
  it('POSTs to /research/v0/tasks with instructions + model', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await exaAdapter.research!({
      apiKey: 'k',
      query: 'study postgres',
      depth: 'deep',
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.exa.ai/research/v0/tasks');
        captured = JSON.parse(String(init?.body));
        return okJson({ id: 'task_xyz' });
      }) as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({
      instructions: 'study postgres',
      model: 'exa-research-pro',
    });
    expect(result.taskId).toBe('task_xyz');
  });

  it('uses exa-research model when depth is not deep', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.research!({
      apiKey: 'k',
      query: 'x',
      depth: 'standard',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ id: 't' });
      }) as unknown as typeof fetch,
    });
    expect(captured?.model).toBe('exa-research');
  });

  it('passes output.schema when schema is provided', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.research!({
      apiKey: 'k',
      query: 'x',
      schema: { type: 'object', properties: { name: { type: 'string' } } },
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ id: 't' });
      }) as unknown as typeof fetch,
    });
    expect(captured?.output).toMatchObject({
      schema: { type: 'object' },
    });
  });

  it('throws when response lacks an id', async () => {
    await expect(
      exaAdapter.research!({
        apiKey: 'k',
        query: 'x',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return a task id/);
  });
});

describe('exaAdapter.findall', () => {
  it('POSTs to /websets/v0/websets with body { search: { query, count } }', async () => {
    let captured: Record<string, unknown> | undefined;
    const result = await exaAdapter.findall!({
      apiKey: 'k',
      objective: 'find YC AI startups',
      limit: 50,
      fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.exa.ai/websets/v0/websets');
        captured = JSON.parse(String(init?.body));
        return okJson({ id: 'ws_42' });
      }) as unknown as typeof fetch,
    });
    expect(captured).toEqual({
      search: { query: 'find YC AI startups', count: 50 },
    });
    expect(result.taskId).toBe('ws_42');
  });

  it('omits count when limit is not provided', async () => {
    let captured: Record<string, unknown> | undefined;
    await exaAdapter.findall!({
      apiKey: 'k',
      objective: 'x',
      fetchFn: (async (_url: string | URL | Request, init?: RequestInit) => {
        captured = JSON.parse(String(init?.body));
        return okJson({ id: 'w' });
      }) as unknown as typeof fetch,
    });
    expect(captured).toEqual({ search: { query: 'x' } });
  });

  it('throws when response lacks an id', async () => {
    await expect(
      exaAdapter.findall!({
        apiKey: 'k',
        objective: 'x',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/did not return a webset id/);
  });
});

describe('exaAdapter.getTask', () => {
  it('routes research → /research/v0/tasks/{id}', async () => {
    let capturedUrl: string | undefined;
    const status = await exaAdapter.getTask!({
      taskId: 'tsk_1',
      verb: 'research',
      apiKey: 'k',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return okJson({
          status: 'completed',
          answer: 'done',
          citations: [{ url: 'https://x', title: 'X' }],
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe('https://api.exa.ai/research/v0/tasks/tsk_1');
    expect(status.status).toBe('done');
    expect(status.data).toMatchObject({ output: 'done' });
  });

  it('routes findall → /websets/v0/websets/{id}', async () => {
    let capturedUrl: string | undefined;
    const status = await exaAdapter.getTask!({
      taskId: 'ws_1',
      verb: 'findall',
      apiKey: 'k',
      fetchFn: (async (url: string | URL | Request) => {
        capturedUrl = String(url);
        return okJson({
          status: 'completed',
          items: [{ name: 'A' }, { name: 'B' }],
        });
      }) as unknown as typeof fetch,
    });
    expect(capturedUrl).toBe('https://api.exa.ai/websets/v0/websets/ws_1');
    expect(status.status).toBe('done');
    expect(status.data).toMatchObject({ items: [{ name: 'A' }, { name: 'B' }] });
  });

  it('rejects unsupported verbs', async () => {
    await expect(
      exaAdapter.getTask!({
        taskId: 't',
        verb: 'crawl',
        apiKey: 'k',
        fetchFn: (async () => okJson({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrowError(/does not support task polling for verb "crawl"/);
  });

  it('maps unknown status to running', async () => {
    const status = await exaAdapter.getTask!({
      taskId: 't',
      verb: 'research',
      apiKey: 'k',
      fetchFn: (async () => okJson({ status: 'in_progress' })) as unknown as typeof fetch,
    });
    expect(status.status).toBe('running');
  });

  it('returns 404 as a validation error', async () => {
    await expect(
      exaAdapter.getTask!({
        taskId: 'gone',
        verb: 'research',
        apiKey: 'k',
        fetchFn: errStatus(404),
      }),
    ).rejects.toThrowError(/not found on Exa/);
  });

  it('throws on missing apiKey', async () => {
    await expect(
      exaAdapter.getTask!({ taskId: 't', verb: 'research' }),
    ).rejects.toThrowError(/EXA_API_KEY/);
  });
});
