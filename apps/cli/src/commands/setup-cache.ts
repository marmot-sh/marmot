// Response-cache walkthrough — invoked from `marmot setup`.
//
// List-of-providers menu pattern:
//   - Top menu shows every cacheable provider, alphabetized, with the
//     current cache state inline (off / on · TTL · entries · size).
//   - Picking a provider drills into a per-provider menu (toggle, set TTL,
//     clear).
//   - Three bulk shortcuts at the bottom: clear all (with confirmation
//     showing total data), reset all settings (enable+30d), disable all.

import { cancel, confirm, isCancel, note, select, spinner, text } from '@clack/prompts';

import {
  DATA_PROVIDERS,
  DATA_PROVIDER_DISPLAY_NAMES,
  DEFAULT_CACHE_TTL_DAYS,
  WEB_PROVIDERS,
  WEB_PROVIDER_DISPLAY_NAMES,
  clearAllCache,
  clearProviderCache,
  statsForProvider,
  type AnyProviderSlug,
  type CacheStats,
  type MarmotConfig,
  type ProviderSettings,
} from '@marmot-sh/core';

const SHORTCUT_CLEAR_ALL = '__clear_all__';
const SHORTCUT_RESET_ALL = '__reset_all__';
const SHORTCUT_DISABLE_ALL = '__disable_all__';
const ACTION_BACK = '__back__';
const ACTION_TOGGLE = '__toggle__';
const ACTION_TTL = '__ttl__';
const ACTION_CLEAR = '__clear__';

type Slug = AnyProviderSlug;

function cacheableSlugs(): Slug[] {
  return [...WEB_PROVIDERS, ...DATA_PROVIDERS] as Slug[];
}

function displayName(slug: Slug): string {
  if ((WEB_PROVIDERS as readonly string[]).includes(slug)) {
    return WEB_PROVIDER_DISPLAY_NAMES[slug as keyof typeof WEB_PROVIDER_DISPLAY_NAMES];
  }
  return DATA_PROVIDER_DISPLAY_NAMES[slug as keyof typeof DATA_PROVIDER_DISPLAY_NAMES];
}

function settingsFor(config: MarmotConfig, slug: Slug): ProviderSettings | undefined {
  return (config.providers as Record<string, ProviderSettings> | undefined)?.[slug];
}

