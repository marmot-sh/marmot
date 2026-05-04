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
};

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

  if (options.json) {
    writeLine(stdout, JSON.stringify({ ok: true, buckets }, null, 2));
    return;
  }

  writeLine(stdout, formatHumanReadable(buckets));
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

function formatHumanReadable(buckets: ModeBucket[]): string {
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
      lines.push('    (cache empty)');
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
  return lines.join('\n');
}
