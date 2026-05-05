// Per-provider settings walkthrough: enable/disable, response cache, custom
// env var names. Invoked from `marmot setup`. Detection-first — only walks
// providers with a credential available (or already configured in config).

import { cancel, confirm, isCancel, select, text } from '@clack/prompts';

import {
  DATA_PROVIDERS,
  DATA_PROVIDER_DISPLAY_NAMES,
  DEFAULT_CACHE_TTL_DAYS,
  PROVIDERS,
  PROVIDER_DISPLAY_NAMES,
  WEB_PROVIDERS,
  WEB_PROVIDER_DISPLAY_NAMES,
  defaultPrimaryEnvVar,
  defaultSecondaryEnvVar,
  resolveProviderAuth,
  warnText,
  type AnyProviderSlug,
  type MarmotConfig,
  type ProviderSettings,
} from '@marmot-sh/core';

import { formatTable } from '../lib/table.js';

const SKIP_VALUE = '__skip__';

type Category = 'ai' | 'web' | 'data';

type ProviderRow = {
  slug: AnyProviderSlug;
  name: string;
  category: Category;
  hasCredential: boolean;
  primaryEnvVar: string | null;
  secondaryEnvVar: string | null;
};

type ConfigDefaults = NonNullable<MarmotConfig['providers']>;

function categoryOf(slug: AnyProviderSlug): Category {
  if ((PROVIDERS as readonly string[]).includes(slug)) return 'ai';
  if ((WEB_PROVIDERS as readonly string[]).includes(slug)) return 'web';
  return 'data';
}

function displayName(slug: AnyProviderSlug): string {
  if ((PROVIDERS as readonly string[]).includes(slug)) {
    return PROVIDER_DISPLAY_NAMES[slug as keyof typeof PROVIDER_DISPLAY_NAMES];
  }
  if ((WEB_PROVIDERS as readonly string[]).includes(slug)) {
    return WEB_PROVIDER_DISPLAY_NAMES[slug as keyof typeof WEB_PROVIDER_DISPLAY_NAMES];
  }
  return DATA_PROVIDER_DISPLAY_NAMES[slug as keyof typeof DATA_PROVIDER_DISPLAY_NAMES];
}

function allSlugs(): AnyProviderSlug[] {
  return [...PROVIDERS, ...WEB_PROVIDERS, ...DATA_PROVIDERS];
}

function detectRows(
  config: MarmotConfig | null,
  env: NodeJS.ProcessEnv,
): ProviderRow[] {
  const rows: ProviderRow[] = [];
  for (const slug of allSlugs()) {
    const primary = defaultPrimaryEnvVar(slug);
    const secondary = defaultSecondaryEnvVar(slug);
    const { apiKey } = resolveProviderAuth(slug, config, env);
    rows.push({
      slug,
      name: displayName(slug),
      category: categoryOf(slug),
      hasCredential: Boolean(apiKey) || slug === 'ollama',
      primaryEnvVar: primary,
      secondaryEnvVar: secondary,
    });
  }
  return rows;
}

function settingsFor(
  config: MarmotConfig,
  slug: AnyProviderSlug,
): ProviderSettings | undefined {
  return (config.providers as ConfigDefaults | undefined)?.[slug];
}

function applySettings(
  config: MarmotConfig,
  slug: AnyProviderSlug,
  settings: ProviderSettings,
): MarmotConfig {
  const providers = (config.providers ?? {}) as ConfigDefaults;
  return {
    ...config,
    version: 1,
    providers: { ...providers, [slug]: settings },
  };
}

function statusGlyph(row: ProviderRow, settings: ProviderSettings | undefined): string {
  if (!row.hasCredential) return '·';
  if (settings?.enabled === false) return '⏸';
  return '✓';
}

function statusLabel(row: ProviderRow, settings: ProviderSettings | undefined): string {
  if (!row.hasCredential) return 'no key';
  if (settings?.enabled === false) return 'paused';
  if (settings?.cache?.enabled) {
    return `enabled · cache ${settings.cache.ttlDays ?? DEFAULT_CACHE_TTL_DAYS}d`;
  }
  return 'enabled';
}

export function formatProviderStatusReport(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): string {
  const rows = detectRows(config, env);
  const sections: string[] = [];
  for (const cat of ['ai', 'web', 'data'] as const) {
    const subset = rows.filter((r) => r.category === cat);
    if (subset.length === 0) continue;
    const tableRows: string[][] = subset.map((row) => {
      const settings = settingsFor(config, row.slug);
      return [
        `${statusGlyph(row, settings)} ${row.name}`,
        statusLabel(row, settings),
      ];
    });
    sections.push(`[${cat}]\n${formatTable(tableRows, { gap: 2 })}`);
  }
  return sections.join('\n');
}

