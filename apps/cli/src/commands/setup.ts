import {
  cancel,
  confirm,
  isCancel,
  note,
  select,
  spinner,
  text,
} from '@clack/prompts';

import {
  brandText,
  ensureProviderCache,
  ensureProviderImageCache,
  ensureProviderSpeechCache,
  ensureProviderTranscriptionCache,
  ensureProviderVideoCache,
  formatStaleDefaultsBanner,
  warnText,
} from '@marmot-sh/core';
import { readStaleDefaults } from '../lib/stale-defaults.js';
import { createEphemeralSpinner } from '../lib/ephemeral-spinner.js';
import {
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_IMAGE_DEFAULT_MODELS,
  PROVIDER_SPEECH_DEFAULT_MODELS,
  PROVIDER_TRANSCRIPTION_DEFAULT_MODELS,
  PROVIDER_VIDEO_DEFAULT_MODELS,
  type ProviderSlug,
} from '@marmot-sh/core';
import {
  DATA_PROVIDERS,
  DATA_VERBS,
  WEB_PROVIDERS,
  WEB_VERBS,
  resolveProviderAuth,
  type AnyProviderSlug,
} from '@marmot-sh/core';
import { findProjectRoot, readSkillState, statsAll } from '@marmot-sh/core';
import { readCompletionsState } from '@marmot-sh/core';
import { writeMarmotConfig, readMarmotConfig } from '@marmot-sh/core';
import { MARMOT_VERSION } from '../lib/version.js';
import {
  detectProviders,
  filterImageReady,
  filterReady,
  filterSpeechReady,
  filterTranscriptionReady,
  filterVideoReady,
  type ProviderStatus,
} from '../providers/detect.js';
import {
  getCloudflareAccountId,
  getOllamaApiBaseUrl,
  getProviderApiKey,
} from '@marmot-sh/core';
import { getMarmotConfigPath } from '@marmot-sh/core';
import { getProviderAdapter } from '../providers/index.js';
import type { MarmotConfig } from '@marmot-sh/core';
import { walkAllDataDefaults } from './setup-data-defaults.js';
import { EXIT_SETUP, EXIT_SETUP_OPTION } from '../lib/setup-exit.js';
import { walkProviderSettings } from './setup-provider-settings.js';
import { walkResponseCache } from './setup-cache.js';
import { walkCompletionsSetup } from './setup-completions.js';
import { walkSkillSetup } from './setup-skill.js';
import { formatTable } from '../lib/table.js';

const SKIP_VALUE = '__skip__';

export type SetupCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
};

type Mode = 'text' | 'image' | 'speech' | 'transcription' | 'video';
type ModeLabel = { mode: Mode; label: string; fallbackHint: string };

const MODES: ModeLabel[] = [
  { mode: 'text', label: 'Text', fallbackHint: 'OpenRouter' },
  { mode: 'image', label: 'Image', fallbackHint: 'OpenAI' },
  { mode: 'speech', label: 'Speech', fallbackHint: 'OpenAI' },
  { mode: 'transcription', label: 'Transcription', fallbackHint: 'OpenAI' },
  { mode: 'video', label: 'Video', fallbackHint: 'OpenRouter' },
];

const AI_DEFAULTS = '__ai_defaults__';
const CONTEXT_DEFAULTS = '__context_defaults__';
const PROVIDER_SETTINGS = '__providers__';
const GLOBAL_CACHE = '__cache__';
const SKILL_SETUP = '__skill__';
const COMPLETIONS_SETUP = '__completions__';
const DONE = '__done__';

// Sub-menu values for the AI defaults drill-down.
const AI_TEXT = 'text';
const AI_IMAGE = 'image';
const AI_SPEECH = 'speech';
const AI_TRANSCRIPTION = 'transcription';
const AI_VIDEO = 'video';
const AI_BACK = '__back__';

