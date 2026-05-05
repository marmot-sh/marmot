// Stale-default validation: given a user's MarmotConfig and any subset of
// freshly-fetched provider catalogs, return the list of configured AI
// defaults whose `provider:model` pair is no longer present in the
// catalog.
//
// Pure function. No I/O, no UI. Callers (setup hub, `config show`,
// pickModel) decide when to read caches and how to surface results.

import type { ProviderSlug } from '../lib/constants.js';
import type { MarmotConfig } from '../schemas/config.js';
import type {
  ProviderCacheFile,
  ProviderImageCacheFile,
  ProviderSpeechCacheFile,
  ProviderTranscriptionCacheFile,
  ProviderVideoCacheFile,
} from '../types.js';

export type AiVerb = 'text' | 'image' | 'speech' | 'transcription' | 'video';

export type StaleDefault = {
  verb: AiVerb;
  provider: ProviderSlug;
  model: string;
};

/** Per-modality caches keyed by provider slug. Pass only what you have on
 *  hand; missing entries skip that verb's check rather than erroring. */
export type CatalogSnapshot = {
  text?: Partial<Record<ProviderSlug, ProviderCacheFile>>;
  image?: Partial<Record<ProviderSlug, ProviderImageCacheFile>>;
  speech?: Partial<Record<ProviderSlug, ProviderSpeechCacheFile>>;
  transcription?: Partial<Record<ProviderSlug, ProviderTranscriptionCacheFile>>;
  video?: Partial<Record<ProviderSlug, ProviderVideoCacheFile>>;
};

const VERBS: readonly AiVerb[] = ['text', 'image', 'speech', 'transcription', 'video'];

export function findStaleDefaults(
  config: MarmotConfig,
  catalogs: CatalogSnapshot,
): StaleDefault[] {
  const stale: StaleDefault[] = [];

  for (const verb of VERBS) {
    const entry = config.defaults?.[verb];
    if (!entry?.provider || !entry.model) continue;

    const cache = catalogs[verb]?.[entry.provider as ProviderSlug];
    if (!cache) continue;

    const found = cache.models.some((m) => m.id === entry.model);
    if (!found) {
      stale.push({
        verb,
        provider: entry.provider as ProviderSlug,
        model: entry.model,
      });
    }
  }

  return stale;
}

/** Render a multiline warning block for stale defaults, suitable for
 *  stderr output or for embedding at the top of a setup/config screen.
 *  Returns null when nothing is stale so callers can skip the render. */
export function formatStaleDefaultsBanner(stale: readonly StaleDefault[]): string | null {
  if (stale.length === 0) return null;

  const header = stale.length === 1
    ? '1 configured default refers to a model no longer in its provider catalog:'
    : `${stale.length} configured defaults refer to models no longer in their provider catalogs:`;

  const lines = stale.map(
    (s) => `  ${s.verb.padEnd(15)} ${s.provider}:${s.model}`,
  );

  const fixHint =
    'Run `marmot setup` to pick a current model, or `marmot config set <verb>.model <id>`.';

  return [header, '', ...lines, '', fixHint].join('\n');
}