async function promptEnable(
  row: ProviderRow,
  current: ProviderSettings | undefined,
): Promise<boolean | null> {
  const initiallyEnabled = current?.enabled !== false;
  const choice = await confirm({
    message: `${row.name} (key in ${row.primaryEnvVar ?? 'no env var'}) — keep enabled?`,
    initialValue: initiallyEnabled,
  });
  if (isCancel(choice)) return null;
  return choice;
}

type CacheChoice = { enabled: false } | { enabled: true; ttlDays: number };

/** Per-provider response-cache step. AI providers don't cache, so this
 *  short-circuits for them. Web/context providers get a confirm + TTL
 *  prompt; the user can disable, re-enable, or tweak TTL in one pass. */
async function promptCache(
  row: ProviderRow,
  current: ProviderSettings | undefined,
): Promise<CacheChoice | null | 'unchanged'> {
  if (row.category === 'ai') return 'unchanged';

  const currentlyEnabled = current?.cache?.enabled === true;
  const currentTtl = current?.cache?.ttlDays ?? DEFAULT_CACHE_TTL_DAYS;

  const enable = await confirm({
    message: `${row.name} — enable response cache?`,
    initialValue: currentlyEnabled,
  });
  if (isCancel(enable)) return null;
  if (!enable) return { enabled: false };

  const ttlInput = await text({
    message: `${row.name} — cache TTL (days)`,
    placeholder: String(DEFAULT_CACHE_TTL_DAYS),
    initialValue: String(currentTtl),
    validate: (value) => {
      const trimmed = (value ?? '').trim();
      if (trimmed === '') return 'Enter a positive integer (e.g. 30).';
      const n = Number(trimmed);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return 'TTL must be a whole number of days.';
      }
      if (n < 1) return 'TTL must be at least 1 day.';
      if (n > 365) return 'TTL must be 365 days or fewer.';
      return undefined;
    },
  });
  if (isCancel(ttlInput)) return null;
  return { enabled: true, ttlDays: Number.parseInt(String(ttlInput).trim(), 10) };
}

async function promptCustomEnvVars(
  row: ProviderRow,
  current: ProviderSettings | undefined,
): Promise<{ apiKeyEnvVar?: string; apiSecretEnvVar?: string } | null | 'unchanged'> {
  const change = await confirm({
    message: `${row.name} — customize env var names?`,
    initialValue: Boolean(current?.apiKeyEnvVar || current?.apiSecretEnvVar),
  });
  if (isCancel(change)) return null;
  if (!change) return 'unchanged';

  const result: { apiKeyEnvVar?: string; apiSecretEnvVar?: string } = {};

  if (row.primaryEnvVar) {
    const primary = await text({
      message: `${row.name} — env var for the API key`,
      placeholder: row.primaryEnvVar,
      initialValue: current?.apiKeyEnvVar ?? '',
    });
    if (isCancel(primary)) return null;
    const trimmed = String(primary).trim();
    if (trimmed && trimmed !== row.primaryEnvVar) {
      result.apiKeyEnvVar = trimmed;
    }
  }

  if (row.secondaryEnvVar) {
    const secondary = await text({
      message: `${row.name} — env var for the secondary credential`,
      placeholder: row.secondaryEnvVar,
      initialValue: current?.apiSecretEnvVar ?? '',
    });
    if (isCancel(secondary)) return null;
    const trimmed = String(secondary).trim();
    if (trimmed && trimmed !== row.secondaryEnvVar) {
      result.apiSecretEnvVar = trimmed;
    }
  }

  return result;
}

const CATEGORY_AI = '__cat_ai__';
const CATEGORY_CONTEXT = '__cat_context__';
const PICKER_BACK = '__picker_back__';

function buildProviderOption(
  row: ProviderRow,
  config: MarmotConfig,
): { value: string; label: string; hint?: string } {
  const settings = settingsFor(config, row.slug);
  const baseLabel = `${statusGlyph(row, settings)} ${row.name}`;
  if (!row.hasCredential) {
    // No-key marker is rendered into the label (not the hint) so it's
    // visible across the whole list, not just on the focused row -- the
    // user needs to see at a glance which providers still need an env
    // var set.
    return {
      value: row.slug,
      label: `${baseLabel}  ${warnText('(no key)')}`,
    };
  }
  return {
    value: row.slug,
    label: baseLabel,
    hint: statusLabel(row, settings),
  };
}