function applySettings(
  config: MarmotConfig,
  slug: Slug,
  settings: ProviderSettings,
): MarmotConfig {
  const providers = (config.providers ?? {}) as Record<string, ProviderSettings>;
  return {
    ...config,
    version: 1,
    providers: { ...providers, [slug]: settings },
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes / 1024;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

/** Inline state string for a provider: `off` or `on · 30d · 2 entries · 86 KB`. */
function stateFor(
  config: MarmotConfig,
  slug: Slug,
  stats: CacheStats,
): string {
  const settings = settingsFor(config, slug);
  if (!settings?.cache?.enabled) return 'off';
  const ttl = settings.cache.ttlDays ?? DEFAULT_CACHE_TTL_DAYS;
  const entries = stats.entries === 1 ? '1 entry' : `${stats.entries} entries`;
  return `on · ${ttl}d · ${entries} · ${formatBytes(stats.bytes)}`;
}

async function readAllStats(env: NodeJS.ProcessEnv): Promise<Map<Slug, CacheStats>> {
  const map = new Map<Slug, CacheStats>();
  for (const slug of cacheableSlugs()) {
    try {
      map.set(slug, await statsForProvider(slug, env));
    } catch {
      map.set(slug, { provider: slug, entries: 0, bytes: 0 });
    }
  }
  return map;
}

export async function walkResponseCache(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<MarmotConfig | null> {
  let working = config;

  for (;;) {
    const statsSpin = spinner();
    statsSpin.start('Reading cache state');
    const stats = await readAllStats(env);
    statsSpin.stop('Cache state read');

    // Sort providers alphabetically by display name.
    const slugs = [...cacheableSlugs()].sort((a, b) =>
      displayName(a).localeCompare(displayName(b)),
    );
    const items = slugs.map((slug) => ({
      slug,
      label: displayName(slug),
      state: stateFor(working, slug, stats.get(slug)!),
    }));
    const maxLabel = Math.max(...items.map((i) => i.label.length));

    const choice = await select({
      message: 'Response cache — pick a provider',
      options: [
        ...items.map((i) => ({
          value: `slug:${i.slug}`,
          label: `${i.label.padEnd(maxLabel + 4)}${i.state}`,
        })),
        { value: SHORTCUT_CLEAR_ALL, label: 'Clear cache for all providers' },
        { value: SHORTCUT_RESET_ALL, label: 'Reset all cache settings (enable, 30-day TTL)' },
        { value: SHORTCUT_DISABLE_ALL, label: 'Disable caching for all providers' },
        { value: ACTION_BACK, label: 'Back to setup hub' },
      ],
    });
    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }

    if (choice === ACTION_BACK) return working;

    if (choice === SHORTCUT_CLEAR_ALL) {
      const totalEntries = [...stats.values()].reduce((s, x) => s + x.entries, 0);
      const totalBytes = [...stats.values()].reduce((s, x) => s + x.bytes, 0);
      if (totalEntries === 0) {
        note('No cache entries on disk. Nothing to clear.', 'response cache');
        continue;
      }
      const confirmed = await confirm({
        message: `Delete ${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'} (${formatBytes(totalBytes)}) across all providers?`,
        initialValue: false,
      });
      if (isCancel(confirmed) || !confirmed) continue;
      const removed = await clearAllCache(env);
      note(`Removed ${removed} ${removed === 1 ? 'entry' : 'entries'}.`, 'response cache');
      continue;
    }

    if (choice === SHORTCUT_RESET_ALL) {
      working = resetAllCacheSettings(working);
      note(
        'All providers set to: cache enabled, 30-day TTL. (Existing cache entries on disk are untouched.)',
        'response cache',
      );
      continue;
    }

    if (choice === SHORTCUT_DISABLE_ALL) {
      working = disableAllCacheSettings(working);
      note('All providers set to: cache disabled.', 'response cache');
      continue;
    }

    if (typeof choice === 'string' && choice.startsWith('slug:')) {
      const slug = choice.slice(5) as Slug;
      const updated = await walkPerProvider(slug, working, env, stats.get(slug)!);
      if (updated === null) return null;
      if (updated !== 'unchanged') working = updated;
      continue;
    }
  }
}

/** Per-provider menu: toggle / set TTL / clear / back. */
async function walkPerProvider(
  slug: Slug,
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
  stats: CacheStats,
): Promise<MarmotConfig | null | 'unchanged'> {
  let working = config;

  for (;;) {
    const settings = settingsFor(working, slug);
    const enabled = settings?.cache?.enabled === true;
    const ttl = settings?.cache?.ttlDays ?? DEFAULT_CACHE_TTL_DAYS;
    // Refresh stats after a clear so the menu reflects new state.
    const currentStats = stats.entries > 0
      ? stats
      : await statsForProvider(slug, env).catch(() => stats);

    const stateLine = enabled
      ? `cache: on · ${ttl}-day TTL · ${currentStats.entries} entries · ${formatBytes(currentStats.bytes)}`
      : `cache: off · ${currentStats.entries} entries · ${formatBytes(currentStats.bytes)}`;

    const choice = await select({
      message: `${displayName(slug)} — ${stateLine}`,
      options: [
        {
          value: ACTION_TOGGLE,
          label: enabled ? 'Disable caching' : 'Enable caching',
        },
        {
          value: ACTION_TTL,
          label: `Set TTL (current: ${ttl} days)`,
        },
        {
          value: ACTION_CLEAR,
          label:
            currentStats.entries === 0
              ? 'Clear cache (already empty)'
              : `Clear cache (${currentStats.entries} ${currentStats.entries === 1 ? 'entry' : 'entries'} · ${formatBytes(currentStats.bytes)})`,
        },
        { value: ACTION_BACK, label: 'Back to cache menu' },
      ],
    });
    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }

    if (choice === ACTION_BACK) {
      return working === config ? 'unchanged' : working;
    }

    if (choice === ACTION_TOGGLE) {
      const next: ProviderSettings = {
        ...(settings ?? {}),
        cache: {
          enabled: !enabled,
          // preserve TTL when toggling
          ...(settings?.cache?.ttlDays ? { ttlDays: settings.cache.ttlDays } : { ttlDays: DEFAULT_CACHE_TTL_DAYS }),
        },
      };
      working = applySettings(working, slug, next);
      continue;
    }

    if (choice === ACTION_TTL) {
      const ttlInput = await text({
        message: `${displayName(slug)} — TTL in days`,
        placeholder: String(DEFAULT_CACHE_TTL_DAYS),
        initialValue: String(ttl),
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
      if (isCancel(ttlInput)) {
        cancel('Setup canceled.');
        return null;
      }
      const ttlDays = Number.parseInt(String(ttlInput).trim(), 10);
      const next: ProviderSettings = {
        ...(settings ?? {}),
        cache: { enabled: settings?.cache?.enabled ?? true, ttlDays },
      };
      working = applySettings(working, slug, next);
      continue;
    }

    if (choice === ACTION_CLEAR) {
      if (currentStats.entries === 0) continue;
      const confirmed = await confirm({
        message: `Delete ${currentStats.entries} ${currentStats.entries === 1 ? 'entry' : 'entries'} (${formatBytes(currentStats.bytes)}) for ${displayName(slug)}?`,
        initialValue: false,
      });
      if (isCancel(confirmed) || !confirmed) continue;
      await clearProviderCache(slug, env);
      // Refresh stats so the next menu render reflects the empty state.
      stats = { ...currentStats, entries: 0, bytes: 0, newestRequestedAt: undefined };
      continue;
    }
  }
}

function resetAllCacheSettings(config: MarmotConfig): MarmotConfig {
  const providers = { ...((config.providers ?? {}) as Record<string, ProviderSettings>) };
  for (const slug of cacheableSlugs()) {
    const existing = providers[slug] ?? {};
    providers[slug] = {
      ...existing,
      cache: { enabled: true, ttlDays: DEFAULT_CACHE_TTL_DAYS },
    };
  }
  return { ...config, version: 1, providers };
}

function disableAllCacheSettings(config: MarmotConfig): MarmotConfig {
  const providers = { ...((config.providers ?? {}) as Record<string, ProviderSettings>) };
  for (const slug of cacheableSlugs()) {
    const existing = providers[slug] ?? {};
    providers[slug] = {
      ...existing,
      cache: {
        enabled: false,
        ...(existing.cache?.ttlDays ? { ttlDays: existing.cache.ttlDays } : {}),
      },
    };
  }
  return { ...config, version: 1, providers };
}
