import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { handleAnswerCommand } from '../src/commands/answer.js';
import { writeMarmotConfig } from '@marmot-sh/core';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-answer-'));
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

describe('handleAnswerCommand', () => {
  it('errors on missing query', async () => {
    const { env } = await fixture();
    await expect(handleAnswerCommand([], {}, { env })).rejects.toThrowError(
      /Answer requires a query/,
    );
  });

  it('errors on missing default provider', async () => {
    const { env } = await fixture();
    await expect(
      handleAnswerCommand(['hi'], {}, { env }),
    ).rejects.toThrowError(/No default provider for "answer"/);
  });

  it('errors when --provider is not capable of answer (parallel)', async () => {
    const { env } = await fixture();
    await expect(
      handleAnswerCommand(['hi'], { provider: 'parallel', apiKey: 'k' }, { env }),
    ).rejects.toThrowError(/not supported by "parallel"/);
  });

  it('routes through tavily (inline include_answer)', async () => {
    const { env } = await fixture();
    await writeMarmotConfig(
      { version: 1, defaults: { answer: { provider: 'tavily' } } },
      env,
    );
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          answer: 'OpenRouter routes models.',
          results: [{ url: 'https://a', title: 'A', content: 's' }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await handleAnswerCommand(
      ['what', 'is', 'openrouter'],
      { apiKey: 'tvly' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.provider).toBe('tavily');
    expect(out.verb).toBe('answer');
    expect(out.data.answer).toBe('OpenRouter routes models.');
    expect(out.data.citations).toHaveLength(1);
  });

  it('routes through brave (chained 2-call)', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/web/search')) {
        return new Response(
          JSON.stringify({
            summarizer: { key: 'sum_k' },
            web: { results: [{ url: 'https://r', title: 'R', description: 'd' }] },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ summary: [{ data: 'final' }], title: 'T' }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    await handleAnswerCommand(
      ['x'],
      { provider: 'brave', apiKey: 'b' },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.provider).toBe('brave');
    expect(out.data.answer).toBe('final');
  });

  it('honors --raw', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    const fetchFn = (async () =>
      new Response(JSON.stringify({ answer: 'x', citations: [] }), { status: 200 })) as unknown as typeof fetch;
    await handleAnswerCommand(
      ['x'],
      { provider: 'exa', apiKey: 'k', raw: true },
      { env, stdout, fetchFn },
    );
    const out = JSON.parse(stdout.text());
    expect(out.data).toBeNull();
    expect(out.raw).toBeTruthy();
  });
});
