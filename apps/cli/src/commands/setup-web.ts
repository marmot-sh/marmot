// Web/data verb defaults walkthrough — invoked from `marmot setup`.

import { cancel, isCancel, note, select } from '@clack/prompts';

import {
  WEB_PROVIDERS,
  WEB_PROVIDER_API_KEY_ENV_VARS,
  WEB_PROVIDER_DISPLAY_NAMES,
  WEB_VERBS,
  type MarmotConfig,
  type WebProviderSlug,
  type WebVerb,
} from '@marmot-sh/core';

import { providersForVerb } from '../providers/web-capabilities.js';

const SKIP_VALUE = '__skip__';

type ConfigDefaults = NonNullable<MarmotConfig['defaults']>;

const VERB_LABELS: Record<WebVerb, string> = {
  search: 'Search',
  scrape: 'Scrape',
  research: 'Research',
  answer: 'Answer',
  crawl: 'Crawl',
  map: 'Map',
  findall: 'Findall',
};

function configuredKeys(env: NodeJS.ProcessEnv): Set<WebProviderSlug> {
  const ready = new Set<WebProviderSlug>();
  for (const slug of WEB_PROVIDERS) {
    const v = env[WEB_PROVIDER_API_KEY_ENV_VARS[slug]]?.trim();
    if (v) ready.add(slug);
  }
  return ready;
}

function summaryFor(verb: WebVerb, config: MarmotConfig): string {
  const v = (config.defaults as ConfigDefaults | undefined)?.[verb];
  if (v && 'provider' in v && v.provider) return v.provider;
  return '— (unset)';
}

function applyVerb(
  verb: WebVerb,
  provider: WebProviderSlug,
  config: MarmotConfig,
): MarmotConfig {
  const defaults = (config.defaults ?? {}) as ConfigDefaults;
  return {
    version: 1,
    defaults: {
      ...defaults,
      [verb]: { provider },
    },
  };
}

export async function walkWebDefaults(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<MarmotConfig | null> {
  const ready = configuredKeys(env);

  if (ready.size === 0) {
    note(
      'No web/data API keys detected. Set at least one of: BRAVE_API_KEY, EXA_API_KEY, FIRECRAWL_API_KEY, PARALLEL_API_KEY, TAVILY_API_KEY.',
      'web defaults',
    );
    return 'unchanged' as unknown as MarmotConfig | null;
  }

  let working = config;
  for (const verb of WEB_VERBS) {
    const supported = providersForVerb(verb);
    const eligible = supported.filter((s) => ready.has(s));

    if (eligible.length === 0) {
      // No API keys for any provider that supports this verb. Skip silently.
      continue;
    }

    const choice = await select({
      message: `Default provider for ${VERB_LABELS[verb]} (current: ${summaryFor(verb, working)})`,
      options: [
        ...eligible.map((slug) => ({
          value: slug,
          label: `${WEB_PROVIDER_DISPLAY_NAMES[slug]} (${slug})`,
        })),
        { value: SKIP_VALUE, label: 'Skip — leave unchanged' },
      ],
    });

    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }
    if (choice === SKIP_VALUE) continue;

    working = applyVerb(verb, choice as WebProviderSlug, working);
  }
  return working;
}

export function formatWebDefaults(config: MarmotConfig): string {
  const lines: string[] = [];
  for (const verb of WEB_VERBS) {
    lines.push(`${VERB_LABELS[verb].padEnd(12)} ${summaryFor(verb, config)}`);
  }
  return lines.join('\n');
}
