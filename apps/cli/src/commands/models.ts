import {
  PROVIDERS,
  readProviderCache,
  readProviderImageCache,
  readProviderSpeechCache,
  readProviderTranscriptionCache,
  writeLine,
  type OutputWriter,
  type ProviderSlug,
} from '@marmot-sh/core';

import { getProviderAdapter } from '../providers/index.js';

type Mode = 'text' | 'image' | 'speech' | 'transcription';

const MODES: readonly Mode[] = ['text', 'image', 'speech', 'transcription'] as const;

export type ModelsCommandOptions = {
  provider?: string;
  mode?: string;
  json?: boolean;
  search?: string;
  limit?: string | number;
};

const DEFAULT_SEARCH_LIMIT = 10;

type ModelsCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

type ModelEntry = {
  id: string;
  name: string;
  contextLength?: number | null;
  isDefault: boolean;
};

type ModeBucket = {
  provider: ProviderSlug;
  mode: Mode;
  defaultModel: string | null;
  fetchedAt: string | null;
  models: ModelEntry[];
  cached: boolean;
  note?: string;
};

export async function handleModelsCommand(
  options: ModelsCommandOptions,
  dependencies: ModelsCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const providers = resolveProviders(options.provider);
  const modes = resolveModes(options.mode);

  const buckets: ModeBucket[] = [];

  for (const provider of providers) {
    const adapter = getProviderAdapter(provider);
    for (const mode of modes) {
      if (!supportsMode(adapter.capabilities, mode)) continue;
      buckets.push(await loadBucket(provider, mode, env));
    }
  }

  // --search filters the model list within each bucket; --limit caps the
  // total results across all buckets (default 10, 0 = no limit). Buckets
  // that end up empty after filtering still appear so users see "no
  // matches" per-provider rather than a silent disappearance.
  const search = options.search?.trim();
  if (search) {
    const needle = search.toLowerCase();
    const limit = parseSearchLimit(options.limit);
    let remaining = limit;
    for (const bucket of buckets) {
      if (!bucket.cached) {
        bucket.models = [];
        continue;
      }
      const matched = bucket.models.filter(
        (m) =>
          m.id.toLowerCase().includes(needle) ||
          m.name.toLowerCase().includes(needle),
      );
      if (limit === 0) {
        bucket.models = matched;
      } else {
        const take = matched.slice(0, Math.max(0, remaining));
        bucket.models = take;
        remaining -= take.length;
      }
    }
  }

  if (options.json) {
    writeLine(
      stdout,
      JSON.stringify(
        {
          ok: true,
          buckets,
          ...(search ? { search, totalMatches: buckets.reduce((acc, b) => acc + b.models.length, 0) } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }

  writeLine(stdout, formatHumanReadable(buckets, { search }));
}

function parseSearchLimit(value: string | number | undefined): number {
  if (value === undefined || value === null || value === '') return DEFAULT_SEARCH_LIMIT;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`--limit must be a non-negative integer (got "${value}"). Use 0 for no limit.`);
  }
  return n;
}

function supportsMode(
  caps: { text: boolean; image: boolean; speech: boolean; transcription: boolean },
  mode: Mode,
): boolean {
  switch (mode) {
    case 'text':
      return caps.text;
    case 'image':
      return caps.image;
    case 'speech':
      return caps.speech;
    case 'transcription':
      return caps.transcription;
  }
}

async function loadBucket(
  provider: ProviderSlug,
  mode: Mode,
  env: NodeJS.ProcessEnv,
): Promise<ModeBucket> {
  const file = await readCacheFor(provider, mode, env);
  if (!file) {
    return {
      provider,
      mode,
      defaultModel: null,
      fetchedAt: null,
      models: [],
      cached: false,
      note: `No cache. Run "marmot cache refresh ${provider}".`,
    };
  }

  const defaultModel = file.defaultModel ?? null;
  const models: ModelEntry[] = file.models.map((m) => {
    const entry: ModelEntry = {
      id: m.id,
      name: m.name,
      isDefault: m.id === defaultModel,
    };
    if (mode === 'text' && 'contextLength' in m) {
      entry.contextLength = (m as { contextLength?: number | null }).contextLength ?? null;
    }
    return entry;
  });

  return {
    provider,
    mode,
    defaultModel,
    fetchedAt: file.fetchedAt ?? null,
    models,
    cached: true,
  };
}

async function readCacheFor(
  provider: ProviderSlug,
  mode: Mode,
  env: NodeJS.ProcessEnv,
): Promise<{ defaultModel: string; fetchedAt: string; models: Array<{ id: string; name: string }> } | null> {
  switch (mode) {
    case 'text':
      return readProviderCache(provider, env);
    case 'image':
      return readProviderImageCache(provider, env);
    case 'speech':
      return readProviderSpeechCache(provider, env);
    case 'transcription':
      return readProviderTranscriptionCache(provider, env);
  }
}

function resolveProviders(value: string | undefined): readonly ProviderSlug[] {
  if (!value) return PROVIDERS;
  if (!(PROVIDERS as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown provider "${value}". Available: ${PROVIDERS.join(', ')}.`,
    );
  }
  return [value as ProviderSlug];
}

function resolveModes(value: string | undefined): readonly Mode[] {
  if (!value) return MODES;
  if (!(MODES as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown mode "${value}". Available: ${MODES.join(', ')}.`,
    );
  }
  return [value as Mode];
}

function formatHumanReadable(
  buckets: ModeBucket[],
  options: { search?: string } = {},
): string {
  if (buckets.length === 0) {
    return 'No matching providers.';
  }

  const lines: string[] = [];
  let lastProvider: ProviderSlug | null = null;

  for (const bucket of buckets) {
    if (bucket.provider !== lastProvider) {
      if (lastProvider !== null) lines.push('');
      lines.push(`# ${bucket.provider}`);
      lastProvider = bucket.provider;
    }
    lines.push(`  ${bucket.mode}:`);
    if (!bucket.cached) {
      lines.push(`    (${bucket.note ?? 'no cache'})`);
      continue;
    }
    if (bucket.models.length === 0) {
      lines.push(options.search ? '    (no matches)' : '    (cache empty)');
      continue;
    }
    for (const m of bucket.models) {
      const star = m.isDefault ? '*' : ' ';
      const ctx = m.contextLength ? ` (${m.contextLength.toLocaleString()} ctx)` : '';
      lines.push(`   ${star} ${m.id}${ctx}`);
    }
  }

  lines.push('');
  lines.push('* = default model (set via `marmot config set <verb>.model <id>`)');
  if (options.search) {
    const total = buckets.reduce((acc, b) => acc + b.models.length, 0);
    lines.push(`Matched ${total} model${total === 1 ? '' : 's'} for "${options.search}".`);
  }
  return lines.join('\n');
}