export async function handleSetupCommand(
  dependencies: SetupCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const fetchFn = dependencies.fetchFn ?? fetch;

  // Detection runs before anything is rendered. Use an ephemeral spinner
  // (clears its line on stop) rather than clack's, which leaves a
  // "◇  Detection complete" row that sticks around through every hub
  // re-render. The hub is a flat screen, not a wizard transcript.
  const detectSpin = createEphemeralSpinner();
  detectSpin.start('Detecting providers');
  const statuses = await detectProviders(env, fetchFn);
  detectSpin.stop();

  let config: MarmotConfig = (await readConfigSafely(env)) ?? { version: 1 };

  // First-run path: empty defaults → offer to populate with sensible
  // OpenRouter values for all four AI verbs in one shot. If
  // OPENROUTER_API_KEY isn't actually set, warn the user before writing
  // a config that won't work without it.
  const aiKeys = ['text', 'image', 'speech', 'transcription'] as const;
  const hasAnyAiDefault = aiKeys.some((k) => Boolean(config.defaults?.[k]?.provider));
  if (!hasAnyAiDefault) {
    const hasOpenRouterKey = Boolean(env.OPENROUTER_API_KEY?.trim());
    const message = hasOpenRouterKey
      ? 'No AI defaults are configured. Populate with OpenRouter defaults for text, image, speech, and transcription?'
      : 'No AI defaults are configured. Populate with OpenRouter defaults? (OPENROUTER_API_KEY is NOT set in your environment, calls will fail until you set it.)';
    const populate = await confirm({
      message,
      initialValue: hasOpenRouterKey,
    });
    if (isCancel(populate)) {
      cancel('Setup canceled.');
      return;
    }
    if (populate) {
      // Pull from the central default-model maps so first-run defaults can
      // never drift from the rest of the codebase. Adding a new mode here
      // means adding to the relevant *_DEFAULT_MODELS map only.
      config = {
        version: 1,
        defaults: {
          ...(config.defaults ?? {}),
          text: { provider: 'openrouter', model: PROVIDER_DEFAULT_MODELS.openrouter },
          image: { provider: 'openrouter', model: PROVIDER_IMAGE_DEFAULT_MODELS.openrouter! },
          speech: { provider: 'openrouter', model: PROVIDER_SPEECH_DEFAULT_MODELS.openrouter! },
          transcription: { provider: 'openrouter', model: PROVIDER_TRANSCRIPTION_DEFAULT_MODELS.openrouter! },
        },
      };
      await writeMarmotConfig(config, env);
    }
  }

  // Hub loop: clear screen, render flat status + menu, dispatch to a
  // sub-walk, loop. Each iteration starts from a clean screen so the
  // hub stays a single visible surface instead of an accumulating
  // transcript of past visits.
  for (;;) {
    const staleBanner = formatStaleDefaultsBanner(await readStaleDefaults(config, env));
    renderHub(env, await formatStatusSnapshot(config, env), staleBanner);

    const hints = await computeMenuHints(config, env);
    const choice = await select({
      message: 'What would you like to do?',
      options: [
        { value: AI_DEFAULTS, label: 'AI defaults', hint: hints.ai },
        { value: CONTEXT_DEFAULTS, label: 'Context defaults', hint: hints.data },
        { value: PROVIDER_SETTINGS, label: 'Providers', hint: hints.providers },
        { value: GLOBAL_CACHE, label: 'Global cache', hint: hints.cache },
        { value: SKILL_SETUP, label: 'Agent skill', hint: hints.skill },
        { value: COMPLETIONS_SETUP, label: 'Shell completions', hint: hints.completions },
        { value: DONE, label: 'Exit setup' },
      ],
    });

    if (isCancel(choice)) {
      cancel('Setup canceled.');
      return;
    }

    if (choice === DONE) {
      process.stdout.write(`Saved to ${getMarmotConfigPath(env)}\n`);
      return;
    }

    if (choice === AI_DEFAULTS) {
      const updated = await walkAIDefaults(config, statuses, env, fetchFn);
      if (updated === null) return;
      if (updated === EXIT_SETUP) {
        process.stdout.write(`Saved to ${getMarmotConfigPath(env)}\n`);
        return;
      }
      if (updated !== 'unchanged') {
        config = updated;
        await writeMarmotConfig(config, env);
      }
      continue;
    }

    if (choice === CONTEXT_DEFAULTS) {
      const updated = await walkAllDataDefaults(config, env);
      if (updated === null) return;
      if (updated === EXIT_SETUP) {
        process.stdout.write(`Saved to ${getMarmotConfigPath(env)}\n`);
        return;
      }
      if (updated !== 'unchanged') {
        config = updated;
        await writeMarmotConfig(config, env);
      }
      continue;
    }

    if (choice === PROVIDER_SETTINGS) {
      const updated = await walkProviderSettings(config, env);
      if (updated === null) return;
      if (updated === (EXIT_SETUP as unknown as MarmotConfig)) {
        process.stdout.write(`Saved to ${getMarmotConfigPath(env)}\n`);
        return;
      }
      if (updated !== ('unchanged' as unknown as MarmotConfig)) {
        config = updated;
        await writeMarmotConfig(config, env);
      }
      continue;
    }

    if (choice === GLOBAL_CACHE) {
      const updated = await walkResponseCache(config, env);
      if (updated === null) return;
      if (updated === (EXIT_SETUP as unknown as MarmotConfig)) {
        process.stdout.write(`Saved to ${getMarmotConfigPath(env)}\n`);
        return;
      }
      if (updated !== config) {
        config = updated;
        await writeMarmotConfig(config, env);
      }
      continue;
    }

    if (choice === SKILL_SETUP) {
      await walkSkillSetup(env);
      continue;
    }

    if (choice === COMPLETIONS_SETUP) {
      await walkCompletionsSetup(env);
      continue;
    }
  }
}

