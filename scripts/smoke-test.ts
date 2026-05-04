#!/usr/bin/env tsx
/* eslint-disable no-console */
// Live API smoke test — exercises every ✓ cell of the web/data matrix that has
// a configured API key. Records results to _docs/providers/smoke-test-log.md.
//
// Usage:
//   pnpm smoke
//
// Reads API keys from env (BRAVE_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY,
// PARALLEL_API_KEY, TAVILY_API_KEY). Cells without a key are recorded as
// "⏭ skipped (no key)". Async verbs (research/crawl/findall) submit only and
// record the task id — they do not poll for completion. Follow up with
// `marmot get <taskId> --provider <slug>` to retrieve results.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { apolloAdapter } from '@marmot-sh/apollo';
import { bouncerAdapter } from '@marmot-sh/bouncer';
import { braveAdapter } from '@marmot-sh/brave';
import {
  DATA_PROVIDER_API_KEY_ENV_VARS,
  DATA_PROVIDER_DISPLAY_NAMES,
  WEB_PROVIDER_API_KEY_ENV_VARS,
  WEB_PROVIDER_DISPLAY_NAMES,
  type DataProviderSlug,
  type WebProviderSlug,
} from '@marmot-sh/core';
import { datagmaAdapter } from '@marmot-sh/datagma';
import { exaAdapter } from '@marmot-sh/exa';
import { firecrawlAdapter } from '@marmot-sh/firecrawl';
import { hunterAdapter } from '@marmot-sh/hunter';
import { kickboxAdapter } from '@marmot-sh/kickbox';
import { parallelAdapter } from '@marmot-sh/parallel';
import { pdlAdapter } from '@marmot-sh/pdl';
import { tavilyAdapter } from '@marmot-sh/tavily';
import { tombaAdapter } from '@marmot-sh/tomba';
import { zerobounceAdapter } from '@marmot-sh/zerobounce';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, '../_docs/providers/smoke-test-log.md');

const SAFE_SCRAPE_URL = 'https://example.com';
const SAFE_MAP_URL = 'https://example.com';
const SAFE_CRAWL_URL = 'https://example.com';

type CellResult =
  | { status: 'ok'; ms: number; summary: string; taskId?: string }
  | { status: 'error'; ms: number; error: string }
  | { status: 'skipped'; reason: string };

type Cell = {
  provider: WebProviderSlug | DataProviderSlug;
  verb: string;
  /** When true, this cell submits an async task and reports the taskId. */
  asyncSubmit?: boolean;
  /** Brief human-readable description of what's being tested. */
  what: string;
  run: (apiKey: string) => Promise<{ summary: string; taskId?: string }>;
};

function isDataProvider(p: WebProviderSlug | DataProviderSlug): p is DataProviderSlug {
  return p in DATA_PROVIDER_API_KEY_ENV_VARS;
}

function brief(value: unknown): string {
  // Pull the most informative shape from a normalized result envelope.
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  const v = value as Record<string, unknown>;
  if ('data' in v) {
    const data = v.data as Record<string, unknown>;
    if (Array.isArray(data.results)) {
      const first = data.results[0];
      return first === undefined
        ? `0 result(s)`
        : `${data.results.length} result(s); first: ${JSON.stringify(first).slice(0, 200)}`;
    }
    if (Array.isArray(data.pages)) {
      const first = data.pages[0];
      return first === undefined
        ? `0 page(s)`
        : `${data.pages.length} page(s); first: ${JSON.stringify(first).slice(0, 200)}`;
    }
    if (Array.isArray(data.urls)) {
      const first = data.urls[0];
      return first === undefined
        ? `0 url(s)`
        : `${data.urls.length} url(s); first: ${JSON.stringify(first).slice(0, 200)}`;
    }
    if (typeof data.answer === 'string') {
      return `answer: "${data.answer.slice(0, 240)}${data.answer.length > 240 ? '…' : ''}"`;
    }
  }
  return JSON.stringify(v).slice(0, 240);
}

