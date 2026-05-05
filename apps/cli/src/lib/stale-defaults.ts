// CLI-side bridge to the core stale-default validator: read whatever
// cache files exist on disk for the configured-default providers, then
// hand the snapshot to `findStaleDefaults`. Avoids hitting providers
// here -- read-only, fast, safe to call before any menu render.

import {
  findStaleDefaults,
  readProviderCache,
  readProviderImageCache,
  readProviderSpeechCache,
  readProviderTranscriptionCache,
  type CatalogSnapshot,
  type MarmotConfig,
  type ProviderSlug,
  type StaleDefault,
} from '@marmot-sh/core';

export async function readStaleDefaults(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StaleDefault[]> {
  const catalogs: CatalogSnapshot = {
    text: {},
    image: {},
    speech: {},
    transcription: {},
  };

  // Only load the cache for each verb's currently-configured provider.
  // Reading all six caches per modality every time would be wasteful;
  // the validator can only flag a configured pair anyway.
  for (const verb of ['text', 'image', 'speech', 'transcription'] as const) {
    const entry = config.defaults?.[verb];
    if (!entry?.provider) continue;
    const provider = entry.provider as ProviderSlug;

    try {
      if (verb === 'text') {
        const cache = await readProviderCache(provider, env);
        if (cache) catalogs.text![provider] = cache;
      } else if (verb === 'image') {
        const cache = await readProviderImageCache(provider, env);
        if (cache) catalogs.image![provider] = cache;
      } else if (verb === 'speech') {
        const cache = await readProviderSpeechCache(provider, env);
        if (cache) catalogs.speech![provider] = cache;
      } else if (verb === 'transcription') {
        const cache = await readProviderTranscriptionCache(provider, env);
        if (cache) catalogs.transcription![provider] = cache;
      }
    } catch {
      // Cache read failures are non-fatal here: if a cache is missing or
      // malformed we simply can't validate against it. Surfacing the read
      // error would distract from the actual stale-default check.
    }
  }

  return findStaleDefaults(config, catalogs);
}