/** Clear the terminal (TTY only) and render a flat header + status snapshot.
 *  Intentionally not using clack's `note`/`intro` — those draw a connecting
 *  rail meant for a wizard. The hub is a hub, not a wizard.
 *
 *  Optional `staleBanner` surfaces configured defaults whose model is no
 *  longer in the cached provider catalog, so the user sees the problem at
 *  the place where they can fix it. */
function renderHub(
  env: NodeJS.ProcessEnv,
  statusSnapshot: string,
  staleBanner: string | null,
): void {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[H');
  }
  process.stdout.write(`${brandText('marmot', { bold: true, env })} ${MARMOT_VERSION}\n\n`);
  if (staleBanner) {
    process.stdout.write(`${warnText(staleBanner)}\n\n`);
  }
  process.stdout.write(`${statusSnapshot}\n\n`);
}

async function editMode(
  mode: Mode,
  config: MarmotConfig,
  statuses: ProviderStatus[],
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch,
): Promise<MarmotConfig | null | 'unchanged'> {
  const ready = filterByMode(mode, statuses);
  const fallback = MODES.find((m) => m.mode === mode)?.fallbackHint ?? '';

  const provider = await pickProvider({
    purpose: mode,
    statuses: ready,
    fallbackHint: fallback,
  });
  if (provider === null) return null;
  if (provider === undefined) return 'unchanged';

  const model = await pickModel({ purpose: mode, provider, env, fetchFn });
  if (model === null) return null;

  let voice: string | undefined;
  if (mode === 'speech' && model && model !== SKIP_VALUE) {
    const voiceChoice = await pickVoice({ provider, model, env, fetchFn });
    if (voiceChoice === null) return null;
    voice = voiceChoice;
  }

  return applyMode(mode, provider, model, voice, config);
}

function applyMode(
  mode: Mode,
  provider: ProviderSlug,
  modelOrSkip: string | undefined,
  voiceOrSkip: string | undefined,
  config: MarmotConfig,
): MarmotConfig {
  const entry: { provider: ProviderSlug; model?: string; voice?: string } = {
    provider,
  };
  if (modelOrSkip && modelOrSkip !== SKIP_VALUE) {
    entry.model = modelOrSkip;
  }
  if (mode === 'speech' && voiceOrSkip && voiceOrSkip !== SKIP_VALUE) {
    entry.voice = voiceOrSkip;
  }
  return {
    version: 1,
    defaults: {
      ...(config.defaults ?? {}),
      [mode]: entry,
    },
  };
}

type PickVoiceArgs = {
  provider: ProviderSlug;
  model: string;
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
};