function summarizeCategory(rows: readonly ProviderRow[]): string {
  const total = rows.length;
  const withKey = rows.filter((r) => r.hasCredential).length;
  if (total === 0) return 'none';
  if (withKey === total) return `${total} provider${total === 1 ? '' : 's'}`;
  return `${withKey} of ${total} with key`;
}

export async function walkProviderSettings(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<MarmotConfig | null> {
  const rows = detectRows(config, env);
  const aiRows = rows.filter((r) => r.category === 'ai');
  const contextRows = rows.filter((r) => r.category !== 'ai');

  // Two-step drill: pick a category, then pick a provider in that category.
  // This sidesteps the clack constraint that every `select` option renders
  // a radio glyph -- a single combined list with header rows looked
  // selectable, which was misleading. From the inner picker, "Back" returns
  // to the category picker so the user can switch groups without leaving
  // setup.
  let slug: AnyProviderSlug;
  for (;;) {
    const category = await select({
      message: 'Which kind of provider?',
      options: [
        { value: CATEGORY_AI, label: 'AI providers', hint: summarizeCategory(aiRows) },
        { value: CATEGORY_CONTEXT, label: 'Context providers', hint: summarizeCategory(contextRows) },
        { value: SKIP_VALUE, label: 'Back to setup' },
      ],
    });
    if (isCancel(category)) {
      cancel('Setup canceled.');
      return null;
    }
    if (category === SKIP_VALUE) return 'unchanged' as unknown as MarmotConfig;

    const subset = category === CATEGORY_AI ? aiRows : contextRows;
    const subsetLabel = category === CATEGORY_AI ? 'AI' : 'context';

    const choice = await select({
      message: `Which ${subsetLabel} provider?`,
      options: [
        ...subset.map((r) => buildProviderOption(r, config)),
        { value: PICKER_BACK, label: 'Back' },
      ],
    });
    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }
    if (choice === PICKER_BACK) continue;
    slug = choice as AnyProviderSlug;
    break;
  }

  const row = rows.find((r) => r.slug === slug)!;
  const current = settingsFor(config, slug);

  // Per-provider walk: enable → custom env vars → response cache (web/
  // context only). Bulk cache operations (clear all, reset all, disable
  // all) live in the top-level "Global cache" menu.
  //
  // For credential-less providers, skip the enable toggle -- it's not
  // meaningful before there's a key. We still walk env-var customization
  // (the whole reason these rows are reachable) and cache configuration
  // (so settings are ready when a key arrives).
  const enabled = row.hasCredential
    ? await promptEnable(row, current)
    : current?.enabled !== false;
  if (enabled === null) return null;

  const advanced = await promptCustomEnvVars(row, current);
  if (advanced === null) return null;

  const cache = await promptCache(row, current);
  if (cache === null) return null;

  // Drop fields that resolve to defaults so the on-disk config stays tidy.
  const next: ProviderSettings = {};
  if (enabled === false) next.enabled = false;

  if (cache !== 'unchanged') {
    if (cache.enabled) {
      next.cache = { enabled: true, ttlDays: cache.ttlDays };
    } else {
      next.cache = { enabled: false };
    }
  } else if (current?.cache) {
    next.cache = current.cache;
  }

  if (advanced !== 'unchanged') {
    if (advanced.apiKeyEnvVar) next.apiKeyEnvVar = advanced.apiKeyEnvVar;
    if (advanced.apiSecretEnvVar) next.apiSecretEnvVar = advanced.apiSecretEnvVar;
  } else if (current?.apiKeyEnvVar || current?.apiSecretEnvVar) {
    if (current.apiKeyEnvVar) next.apiKeyEnvVar = current.apiKeyEnvVar;
    if (current.apiSecretEnvVar) next.apiSecretEnvVar = current.apiSecretEnvVar;
  }

  // If everything resolved to defaults, drop the entry entirely.
  if (
    next.enabled === undefined
    && next.cache === undefined
    && next.apiKeyEnvVar === undefined
    && next.apiSecretEnvVar === undefined
  ) {
    if (!current) return 'unchanged' as unknown as MarmotConfig;
    const providers = { ...(config.providers ?? {}) } as ConfigDefaults;
    delete providers[slug];
    return { ...config, version: 1, providers };
  }

  return applySettings(config, slug, next);
}
