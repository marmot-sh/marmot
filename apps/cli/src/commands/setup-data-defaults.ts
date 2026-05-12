// Combined data-defaults walkthrough — invoked from `marmot setup`.
//
// Replaces the older sequential walks (one prompt per verb in succession)
// with a list-then-edit pattern: show all 10 verbs and their current
// defaults, let the user pick one, edit it, then return to the list. Mirrors
// how the AI defaults sub-walk behaves.

import { cancel, isCancel, note, select } from '@clack/prompts';

import {
  DATA_PROVIDERS,
  DATA_PROVIDER_API_KEY_ENV_VARS,
  DATA_PROVIDER_DISPLAY_NAMES,
  DATA_TYPES,
  DATA_VERBS,
  WEB_PROVIDERS,
  WEB_PROVIDER_API_KEY_ENV_VARS,
  WEB_PROVIDER_DISPLAY_NAMES,
  WEB_VERBS,
  type DataProviderSlug,
  type DataVerb,
  type MarmotConfig,
  type WebProviderSlug,
  type WebVerb,
} from '@marmot-sh/core';

import { warnText, writeMarmotConfig } from '@marmot-sh/core';

import { providersForCell } from '../providers/data-capabilities.js';
import { providersForVerb as webProvidersForVerb } from '../providers/web-capabilities.js';
import { formatTable } from '../lib/table.js';
import { EXIT_SETUP, EXIT_SETUP_OPTION } from '../lib/setup-exit.js';

const SKIP = '__skip__';
const BACK = '__back__';

type ConfigDefaults = NonNullable<MarmotConfig['defaults']>;

const WEB_VERB_LABEL: Record<WebVerb, string> = {
  search: 'Search',
  scrape: 'Scrape',
  research: 'Research',
  answer: 'Answer',
  crawl: 'Crawl',
  map: 'Map',
  findall: 'Findall',
};

const DATA_VERB_LABEL: Record<DataVerb, string> = {
  enrich: 'Enrich',
  lookup: 'Lookup',
  verify: 'Verify',
};

function configuredWebKeys(env: NodeJS.ProcessEnv): Set<WebProviderSlug> {
  const ready = new Set<WebProviderSlug>();
  for (const slug of WEB_PROVIDERS) {
    const v = env[WEB_PROVIDER_API_KEY_ENV_VARS[slug]]?.trim();
    if (v) ready.add(slug);
  }
  return ready;
}

function configuredDataKeys(env: NodeJS.ProcessEnv): Set<DataProviderSlug> {
  const ready = new Set<DataProviderSlug>();
  for (const slug of DATA_PROVIDERS) {
    const v = env[DATA_PROVIDER_API_KEY_ENV_VARS[slug]]?.trim();
    if (v) ready.add(slug);
  }
  return ready;
}

function eligibleDataProvidersForVerb(verb: DataVerb): DataProviderSlug[] {
  const set = new Set<DataProviderSlug>();
  for (const type of DATA_TYPES) {
    for (const p of providersForCell(verb, type)) set.add(p);
  }
  return [...set];
}

function summaryFor(
  verb: WebVerb | DataVerb,
  config: MarmotConfig,
): string {
  const v = (config.defaults as Record<string, { provider?: string }> | undefined)?.[verb];
  return v?.provider ?? '—';
}

/** Inline-display variant: returns the provider, or yellow "no default" when unset. */
function currentFor(verb: WebVerb | DataVerb, config: MarmotConfig): string {
  const v = (config.defaults as Record<string, { provider?: string }> | undefined)?.[verb];
  return v?.provider ?? warnText('no default');
}

function applyVerb(
  verb: WebVerb | DataVerb,
  provider: string,
  config: MarmotConfig,
): MarmotConfig {
  const defaults = (config.defaults ?? {}) as ConfigDefaults;
  return {
    ...config,
    version: 1,
    defaults: {
      ...defaults,
      [verb]: { provider },
    },
  };
}

function unsetVerb(
  verb: WebVerb | DataVerb,
  config: MarmotConfig,
): MarmotConfig {
  const defaults = { ...((config.defaults ?? {}) as Record<string, unknown>) };
  delete defaults[verb];
  return { ...config, version: 1, defaults: defaults as ConfigDefaults };
}

