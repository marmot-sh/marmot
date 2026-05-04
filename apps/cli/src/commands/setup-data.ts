// Data verb defaults walkthrough — invoked from `marmot setup`.

import { cancel, isCancel, note, select } from '@clack/prompts';

import {
  DATA_PROVIDERS,
  DATA_PROVIDER_API_KEY_ENV_VARS,
  DATA_PROVIDER_DISPLAY_NAMES,
  DATA_TYPES,
  DATA_VERBS,
  type DataProviderSlug,
  type DataVerb,
  type MarmotConfig,
} from '@marmot-sh/core';

import { providersForCell } from '../providers/data-capabilities.js';

const SKIP_VALUE = '__skip__';

type ConfigDefaults = NonNullable<MarmotConfig['defaults']>;

const VERB_LABELS: Record<DataVerb, string> = {
  enrich: 'Enrich',
  lookup: 'Lookup',
  verify: 'Verify',
};

function configuredKeys(env: NodeJS.ProcessEnv): Set<DataProviderSlug> {
  const ready = new Set<DataProviderSlug>();
  for (const slug of DATA_PROVIDERS) {
    const v = env[DATA_PROVIDER_API_KEY_ENV_VARS[slug]]?.trim();
    if (v) ready.add(slug);
  }
  return ready;
}

/** Union of every provider that backs at least one (verb, type) cell. */
function eligibleProvidersForVerb(verb: DataVerb): DataProviderSlug[] {
  const set = new Set<DataProviderSlug>();
  for (const type of DATA_TYPES) {
    for (const p of providersForCell(verb, type)) set.add(p);
  }
  return [...set];
}

function summaryFor(verb: DataVerb, config: MarmotConfig): string {
  const v = (config.defaults as ConfigDefaults | undefined)?.[verb];
  if (v && 'provider' in v && v.provider) return v.provider;
  return '— (unset)';
}

function applyVerb(
  verb: DataVerb,
  provider: DataProviderSlug,
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

export async function walkDataDefaults(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<MarmotConfig | null> {
  const ready = configuredKeys(env);

  if (ready.size === 0) {
    note(
      'No data-provider API keys detected. Set at least one of: APOLLO_API_KEY, HUNTER_API_KEY, PDL_API_KEY.',
      'data defaults',
    );
    return 'unchanged' as unknown as MarmotConfig | null;
  }

  let working = config;
  for (const verb of DATA_VERBS) {
    const supported = eligibleProvidersForVerb(verb);
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
          label: `${DATA_PROVIDER_DISPLAY_NAMES[slug]} (${slug})`,
        })),
        { value: SKIP_VALUE, label: 'Skip — leave unchanged' },
      ],
    });

    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }
    if (choice === SKIP_VALUE) continue;

    working = applyVerb(verb, choice as DataProviderSlug, working);
  }
  return working;
}

export function formatDataDefaults(config: MarmotConfig): string {
  const lines: string[] = [];
  for (const verb of DATA_VERBS) {
    lines.push(`${VERB_LABELS[verb].padEnd(12)} ${summaryFor(verb, config)}`);
  }
  return lines.join('\n');
}