async function pickVoice(
  args: PickVoiceArgs,
): Promise<string | null | undefined> {
  const adapter = getProviderAdapter(args.provider);
  if (!adapter.refreshSpeechModels) return undefined;

  let voices: string[] = [];
  try {
    const refreshed = await adapter.refreshSpeechModels({
      apiKey: getProviderApiKey(args.provider, undefined, args.env),
      cloudflareAccountId:
        args.provider === 'cloudflare' ? getCloudflareAccountId(args.env) : undefined,
      fetchFn: args.fetchFn,
    });
    voices = refreshed.models.find((m) => m.id === args.model)?.voices ?? [];
  } catch {
    // If we can't fetch voices, skip the prompt and rely on provider default.
    return undefined;
  }

  if (voices.length === 0) return undefined;
  if (voices.length === 1) return undefined; // single voice — provider default is fine

  const choice = await select({
    message: `Default voice for ${args.model}`,
    options: [
      ...voices.map((v) => ({ value: v, label: v })),
      { value: SKIP_VALUE, label: 'Skip — provider default voice' },
    ],
  });

  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  return choice as string;
}

function filterByMode(mode: Mode, statuses: ProviderStatus[]): ProviderStatus[] {
  switch (mode) {
    case 'text': return filterReady(statuses);
    case 'image': return filterImageReady(statuses);
    case 'speech': return filterSpeechReady(statuses);
    case 'transcription': return filterTranscriptionReady(statuses);
    case 'video': return filterVideoReady(statuses);
  }
}

/* -------------------------------------------------------------------------- */
/*  status snapshot + menu hints                                              */
/* -------------------------------------------------------------------------- */

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

/** Two-row status snapshot rendered after the defaults table:
 *    Caching       2 enabled · 86 KB total
 *    Agent skill   installed (claude-code)
 *  Quick at-a-glance for "is anything set up beyond the defaults". */
async function formatStatusSnapshot(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  // Cache: count enabled providers from config + total on-disk size.
  const cacheableSlugs = [...WEB_PROVIDERS, ...DATA_PROVIDERS] as AnyProviderSlug[];
  let enabledCount = 0;
  for (const slug of cacheableSlugs) {
    const settings = (config.providers as Record<string, ProviderSettings> | undefined)?.[slug];
    if (settings?.cache?.enabled) enabledCount += 1;
  }
  let totalBytes = 0;
  try {
    for (const s of await statsAll(env)) totalBytes += s.bytes;
  } catch {
    // If the cache dir doesn't exist yet, total is 0; harmless.
  }
  const cacheLine =
    enabledCount === 0
      ? 'no caches enabled'
      : `${enabledCount} enabled · ${formatBytes(totalBytes)} total`;

  // Skill: report whichever scope is installed (or both). Walk upward
  // from cwd to a project root so a project install in an ancestor
  // directory is detected when setup runs from a subdirectory.
  const skillLine = await formatSkillHint(env);

  return formatTable(
    [
      ['Caching', cacheLine],
      ['Agent skill', skillLine],
    ],
    { gap: 4 },
  );
}

type MenuHints = {
  ai: string;
  data: string;
  providers: string;
  cache: string;
  skill: string;
  completions: string;
};

async function computeMenuHints(
  config: MarmotConfig,
  env: NodeJS.ProcessEnv,
): Promise<MenuHints> {
  return {
    ai: aiHint(config),
    data: dataHint(config),
    providers: providersHint(config, env),
    cache: cacheHint(config),
    skill: await skillHint(env),
    completions: await completionsHint(env),
  };
}

function aiHint(config: MarmotConfig): string {
  const total = MODES.length;
  const set = MODES.filter((m) => Boolean(config.defaults?.[m.mode]?.provider));
  if (set.length === 0) return `0 of ${total} set`;
  const providers = new Set(
    set
      .map((m) => config.defaults?.[m.mode]?.provider)
      .filter((p): p is NonNullable<typeof p> => Boolean(p)),
  );
  const providerLabel = providers.size === 1 ? `· ${[...providers][0]}` : '· mixed';
  return set.length === total ? `all ${total} set ${providerLabel}` : `${set.length} of ${total} set ${providerLabel}`;
}