const CELLS: Cell[] = [
  // ─── brave ────────────────────────────────────────────────────────────
  {
    provider: 'brave',
    verb: 'search',
    what: 'web search via /web/search',
    run: async (apiKey) => {
      const r = await braveAdapter.search!({ apiKey, query: 'weather today', limit: 3 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'brave',
    verb: 'answer',
    what: 'chained web/search + summarizer/search',
    run: async (apiKey) => {
      // Use a question Brave reliably tags as summarizable; not every query
      // produces a summarizer.key (Brave's discretion).
      const r = await braveAdapter.answer!({ apiKey, query: 'how many planets are in the solar system' });
      return { summary: brief(r) };
    },
  },

  // ─── exa ──────────────────────────────────────────────────────────────
  {
    provider: 'exa',
    verb: 'search',
    what: 'POST /search',
    run: async (apiKey) => {
      const r = await exaAdapter.search!({ apiKey, query: 'ai search apis', limit: 3 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'exa',
    verb: 'scrape',
    what: 'POST /contents',
    run: async (apiKey) => {
      const r = await exaAdapter.scrape!({ apiKey, urls: [SAFE_SCRAPE_URL] });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'exa',
    verb: 'answer',
    what: 'POST /answer',
    run: async (apiKey) => {
      const r = await exaAdapter.answer!({ apiKey, query: 'what is exa' });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'exa',
    verb: 'research',
    asyncSubmit: true,
    what: 'POST /research/v0/tasks (submit only)',
    run: async (apiKey) => {
      const r = await exaAdapter.research!({ apiKey, query: 'short summary of postgres', depth: 'basic' });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },
  {
    provider: 'exa',
    verb: 'findall',
    asyncSubmit: true,
    what: 'POST /websets/v0/websets (submit only)',
    run: async (apiKey) => {
      const r = await exaAdapter.findall!({
        apiKey,
        objective: '3 popular open-source databases',
        limit: 3,
      });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },

  // ─── firecrawl ────────────────────────────────────────────────────────
  {
    provider: 'firecrawl',
    verb: 'search',
    what: 'POST /v2/search',
    run: async (apiKey) => {
      const r = await firecrawlAdapter.search!({ apiKey, query: 'next.js docs', limit: 3 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'firecrawl',
    verb: 'scrape',
    what: 'POST /v2/scrape',
    run: async (apiKey) => {
      const r = await firecrawlAdapter.scrape!({ apiKey, urls: [SAFE_SCRAPE_URL] });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'firecrawl',
    verb: 'map',
    what: 'POST /v2/map',
    run: async (apiKey) => {
      const r = await firecrawlAdapter.map!({ apiKey, url: SAFE_MAP_URL, limit: 10 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'firecrawl',
    verb: 'crawl',
    asyncSubmit: true,
    what: 'POST /v2/crawl (submit only)',
    run: async (apiKey) => {
      const r = await firecrawlAdapter.crawlSubmit!({ apiKey, url: SAFE_CRAWL_URL, maxPages: 3 });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },
  {
    provider: 'firecrawl',
    verb: 'research',
    asyncSubmit: true,
    what: 'POST /v2/deep-research (submit only)',
    run: async (apiKey) => {
      const r = await firecrawlAdapter.research!({ apiKey, query: 'ai sdk basics', depth: 'basic' });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },

  // ─── parallel ─────────────────────────────────────────────────────────
  {
    provider: 'parallel',
    verb: 'search',
    what: 'POST /v1/search',
    run: async (apiKey) => {
      const r = await parallelAdapter.search!({ apiKey, query: 'postgres pricing', limit: 3 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'parallel',
    verb: 'scrape',
    what: 'POST /v1/extract',
    run: async (apiKey) => {
      const r = await parallelAdapter.scrape!({ apiKey, urls: [SAFE_SCRAPE_URL] });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'parallel',
    verb: 'research',
    asyncSubmit: true,
    what: 'POST /v1/tasks/runs (submit only, lite processor)',
    run: async (apiKey) => {
      const r = await parallelAdapter.research!({ apiKey, query: 'short summary of databases', depth: 'basic' });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },
  {
    provider: 'parallel',
    verb: 'findall',
    asyncSubmit: true,
    what: 'POST /v1beta/findall/runs (submit only, entity_type=cloud_provider)',
    run: async (apiKey) => {
      const r = await parallelAdapter.findall!({
        apiKey,
        objective: 'major US cloud providers',
        entityType: 'cloud_provider',
        limit: 5,
      });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },

  // ─── tavily ───────────────────────────────────────────────────────────
  {
    provider: 'tavily',
    verb: 'search',
    what: 'POST /search',
    run: async (apiKey) => {
      const r = await tavilyAdapter.search!({ apiKey, query: 'ai news', limit: 3 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'tavily',
    verb: 'scrape',
    what: 'POST /extract',
    run: async (apiKey) => {
      const r = await tavilyAdapter.scrape!({ apiKey, urls: [SAFE_SCRAPE_URL] });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'tavily',
    verb: 'answer',
    what: 'POST /search with include_answer:advanced',
    run: async (apiKey) => {
      const r = await tavilyAdapter.answer!({ apiKey, query: 'what is tavily' });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'tavily',
    verb: 'map',
    what: 'POST /map',
    run: async (apiKey) => {
      const r = await tavilyAdapter.map!({ apiKey, url: SAFE_MAP_URL, limit: 10 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'tavily',
    verb: 'crawl',
    what: 'POST /crawl (sync, server-capped at 150s)',
    run: async (apiKey) => {
      const r = await tavilyAdapter.crawl!({ apiKey, url: SAFE_CRAWL_URL, maxPages: 3 });
      return { summary: brief(r) };
    },
  },
  {
    provider: 'tavily',
    verb: 'research',
    asyncSubmit: true,
    what: 'POST /research (submit only, mini model)',
    run: async (apiKey) => {
      const r = await tavilyAdapter.research!({ apiKey, query: 'short summary', depth: 'basic' });
      return { summary: `submitted; taskId=${r.taskId}`, taskId: r.taskId };
    },
  },

  // ─── data providers (single live cell per provider) ───────────────────
  // Same input across all three (enrichPerson firstName+lastName+domain) so
  // we can compare normalized outputs side-by-side and validate normalizers
  // against real provider response shapes. Public-figure identifier — Tim
  // Cook at apple.com — to reliably exercise the 200-with-data path.
  {
    provider: 'pdl',
    verb: 'enrich.person',
    what: 'GET /v5/person/enrich?first_name=Tim&last_name=Cook&company=apple.com',
    run: async (apiKey) => {
      const r = await pdlAdapter.enrichPerson!({
        apiKey,
        identifiers: { firstName: 'Tim', lastName: 'Cook', company: 'apple.com' },
      });
      const p = r.data.person;
      const summary = p
        ? `match: ${p.fullName ?? '?'} · ${p.title ?? '?'} @ ${p.org?.name ?? p.org?.domain ?? '?'} · linkedin=${p.linkedin ?? '—'} · confidence=${p.confidence}`
        : 'no match (404)';
      return { summary };
    },
  },
  {
    provider: 'hunter',
    verb: 'enrich.person',
    what: 'GET /v2/email-finder?domain=apple.com&first_name=Tim&last_name=Cook',
    run: async (apiKey) => {
      const r = await hunterAdapter.enrichPerson!({
        apiKey,
        identifiers: { firstName: 'Tim', lastName: 'Cook', domain: 'apple.com' },
      });
      const p = r.data.person;
      const summary = p
        ? `match: ${p.fullName ?? '?'} · ${p.title ?? '?'} @ ${p.org?.name ?? p.org?.domain ?? '?'} · email=${p.email ?? '—'} · confidence=${p.confidence}`
        : 'no match';
      return { summary };
    },
  },
  {
    provider: 'apollo',
    verb: 'enrich.person',
    what: 'POST /api/v1/people/match { first_name, last_name, domain: apple.com }',
    run: async (apiKey) => {
      const r = await apolloAdapter.enrichPerson!({
        apiKey,
        identifiers: { firstName: 'Tim', lastName: 'Cook', domain: 'apple.com' },
      });
      const p = r.data.person;
      const summary = p
        ? `match: ${p.fullName ?? '?'} · ${p.title ?? '?'} @ ${p.org?.name ?? p.org?.domain ?? '?'} · linkedin=${p.linkedin ?? '—'} · seniority=${p.seniority ?? '—'}`
        : 'no match';
      return { summary };
    },
  },
  {
    provider: 'tomba',
    verb: 'enrich.person',
    what: 'GET /v1/email-finder?domain=apple.com&first_name=Tim&last_name=Cook',
    run: async (apiKey) => {
      const apiSecret = process.env.TOMBA_SECRET_KEY?.trim();
      if (!apiSecret) {
        throw new Error('TOMBA_SECRET_KEY missing — Tomba uses dual-key auth');
      }
      const r = await tombaAdapter.enrichPerson!({
        apiKey,
        apiSecret,
        identifiers: { firstName: 'Tim', lastName: 'Cook', domain: 'apple.com' },
      });
      const p = r.data.person;
      const summary = p
        ? `match: ${p.fullName ?? '?'} · ${p.title ?? '?'} @ ${p.org?.name ?? p.org?.domain ?? '?'} · email=${p.email ?? '—'} · confidence=${p.confidence}`
        : 'no match';
      return { summary };
    },
  },
  {
    provider: 'bouncer',
    verb: 'verify.email',
    what: 'GET /v1.1/email/verify?email=tcook@apple.com',
    run: async (apiKey) => {
      const r = await bouncerAdapter.verifyEmail!({ apiKey, email: 'tcook@apple.com' });
      const v = r.data;
      return {
        summary: `${v.email} · ${v.status} · deliverable=${v.deliverable} · score=${v.score ?? '—'}`,
      };
    },
  },
  {
    provider: 'datagma',
    verb: 'enrich.person',
    what: 'Datagma enrich-person for Tim Cook at apple.com',
    run: async (apiKey) => {
      const r = await datagmaAdapter.enrichPerson!({
        apiKey,
        identifiers: { firstName: 'Tim', lastName: 'Cook', domain: 'apple.com' },
      });
      const p = r.data.person;
      const summary = p
        ? `match: ${p.fullName ?? '?'} · ${p.title ?? '?'} @ ${p.org?.name ?? p.org?.domain ?? '?'} · phone=${p.phone ?? '—'} · email=${p.email ?? '—'}`
        : 'no match';
      return { summary };
    },
  },
  {
    provider: 'zerobounce',
    verb: 'verify.email',
    what: 'GET /v2/validate?email=tcook@apple.com',
    run: async (apiKey) => {
      const r = await zerobounceAdapter.verifyEmail!({ apiKey, email: 'tcook@apple.com' });
      const v = r.data;
      return {
        summary: `${v.email} · ${v.status} · deliverable=${v.deliverable} · webmail=${v.checks.webmail ?? '—'}`,
      };
    },
  },
  {
    provider: 'kickbox',
    verb: 'verify.email',
    what: 'GET /v2/verify?email=tcook@apple.com',
    run: async (apiKey) => {
      const r = await kickboxAdapter.verifyEmail!({ apiKey, email: 'tcook@apple.com' });
      const v = r.data;
      return {
        summary: `${v.email} · ${v.status} · deliverable=${v.deliverable} · sendex=${v.score ?? '—'}/100`,
      };
    },
  },
];

async function runCell(cell: Cell): Promise<CellResult> {
  const envVar = isDataProvider(cell.provider)
    ? DATA_PROVIDER_API_KEY_ENV_VARS[cell.provider]
    : WEB_PROVIDER_API_KEY_ENV_VARS[cell.provider];
  const key = process.env[envVar]?.trim();
  if (!key) {
    return { status: 'skipped', reason: `no ${envVar} in env` };
  }
  const start = Date.now();
  try {
    const out = await cell.run(key);
    return { status: 'ok', ms: Date.now() - start, summary: out.summary, taskId: out.taskId };
  } catch (error) {
    return {
      status: 'error',
      ms: Date.now() - start,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

function statusEmoji(s: CellResult['status']): string {
  return s === 'ok' ? '✅' : s === 'error' ? '❌' : '⏭';
}

function renderTable(rows: Array<{ cell: Cell; result: CellResult }>): string {
  const lines: string[] = [
    '| Provider | Verb | Status | Time | Notes |',
    '|---|---|---|---|---|',
  ];
  for (const { cell, result } of rows) {
    const time = result.status === 'skipped' ? '—' : `${result.ms} ms`;
    let notes = '';
    if (result.status === 'ok') {
      notes = result.summary.slice(0, 120) + (result.summary.length > 120 ? '…' : '');
    } else if (result.status === 'error') {
      notes = `**${result.error.slice(0, 120)}**`;
    } else {
      notes = result.reason;
    }
    notes = notes.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(
      `| ${cell.provider} | ${cell.verb}${cell.asyncSubmit ? ' *(submit)*' : ''} | ${statusEmoji(result.status)} ${result.status} | ${time} | ${notes} |`,
    );
  }
  return lines.join('\n');
}

function renderDetails(rows: Array<{ cell: Cell; result: CellResult }>): string {
  const sections: string[] = [];
  for (const { cell, result } of rows) {
    const heading = `### ${cell.provider} · ${cell.verb}${cell.asyncSubmit ? ' (async submit)' : ''}`;
    const body: string[] = [heading, '', `_${cell.what}_`, ''];
    if (result.status === 'ok') {
      body.push(`✅ **OK** in ${result.ms} ms`);
      body.push('');
      body.push('```');
      body.push(result.summary);
      body.push('```');
      if (result.taskId) {
        body.push('');
        body.push(`Follow up: \`marmot get ${result.taskId} --provider ${cell.provider}\``);
      }
    } else if (result.status === 'error') {
      body.push(`❌ **ERROR** in ${result.ms} ms`);
      body.push('');
      body.push('```');
      body.push(result.error);
      body.push('```');
    } else {
      body.push(`⏭ **Skipped** — ${result.reason}`);
    }
    sections.push(body.join('\n'));
  }
  return sections.join('\n\n---\n\n');
}

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`marmot smoke test — ${startedAt}\n`);

  const presentWebKeys = Object.entries(WEB_PROVIDER_API_KEY_ENV_VARS)
    .filter(([, env]) => Boolean(process.env[env]?.trim()))
    .map(([slug]) => slug as WebProviderSlug);
  const presentDataKeys = Object.entries(DATA_PROVIDER_API_KEY_ENV_VARS)
    .filter(([, env]) => Boolean(process.env[env]?.trim()))
    .map(([slug]) => slug as DataProviderSlug);
  const allKeyNames = [
    ...presentWebKeys.map((s) => WEB_PROVIDER_DISPLAY_NAMES[s]),
    ...presentDataKeys.map((s) => DATA_PROVIDER_DISPLAY_NAMES[s]),
  ];
  const presentKeys: Array<WebProviderSlug | DataProviderSlug> = [
    ...presentWebKeys,
    ...presentDataKeys,
  ];
  console.log(
    `keys present: ${allKeyNames.length === 0 ? 'NONE' : allKeyNames.join(', ')}\n`,
  );

  const rows: Array<{ cell: Cell; result: CellResult }> = [];
  let lastProvider: string | null = null;
  for (const cell of CELLS) {
    // Throttle between cells of the same provider so we don't trip free-tier
    // rate limits when running back-to-back. ~1s pause between same-provider
    // cells is enough for most providers' free tiers.
    if (lastProvider === cell.provider) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    lastProvider = cell.provider;
    process.stdout.write(`  ${cell.provider}/${cell.verb} … `);
    const result = await runCell(cell);
    rows.push({ cell, result });
    if (result.status === 'ok') {
      process.stdout.write(`✅ ${result.ms}ms${result.taskId ? ` (taskId=${result.taskId})` : ''}\n`);
    } else if (result.status === 'error') {
      process.stdout.write(`❌ ${result.ms}ms — ${result.error.slice(0, 80)}\n`);
    } else {
      process.stdout.write(`⏭ ${result.reason}\n`);
    }
  }

  const counts = rows.reduce(
    (acc, { result }) => {
      acc[result.status] += 1;
      return acc;
    },
    { ok: 0, error: 0, skipped: 0 } as Record<CellResult['status'], number>,
  );

  const finishedAt = new Date().toISOString();

  const md = [
    '# Marmot smoke-test log',
    '',
    `_Last run: ${finishedAt}_`,
    '',
    `**Summary**: ${counts.ok} ok · ${counts.error} error · ${counts.skipped} skipped · ${rows.length} total cells`,
    '',
    `**Keys present**: ${presentKeys.length === 0 ? '(none)' : presentKeys.join(', ')}`,
    '',
    '## Matrix',
    '',
    renderTable(rows),
    '',
    '## Per-cell details',
    '',
    renderDetails(rows),
    '',
    '---',
    '',
    'How to re-run: `pnpm smoke` from the repo root. Set the appropriate `*_API_KEY` env vars before running. Async cells (research/crawl/findall) submit only — to retrieve results, run `marmot get <taskId> --provider <slug>`.',
    '',
  ].join('\n');

  await mkdir(dirname(LOG_PATH), { recursive: true });
  await writeFile(LOG_PATH, md, 'utf8');

  console.log(`\nwrote ${LOG_PATH}`);
  console.log(`summary: ${counts.ok} ok · ${counts.error} error · ${counts.skipped} skipped`);

  // Exit code: non-zero if any cell errored (useful for CI). Skipped cells
  // are not failures.
  if (counts.error > 0) {
    process.exitCode = 1;
  }
}

void main();
