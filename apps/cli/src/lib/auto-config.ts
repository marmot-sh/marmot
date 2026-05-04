// First-run auto-config: when the user runs a verb without any config and
// without a --provider override, walk a pecking order of detected providers,
// pick the first ready one, persist the choice to ~/.marmot/ai/config.json,
// and surface a one-line stderr note. The goal is "install + set a key +
// run" — no `marmot setup` step required for the happy path.
//
// Auto-config writes the file once. Subsequent calls hit the persisted
// config (no detection cost, no risk of silently switching providers when
// the env changes). Users can always inspect with `marmot config show` or
// reconfigure with `marmot setup`.

import {
  PROVIDER_API_KEY_ENV_VARS,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
  PROVIDER_SPEECH_DEFAULT_MODELS,
  PROVIDER_TRANSCRIPTION_DEFAULT_MODELS,
  readMarmotConfig,
  writeMarmotConfig,
  type MarmotConfig,
  type OutputWriter,
  type ProviderSlug,
} from '@marmot-sh/core';

import { detectProviders, type ProviderStatus } from '../providers/detect.js';

export type AiVerb = 'text' | 'image' | 'speech' | 'transcription';

/**
 * Pecking order per verb. Local-first (Ollama, no key, no network),
 * then routers (one key, many models), then direct providers. The user
 * can override by passing --provider, by running `marmot setup`, or by
 * editing the config directly.
 */
const PECKING_ORDER: Record<AiVerb, readonly ProviderSlug[]> = {
  text: ['ollama', 'openrouter', 'vercel', 'cloudflare', 'openai', 'anthropic'],
  image: ['openrouter', 'vercel', 'cloudflare', 'openai'],
  speech: ['openrouter', 'vercel', 'cloudflare', 'openai'],
  transcription: ['openrouter', 'vercel', 'cloudflare', 'openai'],
};

const DEFAULT_MODEL_MAP: Record<AiVerb, Partial<Record<ProviderSlug, string>>> = {
  text: PROVIDER_DEFAULT_MODELS,
  image: PROVIDER_IMAGE_DEFAULT_MODELS,
  speech: PROVIDER_SPEECH_DEFAULT_MODELS,
  transcription: PROVIDER_TRANSCRIPTION_DEFAULT_MODELS,
};

export type AutoConfigDeps = {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  stderr?: OutputWriter;
  /** Override detection (for tests). */
  detectStatuses?: () => Promise<ProviderStatus[]>;
};

/**
 * Ensure a default provider/model is configured for `verb`. Returns the
 * (possibly updated) config. Side effects:
 *   - May write `~/.marmot/ai/config.json`
 *   - May print a one-line note to stderr
 *
 * Behavior:
 *   - If config already has `defaults.<verb>.provider`: no-op (returns as-is)
 *   - Else, pick the first PECKING_ORDER provider that's "ready" (key set
 *     for cloud providers, daemon reachable for ollama, has a default model
 *     for the verb)
 *   - Persist the choice and return the updated config
 *   - If nothing detected: returns the original config unchanged (caller's
 *     existing "No default provider" error fires with full context)
 */
export async function ensureAutoConfig(
  verb: AiVerb,
  deps: AutoConfigDeps = {},
): Promise<MarmotConfig> {
  const env = deps.env ?? process.env;
  const config = (await readMarmotConfig(env)) ?? { version: 1 };

  // Already configured (either by `marmot setup` or by a prior auto-config) → no-op.
  if (config.defaults?.[verb]?.provider) return config;

  const detect = deps.detectStatuses ?? (() => detectProviders(env, deps.fetchFn ?? fetch));
  const statuses = await detect();
  const byslug = new Map(statuses.map((s) => [s.slug, s]));

  const order = PECKING_ORDER[verb];
  const modelMap = DEFAULT_MODEL_MAP[verb];

  for (const slug of order) {
    const status = byslug.get(slug);
    if (!status?.ready) continue;
    const model = modelMap[slug];
    if (!model) continue; // verb not supported by this provider's default-model map

    const updated: MarmotConfig = {
      ...config,
      defaults: {
        ...(config.defaults ?? {}),
        [verb]: { provider: slug, model },
      },
    };
    await writeMarmotConfig(updated, env);

    const stderr = deps.stderr ?? process.stderr;
    stderr.write(
      `[auto-config] ${verb} → ${slug} (model: ${model}). Run \`marmot setup\` to change.\n`,
    );

    return updated;
  }

  // Nothing detected. Return as-is so the caller's normal "no default provider"
  // error fires with the actionable message that already exists.
  return config;
}

/**
 * Build a richer "no AI providers detected" error message that names the
 * env vars to set, with links to where users can get keys. Used as the
 * fallback message when auto-config can't find anything to use.
 */
export function formatNoProvidersHint(verb: AiVerb): string {
  const order = PECKING_ORDER[verb];
  const lines: string[] = [
    `No AI providers detected for "${verb}". Marmot looks for these in order:`,
    '',
  ];
  for (const slug of order) {
    if (slug === 'ollama') {
      lines.push(`  - ollama (local, no key — start the daemon at http://localhost:11434)`);
      continue;
    }
    const envVar = PROVIDER_API_KEY_ENV_VARS[slug];
    const help = HELP_URLS[slug];
    const envCol = envVar ? `set ${envVar}` : '';
    const helpCol = help ? ` (get a key at ${help})` : '';
    lines.push(`  - ${slug} — ${envCol}${helpCol}`);
  }
  lines.push('');
  lines.push('Set any of the above env vars and re-run, or run `marmot setup` to configure interactively.');
  return lines.join('\n');
}

const HELP_URLS: Partial<Record<ProviderSlug, string>> = {
  openrouter: 'https://openrouter.ai/keys',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  vercel: 'https://vercel.com/dashboard/account/tokens',
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
};