function dataHint(config: MarmotConfig): string {
  const total = WEB_VERBS.length + DATA_VERBS.length;
  let set = 0;
  for (const verb of WEB_VERBS) {
    if (
      (config.defaults as Record<string, { provider?: string }> | undefined)?.[verb]
        ?.provider
    ) {
      set += 1;
    }
  }
  for (const verb of DATA_VERBS) {
    if (
      (config.defaults as Record<string, { provider?: string }> | undefined)?.[verb]
        ?.provider
    ) {
      set += 1;
    }
  }
  return `${set} of ${total} set`;
}

function providersHint(config: MarmotConfig, env: NodeJS.ProcessEnv): string {
  const slugs = [...PROVIDERS_LIST_FOR_HINTS()] as AnyProviderSlug[];
  let withKey = 0;
  let paused = 0;
  for (const slug of slugs) {
    const { apiKey } = resolveProviderAuth(slug, config, env);
    const hasCred = Boolean(apiKey) || slug === 'ollama';
    if (!hasCred) {
      // Skip providers with no credential — but they still benefit from the
      // teach-back inside the walk; the hint just summarizes operability.
      continue;
    }
    withKey += 1;
    const settings = (config.providers as Record<string, ProviderSettings> | undefined)?.[slug];
    if (settings?.enabled === false) paused += 1;
  }
  if (withKey === 0) return 'no providers have credentials';
  if (paused === 0) return `${withKey} with key · all enabled`;
  return `${withKey} with key · ${paused} paused`;
}

function cacheHint(config: MarmotConfig): string {
  const slugs = [...WEB_PROVIDERS, ...DATA_PROVIDERS] as AnyProviderSlug[];
  let enabled = 0;
  for (const slug of slugs) {
    const settings = (config.providers as Record<string, ProviderSettings> | undefined)?.[slug];
    if (settings?.cache?.enabled) enabled += 1;
  }
  return enabled === 0 ? 'no caches enabled' : `${enabled} enabled`;
}

async function skillHint(env: NodeJS.ProcessEnv): Promise<string> {
  return formatSkillHint(env);
}

/**
 * Compute the "Agent skill" status hint shown both in the top-of-screen
 * status table and as the menu-item hint for the Agent skill row.
 * Checks BOTH global scope (`~/.agents/skills/marmot/`) and project
 * scope (`<projectRoot>/.agents/skills/marmot/`, where projectRoot is
 * resolved by walking upward from cwd looking for marker dirs). Reports
 * one of: "not installed", "installed (<harness>)", "installed in
 * project (<harness>)", or "installed (global + project)" so a user
 * running setup from a project directory sees their existing project
 * install instead of being told to install fresh.
 */
async function formatSkillHint(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const cwd = findProjectRoot(process.cwd()) ?? process.cwd();
    const [global, project] = await Promise.all([
      readSkillState('global', { env, cwd, skipRemote: true }),
      readSkillState('project', { env, cwd, skipRemote: true }),
    ]);

    if (global.installed && project.installed) {
      return 'installed (global + project)';
    }
    if (global.installed) {
      const linked = global.linkedHarnesses[0];
      return linked ? `installed (${linked})` : 'installed';
    }
    if (project.installed) {
      const linked = project.linkedHarnesses[0];
      return linked ? `installed in project (${linked})` : 'installed in project';
    }
    return 'not installed';
  } catch {
    return 'not installed';
  }
}

async function completionsHint(env: NodeJS.ProcessEnv): Promise<string> {
  try {
    const state = await readCompletionsState(env);
    if (state.installed && state.shell) return `installed (${state.shell})`;
    if (state.shell) return `not installed (${state.shell} detected)`;
    return 'not installed';
  } catch {
    return 'not installed';
  }
}

function PROVIDERS_LIST_FOR_HINTS(): readonly AnyProviderSlug[] {
  return [
    'anthropic',
    'openai',
    'openrouter',
    'vercel',
    'cloudflare',
    'ollama',
    ...WEB_PROVIDERS,
    ...DATA_PROVIDERS,
  ] as const;
}