export async function walkAllDataDefaults(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<MarmotConfig | null | 'unchanged' | typeof EXIT_SETUP> {
  let working = config;
  const webReady = configuredWebKeys(env);
  const dataReady = configuredDataKeys(env);

  if (webReady.size === 0 && dataReady.size === 0) {
    note(
      'No context-provider API keys detected. Set at least one *_API_KEY env var (e.g. TAVILY_API_KEY, APOLLO_API_KEY) and re-run.',
      'context defaults',
    );
    return 'unchanged';
  }

  for (;;) {
    // Build the verb list. We bake the current default into the label so
    // every row's value is visible at once (clack only renders the focused
    // option's hint, which would hide the rest).
    type Item = { value: string; label: string; current: string };
    const items: Item[] = [];

    for (const verb of WEB_VERBS) {
      const eligible = webProvidersForVerb(verb).filter((s) => webReady.has(s));
      const current = currentFor(verb, working);
      items.push({
        value: `web:${verb}`,
        label: WEB_VERB_LABEL[verb],
        current: eligible.length === 0 ? `${current} · no key set` : current,
      });
    }
    for (const verb of DATA_VERBS) {
      const eligible = eligibleDataProvidersForVerb(verb).filter((s) => dataReady.has(s));
      const current = currentFor(verb, working);
      items.push({
        value: `data:${verb}`,
        label: DATA_VERB_LABEL[verb],
        current: eligible.length === 0 ? `${current} · no key set` : current,
      });
    }

    const maxLabel = Math.max(...items.map((i) => i.label.length));
    const options: Array<{ value: string; label: string }> = items.map((i) => ({
      value: i.value,
      label: `${i.label.padEnd(maxLabel + 4)}${i.current}`,
    }));
    options.push({ value: BACK, label: 'Back to setup' });
    options.push(EXIT_SETUP_OPTION);

    const choice = await select({
      message: 'Context defaults — pick a verb to change',
      options,
    });
    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }
    if (choice === EXIT_SETUP) {
      // Persist any in-progress changes here so the hub doesn't need a
      // separate "exit-with-pending-changes" code path -- it just sees
      // the EXIT_SETUP sentinel and prints the "Saved to ..." message.
      if (working !== config) {
        await writeMarmotConfig(working, env);
      }
      return EXIT_SETUP;
    }
    if (choice === BACK) {
      return working === config ? 'unchanged' : working;
    }

    if (typeof choice === 'string' && choice.startsWith('web:')) {
      const verb = choice.slice(4) as WebVerb;
      const updated = await editWebVerb(verb, working, env, webReady);
      if (updated === null) return null;
      if (updated === EXIT_SETUP) {
        if (working !== config) await writeMarmotConfig(working, env);
        return EXIT_SETUP;
      }
      if (updated !== 'unchanged') working = updated;
      continue;
    }
    if (typeof choice === 'string' && choice.startsWith('data:')) {
      const verb = choice.slice(5) as DataVerb;
      const updated = await editDataVerb(verb, working, env, dataReady);
      if (updated === null) return null;
      if (updated === EXIT_SETUP) {
        if (working !== config) await writeMarmotConfig(working, env);
        return EXIT_SETUP;
      }
      if (updated !== 'unchanged') working = updated;
      continue;
    }
  }
}

async function editWebVerb(
  verb: WebVerb,
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
  webReady: Set<WebProviderSlug>,
): Promise<MarmotConfig | null | 'unchanged' | typeof EXIT_SETUP> {
  const supported = webProvidersForVerb(verb);
  const eligible = supported.filter((s) => webReady.has(s));

  if (eligible.length === 0) {
    const envVars = supported.map((s) => WEB_PROVIDER_API_KEY_ENV_VARS[s]).join(', ');
    note(
      `No keys for any provider that supports "${verb}".\nSet one of: ${envVars}`,
      WEB_VERB_LABEL[verb],
    );
    return 'unchanged';
  }

  const current = summaryFor(verb, config);
  const initialValue = (eligible as readonly string[]).includes(current) ? current : undefined;
  const choice = await select({
    message: `${WEB_VERB_LABEL[verb]} — pick provider`,
    initialValue,
    options: [
      ...eligible.map((slug) => ({
        value: slug as string,
        label: `${WEB_PROVIDER_DISPLAY_NAMES[slug]} (${slug})`,
        hint: slug === current ? warnText('current') : undefined,
      })),
      { value: '__unset__', label: 'Clear default — leave unset' },
      { value: SKIP, label: 'Cancel — no change' },
      EXIT_SETUP_OPTION,
    ],
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  if (choice === SKIP) return 'unchanged';
  if (choice === EXIT_SETUP) return EXIT_SETUP;
  if (choice === '__unset__') return unsetVerb(verb, config);
  return applyVerb(verb, choice as string, config);
}

async function editDataVerb(
  verb: DataVerb,
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
  dataReady: Set<DataProviderSlug>,
): Promise<MarmotConfig | null | 'unchanged' | typeof EXIT_SETUP> {
  const supported = eligibleDataProvidersForVerb(verb);
  const eligible = supported.filter((s) => dataReady.has(s));

  if (eligible.length === 0) {
    const envVars = supported.map((s) => DATA_PROVIDER_API_KEY_ENV_VARS[s]).join(', ');
    note(
      `No keys for any provider that supports "${verb}".\nSet one of: ${envVars}`,
      DATA_VERB_LABEL[verb],
    );
    return 'unchanged';
  }

  const current = summaryFor(verb, config);
  const initialValue = (eligible as readonly string[]).includes(current) ? current : undefined;
  const choice = await select({
    message: `${DATA_VERB_LABEL[verb]} — pick provider`,
    initialValue,
    options: [
      ...eligible.map((slug) => ({
        value: slug as string,
        label: `${DATA_PROVIDER_DISPLAY_NAMES[slug]} (${slug})`,
        hint: slug === current ? warnText('current') : undefined,
      })),
      { value: '__unset__', label: 'Clear default — leave unset' },
      { value: SKIP, label: 'Cancel — no change' },
      EXIT_SETUP_OPTION,
    ],
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  if (choice === SKIP) return 'unchanged';
  if (choice === EXIT_SETUP) return EXIT_SETUP;
  if (choice === '__unset__') return unsetVerb(verb, config);
  return applyVerb(verb, choice as string, config);
}

/** Reserved for future "what's currently set?" pre-walk reports. Currently
 *  unused — the dashboard at the top of `marmot setup` already shows the
 *  same data, so we don't double-render here. */
export function formatAllDataDefaults(config: MarmotConfig): string {
  const rows: string[][] = [];
  for (const verb of WEB_VERBS) {
    rows.push([WEB_VERB_LABEL[verb], summaryFor(verb, config)]);
  }
  for (const verb of DATA_VERBS) {
    rows.push([DATA_VERB_LABEL[verb], summaryFor(verb, config)]);
  }
  return formatTable(rows, { gap: 4 });
}
