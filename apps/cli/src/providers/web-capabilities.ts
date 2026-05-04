// Cross-provider capability matrix for the web/data verbs. Source of truth for
// `marmot <verb> --provider X` validation and for `marmot providers list --verb`.
//
// last verified per provider:
//   brave       2026-05-02 — _docs/providers/brave.md
//   exa         2026-05-02 — _docs/providers/exa.md
//   firecrawl   2026-05-02 — _docs/providers/firecrawl.md
//   parallel    2026-05-02 — _docs/providers/parallel.md
//   tavily      2026-05-02 — _docs/providers/tavily.md

import {
  WEB_PROVIDERS,
  WEB_VERBS,
  type WebProviderSlug,
  type WebVerb,
} from '@marmot-sh/core';

export const WEB_CAPABILITY_MATRIX: Record<WebVerb, readonly WebProviderSlug[]> = {
  search: ['brave', 'exa', 'firecrawl', 'parallel', 'tavily'],
  scrape: ['exa', 'firecrawl', 'parallel', 'tavily'],
  research: ['exa', 'firecrawl', 'parallel', 'tavily'],
  answer: ['brave', 'exa', 'tavily'],
  crawl: ['firecrawl', 'tavily'],
  map: ['firecrawl', 'tavily'],
  findall: ['exa', 'parallel'],
};

export function providersForVerb(verb: WebVerb): readonly WebProviderSlug[] {
  return WEB_CAPABILITY_MATRIX[verb];
}

export function verbsForProvider(provider: WebProviderSlug): WebVerb[] {
  return WEB_VERBS.filter((v) => WEB_CAPABILITY_MATRIX[v].includes(provider));
}

export function verbSupportsProvider(verb: WebVerb, provider: WebProviderSlug): boolean {
  return WEB_CAPABILITY_MATRIX[verb].includes(provider);
}

export function isWebProvider(slug: string): slug is WebProviderSlug {
  return (WEB_PROVIDERS as readonly string[]).includes(slug);
}

export function isWebVerb(name: string): name is WebVerb {
  return (WEB_VERBS as readonly string[]).includes(name);
}