// Bring in ProviderSettings type for hint computation
type ProviderSettings = {
  enabled?: boolean;
  cache?: { enabled?: boolean; ttlDays?: number };
};

/* -------------------------------------------------------------------------- */
/*  AI defaults sub-walk                                                       */
/* -------------------------------------------------------------------------- */

async function walkAIDefaults(
  config: MarmotConfig,
  statuses: ProviderStatus[],
  env: NodeJS.ProcessEnv,
  fetchFn: typeof fetch,
): Promise<MarmotConfig | null | 'unchanged' | typeof EXIT_SETUP> {
  // Build the option labels with the current default baked in, padded to the
  // max label width so every row shows its value inline (clack only renders
  // the focused option's hint, so values would otherwise be invisible until
  // each was selected).
  const items: Array<{ value: string; label: string; current: string }> = [
    { value: AI_TEXT, label: 'Text', current: aiCurrent('text', config) },
    { value: AI_IMAGE, label: 'Image', current: aiCurrent('image', config) },
    { value: AI_VIDEO, label: 'Video', current: aiCurrent('video', config) },
    { value: AI_SPEECH, label: 'Speech', current: aiCurrent('speech', config) },
    { value: AI_TRANSCRIPTION, label: 'Transcription', current: aiCurrent('transcription', config) },
  ];
  const maxLabel = Math.max(...items.map((i) => i.label.length));
  const renderedItems = items.map((i) => ({
    value: i.value,
    label: `${i.label.padEnd(maxLabel + 4)}${i.current}`,
  }));

  const choice = await select({
    message: 'AI defaults — pick what to change',
    options: [
      ...renderedItems,
      { value: AI_BACK, label: 'Back to setup' },
      EXIT_SETUP_OPTION,
    ],
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  if (choice === AI_BACK) return 'unchanged';
  if (choice === EXIT_SETUP) return EXIT_SETUP;
  return await editMode(choice as Mode, config, statuses, env, fetchFn);
}

/** Provider + model formatted for inline display in the AI defaults menu.
 *  Uses a colon separator (provider:model) since OpenRouter / Vercel model
 *  ids contain slashes and would collide with a slash separator. Yellow
 *  "no default" when nothing is set. */
function aiCurrent(mode: Mode, config: MarmotConfig): string {
  const entry = config.defaults?.[mode];
  if (!entry?.provider) return warnText('no default');
  if (entry.model) return `${entry.provider}:${entry.model}`;
  return entry.provider;
}

async function readConfigSafely(
  env: NodeJS.ProcessEnv,
): Promise<MarmotConfig | null> {
  try {
    return await readMarmotConfig(env);
  } catch {
    // Existing file is malformed — we'll overwrite. Setup is the recovery path.
    return null;
  }
}

type PickProviderArgs = {
  purpose: 'text' | 'image' | 'speech' | 'transcription' | 'video';
  statuses: ProviderStatus[];
  fallbackHint: string;
};

async function pickProvider(
  args: PickProviderArgs,
): Promise<ProviderSlug | null | undefined> {
  if (args.statuses.length === 0) {
    note(
      `No ${args.purpose}-ready providers detected. Set the relevant API keys and re-run setup.`,
      `${args.purpose} provider`,
    );
    return undefined; // skip
  }

  const choice = await select({
    message: `Default ${args.purpose} provider`,
    options: [
      ...args.statuses.map((s) => ({
        value: s.slug,
        label: s.name,
        hint: s.capabilities.image && args.purpose === 'image' ? 'image-capable' : undefined,
      })),
      {
        value: SKIP_VALUE,
        label: `Skip — keep built-in default (${args.fallbackHint})`,
      },
    ],
  });

  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }

  if (choice === SKIP_VALUE) return undefined;
  return choice as ProviderSlug;
}

type PickModelArgs = {
  purpose: 'text' | 'image' | 'speech' | 'transcription' | 'video';
  provider: ProviderSlug;
  env: NodeJS.ProcessEnv;
  fetchFn: typeof fetch;
};

async function pickModel(args: PickModelArgs): Promise<string | null | undefined> {
  const adapter = getProviderAdapter(args.provider);
  const fetchSpin = spinner();
  fetchSpin.start(`Fetching ${adapter.name} ${args.purpose} models`);

  let modelIds: string[] = [];
  try {
    const refreshInput = {
      apiKey: getProviderApiKey(args.provider, undefined, args.env),
      cloudflareAccountId:
        args.provider === 'cloudflare' ? getCloudflareAccountId(args.env) : undefined,
      fetchFn: args.fetchFn,
    };
    // All four modalities go through the same 24h-TTL ensure path now, so
    // model lists are read from the on-disk cache when fresh and refetched
    // lazily otherwise. Symmetric across text/image/speech/transcription.
    const ensureInput = {
      provider: args.provider,
      adapter,
      ollamaBaseUrl: args.provider === 'ollama' ? getOllamaApiBaseUrl(args.env) : undefined,
      env: args.env,
      ...refreshInput,
    };
    if (args.purpose === 'text') {
      const result = await ensureProviderCache(ensureInput);
      modelIds = result.cache.models.map((m) => m.id);
    } else if (args.purpose === 'image' && adapter.refreshImageModels) {
      const result = await ensureProviderImageCache(ensureInput);
      modelIds = result.cache.models.map((m) => m.id);
    } else if (args.purpose === 'speech' && adapter.refreshSpeechModels) {
      const result = await ensureProviderSpeechCache(ensureInput);
      modelIds = result.cache.models.map((m) => m.id);
    } else if (
      args.purpose === 'transcription'
      && adapter.refreshTranscriptionModels
    ) {
      const result = await ensureProviderTranscriptionCache(ensureInput);
      modelIds = result.cache.models.map((m) => m.id);
    } else if (args.purpose === 'video' && adapter.refreshVideoModels) {
      const result = await ensureProviderVideoCache(ensureInput);
      modelIds = result.cache.models.map((m) => m.id);
    }
  } catch (error) {
    fetchSpin.stop(`Could not fetch model list (${(error as Error).message})`);
    note(
      'Falling back to the provider default. You can edit ~/.marmot/config.json by hand later.',
      'model',
    );
    return undefined;
  }
  fetchSpin.stop(`Found ${modelIds.length} ${adapter.name} models`);

  if (modelIds.length === 0) {
    return undefined;
  }

  const defaultModel = (() => {
    switch (args.purpose) {
      case 'text':
        return PROVIDER_DEFAULT_MODELS[args.provider];
      case 'image':
        return PROVIDER_IMAGE_DEFAULT_MODELS[args.provider];
      case 'speech':
        return PROVIDER_SPEECH_DEFAULT_MODELS[args.provider];
      case 'video':
        return PROVIDER_VIDEO_DEFAULT_MODELS[args.provider];
      case 'transcription':
        return PROVIDER_TRANSCRIPTION_DEFAULT_MODELS[args.provider];
    }
  })();

  let candidates = modelIds;
  if (modelIds.length > 20) {
    const filter = await text({
      message: `${modelIds.length} models. Filter? (e.g. "${defaultModel?.split(/[\\/-]/)[0] ?? 'gpt'}", or leave blank to scroll all)`,
      placeholder: '',
      initialValue: '',
    });
    if (isCancel(filter)) {
      cancel('Setup canceled.');
      return null;
    }
    const trimmed = String(filter).trim().toLowerCase();
    if (trimmed) {
      candidates = modelIds.filter((id) => id.toLowerCase().includes(trimmed));
      if (candidates.length === 0) {
        note('No matches. Showing all models instead.', 'model');
        candidates = modelIds;
      }
    }
  }

  const choice = await select({
    message: `Default ${args.purpose} model for ${adapter.name}`,
    options: [
      ...candidates.map((id) => ({
        value: id,
        label: id,
        hint: id === defaultModel ? 'recommended' : undefined,
      })),
      {
        value: SKIP_VALUE,
        label: `Skip — keep provider default (${defaultModel ?? 'none'})`,
      },
    ],
  });

  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }

  return choice as string;
}

// Re-export for tests/CLI
export { detectProviders } from '../providers/detect.js';
