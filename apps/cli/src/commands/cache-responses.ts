// CLI handlers for `marmot cache clear` and `marmot cache stats`.

import {
  AICliError,
  DATA_PROVIDERS,
  PROVIDERS,
  WEB_PROVIDERS,
  clearAllCache,
  clearByQuery,
  clearOlderThan,
  clearProviderCache,
  statsAll,
  statsForProvider,
} from '@marmot-sh/core';

const ALL_PROVIDER_SLUGS: ReadonlySet<string> = new Set([
  ...PROVIDERS,
  ...WEB_PROVIDERS,
  ...DATA_PROVIDERS,
]);

/**
 * Reject anything that isn't a known provider slug. The cache subcommands
 * pass `--provider` straight to filesystem path joins (cache root + slug),
 * so an unvalidated value like `"../sessions/x"` would escape the cache
 * tree and let `cache clear` delete arbitrary files inside `~/.marmot/ai/`.
 * Allowlist enforcement at the CLI boundary closes that path.
 */
function assertProviderSlug(provider: string): void {
  if (!ALL_PROVIDER_SLUGS.has(provider)) {
    throw new AICliError(
      'validation',
      `Unknown provider "${provider}". Run \`marmot providers\` to list valid slugs.`,
    );
  }
}

export type CacheClearCommandOptions = {
  provider?: string;
  all?: boolean;
  query?: string;
  olderThan?: string;
};

export type CacheStatsCommandOptions = {
  provider?: string;
};

export type CacheCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: { write(s: string): boolean | void };
};

function parsePositiveInt(value: string, label: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new AICliError(
      'validation',
      `--${label} must be a non-negative integer (got "${value}").`,
    );
  }
  return n;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function handleCacheClearCommand(
  options: CacheClearCommandOptions,
  deps: CacheCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  if (!options.provider && !options.all) {
    throw new AICliError(
      'validation',
      'cache clear requires either --provider <slug> or --all.',
    );
  }
  if (options.provider && options.all) {
    throw new AICliError(
      'validation',
      'cache clear does not accept --provider together with --all.',
    );
  }
  if (options.provider) assertProviderSlug(options.provider);

  let removed = 0;
  let scope: string;

  if (options.olderThan) {
    const days = parsePositiveInt(options.olderThan, 'older-than');
    removed = await clearOlderThan(options.provider ?? null, days, env);
    scope = options.provider
      ? `${options.provider} (older than ${days}d)`
      : `all providers (older than ${days}d)`;
  } else if (options.query && options.provider) {
    removed = await clearByQuery(options.provider, options.query, env);
    scope = `${options.provider} (query matching "${options.query}")`;
  } else if (options.query && !options.provider) {
    throw new AICliError(
      'validation',
      'cache clear --query requires --provider <slug>.',
    );
  } else if (options.all) {
    removed = await clearAllCache(env);
    scope = 'all providers';
  } else {
    removed = await clearProviderCache(options.provider!, env);
    scope = options.provider!;
  }

  stdout.write(
    `${JSON.stringify(
      { ok: true, scope, removed, timestamp: new Date().toISOString() },
      null,
      2,
    )}\n`,
  );
}

export async function handleCacheStatsCommand(
  options: CacheStatsCommandOptions,
  deps: CacheCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  if (options.provider) assertProviderSlug(options.provider);
  const stats = options.provider
    ? [await statsForProvider(options.provider, env)]
    : await statsAll(env);

  const totalEntries = stats.reduce((acc, s) => acc + s.entries, 0);
  const totalBytes = stats.reduce((acc, s) => acc + s.bytes, 0);

  stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        totals: {
          providers: stats.length,
          entries: totalEntries,
          bytes: totalBytes,
          bytesHuman: formatBytes(totalBytes),
        },
        providers: stats.map((s) => ({
          provider: s.provider,
          entries: s.entries,
          bytes: s.bytes,
          bytesHuman: formatBytes(s.bytes),
          oldestRequestedAt: s.oldestRequestedAt ?? null,
          newestRequestedAt: s.newestRequestedAt ?? null,
        })),
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}
