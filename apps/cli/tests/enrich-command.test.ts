import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleEnrichCommand } from '../src/commands/enrich.js';
import { writeMarmotConfig } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-enrich-'));
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

describe('handleEnrichCommand', () => {
  it('rejects --type email (suggests verify or lookup)', async () => {
    const { env } = await fixture();
    await expect(
      handleEnrichCommand({ type: 'email', email: 'a@b.com' }, { env }),
    ).rejects.toThrow(/does not support --type email/);
  });

  it('errors when no default provider and no --provider', async () => {
    const { env } = await fixture();
    await expect(
      handleEnrichCommand({ email: 'a@b.com' }, { env }),
    ).rejects.toThrow(/No default provider for "enrich"/);
  });

  it('errors when chosen provider does not support the cell', async () => {
    const { env } = await fixture();
    await expect(
      handleEnrichCommand(
        { type: 'person', provider: 'tavily', email: 'a@b.com', apiKey: 'k' },
        { env },
      ),
    ).rejects.toThrow(/not supported by "tavily"/);
  });

  it('errors when --type person has no identifiers', async () => {
    const { env } = await fixture();
    await expect(
      handleEnrichCommand(
        { type: 'person', provider: 'pdl', apiKey: 'k' },
        { env },
      ),
    ).rejects.toThrow(/at least one identifier/);
  });

  it('errors when --type org has no identifiers', async () => {
    const { env } = await fixture();
    await expect(
      handleEnrichCommand({ type: 'org', provider: 'pdl', apiKey: 'k' }, { env }),
    ).rejects.toThrow(/at least one identifier/);
  });

  it('routes person through PDL with identifiers + match controls', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    let capturedUrl: URL | undefined;
    const fetchFn = (async (url: string | URL | Request) => {
      capturedUrl = new URL(String(url));
      return new Response(
        JSON.stringify({
          status: 200,
          likelihood: 8,
          data: {
            id: 'p1',
            full_name: 'Alice Smith',
            first_name: 'Alice',
            last_name: 'Smith',
            work_email: 'alice@acme.com',
            job_title: 'Engineer',
            job_company_name: 'Acme',
            job_company_website: 'acme.com',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await handleEnrichCommand(
      {
        type: 'person',
        provider: 'pdl',
        apiKey: 'pdl-k',
        firstName: 'Alice',
        lastName: 'Smith',
        company: 'acme.com',
        minLikelihood: '6',
        require: 'emails',
        fields: 'emails,phone_numbers',
      },
      { env, stdout, fetchFn },
    );

    expect(capturedUrl?.pathname).toBe('/v5/person/enrich');
    expect(capturedUrl?.searchParams.get('first_name')).toBe('Alice');
    expect(capturedUrl?.searchParams.get('last_name')).toBe('Smith');
    expect(capturedUrl?.searchParams.get('company')).toBe('acme.com');
    expect(capturedUrl?.searchParams.get('min_likelihood')).toBe('6');
    expect(capturedUrl?.searchParams.get('required')).toBe('emails');
    expect(capturedUrl?.searchParams.get('data_include')).toBe('emails,phone_numbers');

    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('pdl');
    expect(out.verb).toBe('enrich');
    expect(out.type).toBe('person');
    expect(out.data.person.fullName).toBe('Alice Smith');
    expect(out.data.person.org.domain).toBe('acme.com');
  });

  it('routes org through Hunter with --domain', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, defaults: { enrich: { provider: 'hunter' } } },
      env,
    );
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          data: {
            id: 'c1',
            name: 'Acme',
            domain: 'acme.com',
            metrics: { employees: 500 },
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await handleEnrichCommand(
      { type: 'org', domain: 'acme.com', apiKey: 'hk' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.provider).toBe('hunter');
    expect(out.type).toBe('org');
    expect(out.data.org.name).toBe('Acme');
    expect(out.data.org.headcount).toBe(500);
  });

  it('honors --raw', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(JSON.stringify({ status: 200, data: { id: 'p1', full_name: 'A' } }), {
        status: 200,
      })) as unknown as typeof fetch;
    await handleEnrichCommand(
      { type: 'person', provider: 'pdl', email: 'a@b.com', apiKey: 'k', raw: true },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data).toBeNull();
    expect(out.raw).toBeTruthy();
  });
});
