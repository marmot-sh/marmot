import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleLookupCommand } from '../src/commands/lookup.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-lookup-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir }, dir };
}

class Cap {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('handleLookupCommand', () => {
  it('errors when no default provider and no --provider', async () => {
    const { env } = await fixture();
    await expect(
      handleLookupCommand({ title: 'engineer' }, { env }),
    ).rejects.toThrow(/No default provider for "lookup"/);
  });

  it('rejects unsupported cell (lookup --type email --provider pdl)', async () => {
    const { env } = await fixture();
    await expect(
      handleLookupCommand(
        { type: 'email', provider: 'pdl', domain: 'acme.com', apiKey: 'k' },
        { env },
      ),
    ).rejects.toThrow(/not supported by "pdl"/);
  });

  it('lookup --type person via PDL builds ES DSL bool/must', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    let capturedBody: Record<string, unknown> | undefined;
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          status: 200,
          total: 1,
          data: [
            {
              id: 'p1',
              full_name: 'Alice',
              job_title: 'Engineer',
              job_company_website: 'acme.com',
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleLookupCommand(
      {
        type: 'person',
        provider: 'pdl',
        apiKey: 'k',
        title: 'engineer',
        domain: 'acme.com,plaid.com',
        employees: '100,500',
        limit: '5',
      },
      { env, stdout, fetchFn },
    );
    const must = ((capturedBody?.query as { bool: { must: Array<Record<string, unknown>> } }).bool.must);
    expect(must).toContainEqual({ match: { job_title: 'engineer' } });
    expect(must).toContainEqual({ terms: { job_company_website: ['acme.com', 'plaid.com'] } });
    expect(must).toContainEqual({
      range: { job_company_employee_count: { gte: 100, lte: 500 } },
    });
    expect(capturedBody?.size).toBe(5);

    const out = JSON.parse(stdout.text());
    expect(out.verb).toBe('lookup');
    expect(out.type).toBe('person');
    expect(out.data.results).toHaveLength(1);
  });

  it('lookup --type email via Hunter populates pattern + acceptAll', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          data: {
            domain: 'acme.com',
            pattern: '{first}.{last}',
            accept_all: false,
            emails: [
              {
                value: 'alice@acme.com',
                type: 'personal',
                confidence: 95,
                first_name: 'Alice',
                last_name: 'Smith',
              },
            ],
          },
          meta: { results: 1 },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await handleLookupCommand(
      {
        type: 'email',
        provider: 'hunter',
        apiKey: 'hk',
        domain: 'acme.com',
        department: 'engineering',
      },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.provider).toBe('hunter');
    expect(out.type).toBe('email');
    expect(out.data.pattern).toBe('{first}.{last}');
    expect(out.data.acceptAll).toBe(false);
    expect(out.data.results[0].email).toBe('alice@acme.com');
  });

  it('lookup --type email errors without --domain or --company', async () => {
    const { env } = await fixture();
    await expect(
      handleLookupCommand(
        { type: 'email', provider: 'hunter', apiKey: 'hk' },
        { env },
      ),
    ).rejects.toThrow(/--domain or --company/);
  });

  it('--employees rejects malformed range', async () => {
    const { env } = await fixture();
    await expect(
      handleLookupCommand(
        {
          type: 'person',
          provider: 'pdl',
          apiKey: 'k',
          title: 'eng',
          employees: 'abc',
        },
        { env },
      ),
    ).rejects.toThrow(/--employees must be "min,max"/);
  });
});
