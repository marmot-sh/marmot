import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleVerifyCommand } from '../src/commands/verify.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-verify-'));
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

describe('handleVerifyCommand', () => {
  it('errors when no email is given', async () => {
    const { env } = await fixture();
    await expect(
      handleVerifyCommand([], { provider: 'hunter', apiKey: 'k' }, { env }),
    ).rejects.toThrow(/email address/);
  });

  it('rejects non-Hunter provider', async () => {
    const { env } = await fixture();
    await expect(
      handleVerifyCommand(['a@b.com'], { provider: 'pdl', apiKey: 'k' }, { env }),
    ).rejects.toThrow(/not supported by "pdl"/);
  });

  it('routes to Hunter and normalizes deliverable=true on valid', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          data: {
            status: 'valid',
            email: 'alice@acme.com',
            score: 99,
            regexp: true,
            mx_records: true,
            smtp_check: true,
            accept_all: false,
            disposable: false,
            webmail: false,
            gibberish: false,
            block: false,
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await handleVerifyCommand(
      ['alice@acme.com'],
      { provider: 'hunter', apiKey: 'hk' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.verb).toBe('verify');
    expect(out.type).toBe('email');
    expect(out.data.deliverable).toBe(true);
    expect(out.data.status).toBe('valid');
    expect(out.data.score).toBe(99);
  });

  it('accepts --email flag in lieu of positional', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ data: { status: 'invalid', email: 'a@b.com' } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    await handleVerifyCommand(
      [],
      { provider: 'hunter', apiKey: 'hk', email: 'a@b.com' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data.deliverable).toBe(false);
    expect(out.data.status).toBe('invalid');
  });

  it('--dry-run prints the resolved envelope without calling the provider', async () => {
    const { env } = await fixture();
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const stdout = new Cap();
    await handleVerifyCommand(
      ['a@b.com'],
      { provider: 'hunter', apiKey: 'hk' },
      { env: { ...env, MARMOT_DRY_RUN: '1' }, stdout, fetchFn },
    );
    expect(calls).toBe(0);
    const out = JSON.parse(stdout.text());
    expect(out.dry_run).toBe(true);
    expect(out.verb).toBe('verify');
    expect(out.provider).toBe('hunter');
    // Privacy: the email body must not appear in the dry-run envelope.
    expect(stdout.text()).not.toContain('a@b.com');
  });
});
