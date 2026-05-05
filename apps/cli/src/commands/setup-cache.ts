// Global-cache walkthrough — invoked from `marmot setup`.
//
// Per-provider cache settings (toggle, TTL) live in the per-provider walk
// inside the `Providers` menu. This walk only handles bulk actions:
//   - Clear cache for all providers (deletes on-disk entries)
//   - Reset all cache settings (enable + 30-day TTL)
//   - Disable caching for all providers

import { cancel, confirm, isCancel, note, select, spinner } from '@clack/prompts';

import {
  DATA_PROVIDERS,
  DEFAULT_CACHE_TTL_DAYS,
  WEB_PROVIDERS,
  clearAllCache,
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

type Slug = AnyProviderSlug;

function cacheableSlugs(): Slug[] {
  return [...WEB_PROVIDERS, ...DATA_PROVIDERS] as Slug[];
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

    const totalEntries = [...stats.values()].reduce((s, x) => s + x.entries, 0);
    const totalBytes = [...stats.values()].reduce((s, x) => s + x.bytes, 0);

    note(
      `For per-provider cache settings (toggle, TTL), open Providers and pick a provider.\n\nOn disk: ${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'} · ${formatBytes(totalBytes)}.`,
      'global cache',
    );

    const choice = await select({
      message: 'Global cache — bulk actions',
      options: [
        { value: SHORTCUT_CLEAR_ALL, label: 'Clear cache for all providers' },
        { value: SHORTCUT_RESET_ALL, label: 'Reset all cache settings (enable, 30-day TTL)' },
        { value: SHORTCUT_DISABLE_ALL, label: 'Disable caching for all providers' },
        { value: ACTION_BACK, label: 'Back to setup' },
      ],
    });
    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return null;
    }

    if (choice === ACTION_BACK) return working;

    if (choice === SHORTCUT_CLEAR_ALL) {
      if (totalEntries === 0) {
        note('No cache entries on disk. Nothing to clear.', 'global cache');
        continue;
      }
      const confirmed = await confirm({
        message: `Delete ${totalEntries} ${totalEntries === 1 ? 'entry' : 'entries'} (${formatBytes(totalBytes)}) across all providers?`,
        initialValue: false,
      });
      if (isCancel(confirmed) || !confirmed) continue;
      const removed = await clearAllCache(env);
      note(`Removed ${removed} ${removed === 1 ? 'entry' : 'entries'}.`, 'global cache');
      continue;
    }

    if (choice === SHORTCUT_RESET_ALL) {
      working = resetAllCacheSettings(working);
      note(
        'All providers set to: cache enabled, 30-day TTL. (Existing cache entries on disk are untouched.)',
        'global cache',
      );
      continue;
    }

    if (choice === SHORTCUT_DISABLE_ALL) {
      working = disableAllCacheSettings(working);
      note('All providers set to: cache disabled.', 'global cache');
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
