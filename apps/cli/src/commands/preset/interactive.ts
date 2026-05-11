/**
 * Interactive preset create/update walks. Triggered when the user runs
 * `marmot preset create` or `marmot preset update <name>` with no field
 * flags on a TTY. Driven by the per-mode field descriptor table so any
 * new field automatically appears in the walk without touching this file.
 */
import { stat as fsStat } from 'node:fs/promises';

import ansis from 'ansis';
import {
  autocomplete,
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  text,
} from '@clack/prompts';

import {
  AICliError,
  DATA_PROVIDERS,
  PRESET_MODES,
  PROVIDERS,
  listProviderReadiness,
  presetSchema,
  readMarmotConfig,
  readProviderCache,
  readProviderImageCache,
  readProviderSpeechCache,
  readProviderTranscriptionCache,
  readProviderVideoCache,
  upsertPreset,
  validatePresetName,
  writeLine,
  type DataProviderSlug,
  type OutputWriter,
  type Preset,
  type PresetMode,
  type ProviderSlug,
  type WebProviderSlug,
} from '@marmot-sh/core';
import { getProviderAdapter } from '../../providers/index.js';
import { providersForVerb } from '../../providers/web-capabilities.js';

import { MODE_FIELDS, type FieldDescriptor } from './field-descriptors.js';

const MODE_LABELS: Record<PresetMode, string> = {
  text: 'text → marmot run (default verb)',
  image: 'image → marmot image',
  speech: 'speech → marmot speak',
  transcription: 'transcription → marmot transcribe',
  video: 'video → marmot video',
  search: 'search → marmot search',
  scrape: 'scrape → marmot scrape',
  answer: 'answer → marmot answer',
  map: 'map → marmot map',
  crawl: 'crawl → marmot crawl',
  research: 'research → marmot research',
  findall: 'findall → marmot findall',
  enrich: 'enrich → marmot enrich',
  lookup: 'lookup → marmot lookup',
  verify: 'verify → marmot verify',
};

type CancelToken = ReturnType<typeof cancel>;
function bail(reason: string): never {
  cancel(reason);
  // clack's cancel() doesn't exit; we throw a sentinel handled by the caller.
  throw new InteractiveCancelled(reason);
}
class InteractiveCancelled extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InteractiveCancelled';
  }
}

/**
 * Build a clack `message` from a descriptor. Format:
 *
 *   <Label> [(suffix)]
 *     <help text>
 *
 * The help line is dimmed-italic via terminal-friendly styling so it
 * reads as guidance, not a heading. Setup commands use the same shape.
 */
function buildMessage(desc: FieldDescriptor, suffix?: string): string {
  const head = suffix ? `${desc.label} ${suffix}` : desc.label;
  if (!desc.help) return head;
  // Indented dimmed help line under the label.
  return `${head}\n  ${ansis.dim(desc.help)}`;
}

/**
 * True when this descriptor's `appliesTo` allows the currently-chosen
 * provider. When `appliesTo` is undefined, the field applies universally
 * for the mode. When the provider hasn't been chosen yet (user skipped),
 * we err on the side of showing the field — they may still want to bake
 * the value, even if the matrix annotation isn't relevant yet.
 */
function fieldAppliesToCurrentProvider(
  desc: FieldDescriptor,
  out: Record<string, unknown>,
): boolean {
  if (!desc.appliesTo) return true;
  const provider = typeof out.provider === 'string' ? out.provider : undefined;
  if (!provider) return true;
  return desc.appliesTo.includes(provider);
}

/**
 * Pick a useful placeholder. Precedence:
 * 1. `current: <value>` when updating an existing preset — the user
 *    needs to see what they have so they can choose to keep it.
 * 2. Explicit example placeholder (e.g. "site:linkedin.com").
 * 3. Generic "skip" hint.
 */
function placeholderFor(desc: FieldDescriptor, currentValue?: string): string {
  if (currentValue) return `current: ${currentValue}`;
  if (desc.placeholder) return desc.placeholder;
  return 'skip (press Enter)';
}

/** Prompt a string. Empty input means "skip" (returns undefined). */
async function promptString(desc: FieldDescriptor, currentValue?: string): Promise<string | undefined> {
  while (true) {
    const result = await text({
      message: buildMessage(desc),
      placeholder: placeholderFor(desc, currentValue),
      initialValue: '',
    });
    if (isCancel(result)) bail('Cancelled.');
    const trimmed = (result as string).trim();
    if (trimmed.length === 0) return currentValue;
    if (desc.pattern && !desc.pattern.test(trimmed)) {
      note(desc.patternHint ?? `"${trimmed}" doesn't match the expected format. Try again.`);
      continue;
    }
    return trimmed;
  }
}

/** Prompt a number. Re-prompts on parse failure or out-of-range. */
async function promptNumber(
  desc: FieldDescriptor,
  kind: 'int' | 'float',
  currentValue?: number,
): Promise<number | undefined> {
  while (true) {
    const rangeHint =
      desc.min !== undefined && desc.max !== undefined
        ? `(${desc.min}–${desc.max})`
        : desc.min !== undefined
          ? `(≥ ${desc.min})`
          : desc.max !== undefined
            ? `(≤ ${desc.max})`
            : '';
    // Same precedence as placeholderFor: current value wins, then example,
    // then generic skip hint.
    const placeholder =
      currentValue !== undefined
        ? `current: ${currentValue}`
        : (desc.placeholder ?? 'skip (press Enter)');
    const result = await text({
      message: buildMessage(desc, rangeHint),
      placeholder,
      initialValue: '',
    });
    if (isCancel(result)) bail('Cancelled.');
    const raw = (result as string).trim();
    if (raw.length === 0) return currentValue;
    const n = kind === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (!Number.isFinite(n)) {
      note(`"${raw}" is not a valid ${kind === 'int' ? 'integer' : 'number'}. Try again.`);
      continue;
    }
    if (kind === 'int' && !Number.isInteger(n)) {
      note(`"${raw}" must be an integer (no decimals). Try again.`);
      continue;
    }
    if (desc.min !== undefined && n < desc.min) {
      note(`Value must be ≥ ${desc.min}. Try again.`);
      continue;
    }
    if (desc.max !== undefined && n > desc.max) {
      note(`Value must be ≤ ${desc.max}. Try again.`);
      continue;
    }
    return n;
  }
}

/**
 * Prompt a filesystem path. Behaves like promptString, but if the user
 * provides an absolute or `~`-expanded path, we soft-check existence
 * and warn if it isn't found. We allow the user to proceed since
 * preset paths resolve at use time (a path can be valid at runtime
 * from a different cwd than the one the prompt was answered from).
 */
async function promptPath(desc: FieldDescriptor, currentValue?: string): Promise<string | undefined> {
  while (true) {
    const result = await text({
      message: buildMessage(desc),
      placeholder: placeholderFor(desc, currentValue),
      initialValue: '',
    });
    if (isCancel(result)) bail('Cancelled.');
    const trimmed = (result as string).trim();
    if (trimmed.length === 0) return currentValue;

    // Soft existence check — only meaningful for absolute/`~` paths.
    // Relative paths resolve cwd-at-runtime, which can differ from now.
    if (trimmed.startsWith('/') || trimmed.startsWith('~')) {
      const expanded = trimmed.startsWith('~')
        ? `${process.env.HOME ?? ''}${trimmed.slice(1)}`
        : trimmed;
      try {
        const stat = await fsStat(expanded);
        if (!stat.isFile()) {
          note(`"${trimmed}" exists but isn't a regular file.`);
          const ok = await confirm({ message: 'Use it anyway?', initialValue: false });
          if (isCancel(ok) || !ok) continue;
        }
      } catch {
        note(`"${trimmed}" doesn't appear to exist (checked at create time, may be valid at use time).`);
        const ok = await confirm({ message: 'Use this path anyway?', initialValue: true });
        if (isCancel(ok) || !ok) continue;
      }
    }
    return trimmed;
  }
}

/** Three-way bool: enable / disable / skip-or-keep. */
async function promptBool(desc: FieldDescriptor, currentValue?: boolean): Promise<boolean | undefined> {
  const skipLabel = currentValue === undefined ? 'Skip (use runtime default)' : `Keep current (${currentValue})`;
  const result = await select({
    message: buildMessage(desc),
    options: [
      { value: 'true', label: 'Enable (true)' },
      { value: 'false', label: 'Disable (false)' },
      { value: 'skip', label: skipLabel },
    ],
    initialValue: 'skip',
  });
  if (isCancel(result)) bail('Cancelled.');
  if (result === 'true') return true;
  if (result === 'false') return false;
  return currentValue;
}

/** Pick from a fixed enum. */
async function promptEnum(desc: FieldDescriptor, currentValue?: string): Promise<string | undefined> {
  const options = [
    { value: '__skip__', label: currentValue ? `Keep current (${currentValue})` : 'Skip' },
    ...(desc.enumValues ?? []).map((v) => ({ value: v, label: v })),
  ];
  const result = await select({
    message: buildMessage(desc),
    options,
    initialValue: '__skip__',
  });
  if (isCancel(result)) bail('Cancelled.');
  if (result === '__skip__') return currentValue;
  return result as string;
}

/**
 * List of strings. Create flow: loop reading entries until empty input.
 * Update flow: ask Keep / Replace / Append, then loop accordingly.
 */
async function promptList(desc: FieldDescriptor, currentValue?: string[]): Promise<string[] | undefined> {
  type ListMode = 'replace' | 'append' | 'keep';
  let listMode: ListMode = 'replace';
  if (currentValue && currentValue.length > 0) {
    const choice = await select({
      message: buildMessage(desc, `(currently ${currentValue.length} entries)`),
      options: [
        { value: 'keep', label: `Keep current (${currentValue.length})` },
        { value: 'append', label: 'Append more entries' },
        { value: 'replace', label: 'Replace entirely' },
      ],
      initialValue: 'keep',
    });
    if (isCancel(choice)) bail('Cancelled.');
    listMode = choice as ListMode;
    if (listMode === 'keep') return currentValue;
  }

  const collected: string[] = listMode === 'append' && currentValue ? [...currentValue] : [];
  // Mention "one per entry" only on the first prompt — once is enough; the
  // pattern is obvious by entry 2.
  for (let i = 1; ; i++) {
    const suffix = i === 1
      ? '— entry 1 (one per entry; press Enter on an empty entry to finish)'
      : `— entry ${i}`;
    const result = await text({
      message: buildMessage(desc, suffix),
      placeholder: desc.placeholder,
      initialValue: '',
    });
    if (isCancel(result)) bail('Cancelled.');
    const trimmed = (result as string).trim();
    if (trimmed.length === 0) break;
    collected.push(trimmed);
  }
  if (collected.length === 0) return undefined;
  return collected;
}

/**
 * Valid provider slugs for the given preset mode. AI modes filter
 * PROVIDERS by `adapter.capabilities.<modality>`. Web modes use
 * providersForVerb. Data modes return the full DATA_PROVIDERS pool —
 * fine-grained filtering happens later via the `type` field.
 */
function validProvidersForMode(
  mode: PresetMode,
): readonly (ProviderSlug | WebProviderSlug | DataProviderSlug)[] {
  switch (mode) {
    case 'text':
      return PROVIDERS.filter((p) => getProviderAdapter(p).capabilities.text);
    case 'image':
      return PROVIDERS.filter((p) => getProviderAdapter(p).capabilities.image);
    case 'speech':
      return PROVIDERS.filter((p) => getProviderAdapter(p).capabilities.speech);
    case 'transcription':
      return PROVIDERS.filter((p) => getProviderAdapter(p).capabilities.transcription);
    case 'video':
      return PROVIDERS.filter((p) => Boolean(getProviderAdapter(p).capabilities.video));
    case 'search':
    case 'scrape':
    case 'answer':
    case 'map':
    case 'crawl':
    case 'research':
    case 'findall':
      return providersForVerb(mode) as readonly WebProviderSlug[];
    case 'enrich':
    case 'lookup':
    case 'verify':
      return DATA_PROVIDERS;
  }
}

/** Read the appropriate model cache for an AI mode + provider, or null. */
async function readModelsForMode(
  mode: PresetMode,
  provider: ProviderSlug,
  env: NodeJS.ProcessEnv,
): Promise<{ id: string; name: string }[] | null> {
  let cache;
  switch (mode) {
    case 'text':
      cache = await readProviderCache(provider, env).catch(() => null);
      break;
    case 'image':
      cache = await readProviderImageCache(provider, env).catch(() => null);
      break;
    case 'speech':
      cache = await readProviderSpeechCache(provider, env).catch(() => null);
      break;
    case 'transcription':
      cache = await readProviderTranscriptionCache(provider, env).catch(() => null);
      break;
    case 'video':
      cache = await readProviderVideoCache(provider, env).catch(() => null);
      break;
    default:
      return null;
  }
  if (!cache || !cache.models?.length) return null;
  return cache.models.map((m) => ({ id: m.id, name: m.name }));
}

/** Provider select with readiness indicators. */
async function promptProvider(
  mode: PresetMode,
  current: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const valid = validProvidersForMode(mode);
  const config = await readMarmotConfig(env).catch(() => null);
  const readiness = listProviderReadiness(config, env);

  type Option = { value: string; label: string; hint?: string };
  const options: Option[] = [
    {
      value: '__skip__',
      label: current ? `Keep current (${current})` : 'Skip (use configured default)',
    },
  ];
  // Sort: ready first, then unready, alphabetically within each group.
  const ready = valid.filter((p) => readiness.get(p)?.ready);
  const unready = valid.filter((p) => !readiness.get(p)?.ready);
  for (const p of [...ready, ...unready].sort()) {
    const r = readiness.get(p);
    let marker = '';
    if (r?.ready) marker = '✓';
    else if (r && !r.enabled) marker = '⏸ disabled';
    else if (r && r.keys.some((k) => !k.set)) {
      const missing = r.keys.filter((k) => !k.set).map((k) => k.env).join(', ');
      marker = `⚠ no ${missing}`;
    } else marker = '⚠ not ready';
    options.push({ value: p, label: `${p}`, hint: marker });
  }
  options.push({ value: '__custom__', label: 'Other / type a custom value' });

  const result = await select({
    message: `Provider\n  ${ansis.dim('Which API service this preset uses. Ready providers (✓) have credentials configured; ⚠ ones don\'t.')}`,
    options,
    initialValue: current && valid.includes(current as ProviderSlug & WebProviderSlug & DataProviderSlug) ? current : '__skip__',
  });
  if (isCancel(result)) bail('Cancelled.');
  if (result === '__skip__') return current;
  if (result === '__custom__') {
    const free = await text({
      message: 'Provider slug (custom)',
      initialValue: '',
    });
    if (isCancel(free)) bail('Cancelled.');
    const trimmed = (free as string).trim();
    return trimmed.length > 0 ? trimmed : current;
  }
  return result as string;
}

/** Model select from the provider's cached model list, or fallback to text. */
async function promptModel(
  mode: PresetMode,
  provider: string | undefined,
  current: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  // Without a provider chosen we can't load the cache. Fall back to text.
  if (!provider || !PROVIDERS.includes(provider as ProviderSlug)) {
    return promptString(
      { key: 'model', flag: 'model', type: 'string', label: 'Model id', help: '' } as FieldDescriptor,
      current,
    );
  }
  const models = await readModelsForMode(mode, provider as ProviderSlug, env);
  if (!models || models.length === 0) {
    note(
      `No cached models for "${provider}". Run \`marmot cache refresh ${provider}\` to populate, or type the model id below.`,
    );
    return promptString(
      { key: 'model', flag: 'model', type: 'string', label: 'Model id', help: '' } as FieldDescriptor,
      current,
    );
  }

  const sortedModels = [...models].sort((a, b) =>
    a.id.toLowerCase().localeCompare(b.id.toLowerCase()),
  );

  const options = [
    {
      value: '__skip__',
      label: current ? `Keep current (${current})` : 'Skip (use provider default)',
    },
    ...sortedModels.map((m) => ({
      value: m.id,
      label: m.id,
      hint: m.name && m.name !== m.id ? m.name : undefined,
    })),
    { value: '__custom__', label: 'Other / type a custom value' },
  ];

  const result = await autocomplete({
    message: `Model\n  ${ansis.dim('Type to filter. Picked from the cached model list for this provider. Pick "Other" to type a custom id.')}`,
    options,
    initialValue:
      current && sortedModels.some((m) => m.id === current) ? current : '__skip__',
    maxItems: 10,
  });
  if (isCancel(result)) bail('Cancelled.');
  // `autocomplete` returns the selected value as a single-element array.
  const picked = Array.isArray(result) ? (result[0] as string) : (result as string);
  if (picked === '__skip__') return current;
  if (picked === '__custom__') {
    const free = await text({ message: 'Model id (custom)', initialValue: '' });
    if (isCancel(free)) bail('Cancelled.');
    const trimmed = (free as string).trim();
    return trimmed.length > 0 ? trimmed : current;
  }
  return picked;
}

/** Run one field's prompt based on its descriptor type. */
async function runFieldPrompt(
  desc: FieldDescriptor,
  current: Record<string, unknown>,
  ctx: { mode: PresetMode; env: NodeJS.ProcessEnv },
): Promise<unknown> {
  const cur = current[desc.key];

  // Provider and model are dynamic-list selects, not free-text.
  if (desc.key === 'provider') {
    return promptProvider(ctx.mode, typeof cur === 'string' ? cur : undefined, ctx.env);
  }
  if (desc.key === 'model') {
    const provider =
      typeof current.provider === 'string' ? (current.provider as string) : undefined;
    return promptModel(ctx.mode, provider, typeof cur === 'string' ? cur : undefined, ctx.env);
  }

  switch (desc.type) {
    case 'string':
      return promptString(desc, typeof cur === 'string' ? cur : undefined);
    case 'path':
      return promptPath(desc, typeof cur === 'string' ? cur : undefined);
    case 'number-int':
      return promptNumber(desc, 'int', typeof cur === 'number' ? cur : undefined);
    case 'number-float':
      return promptNumber(desc, 'float', typeof cur === 'number' ? cur : undefined);
    case 'bool':
      return promptBool(desc, typeof cur === 'boolean' ? cur : undefined);
    case 'enum':
      return promptEnum(desc, typeof cur === 'string' ? cur : undefined);
    case 'list-string':
      return promptList(desc, Array.isArray(cur) ? (cur as string[]) : undefined);
  }
}

/**
 * Walk a mutually-exclusive group of fields. Asks "which one (if any)?"
 * and only walks the chosen branch. The remaining group members in
 * `current` are dropped from the output so the schema's strict() unions
 * stay clean.
 */
async function runGroup(
  groupKey: string,
  members: FieldDescriptor[],
  current: Record<string, unknown>,
  out: Record<string, unknown>,
  ctx: { mode: PresetMode; env: NodeJS.ProcessEnv },
): Promise<void> {
  const currentMember = members.find((m) => current[m.key] !== undefined);
  const choice = await select({
    message: `${groupKey === 'structured-output' ? 'Structured output' : groupKey}? Pick one or none.`,
    options: [
      { value: '__none__', label: currentMember ? 'Drop / no structured output' : 'No' },
      ...members.map((m) => ({
        value: m.key,
        label:
          currentMember?.key === m.key
            ? `${m.label} (currently set)`
            : m.label,
      })),
    ],
    initialValue: currentMember?.key ?? '__none__',
  });
  if (isCancel(choice)) bail('Cancelled.');

  if (choice === '__none__') {
    // Make sure no group member leaks into output.
    for (const m of members) delete out[m.key];
    return;
  }
  const picked = members.find((m) => m.key === (choice as string));
  if (!picked) return;
  // Drop other group members from output.
  for (const m of members) {
    if (m.key !== picked.key) delete out[m.key];
  }
  const value = await runFieldPrompt(picked, out, ctx);
  if (value !== undefined) out[picked.key] = value;
}

/**
 * Core walk over a mode's fields. `current` provides per-field defaults
 * (used by the update flow). Returns a candidate object suitable for
 * presetSchema.parse().
 */
async function walkMode(
  mode: PresetMode,
  current: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const fields = MODE_FIELDS[mode];
  const out: Record<string, unknown> = { mode };
  // Carry over any current values we haven't re-prompted yet, so a user
  // who skips everything on update gets a no-op.
  for (const k of Object.keys(current)) {
    if (k === 'mode' || k === 'preset_id') continue;
    out[k] = current[k];
  }

  const ctx = { mode, env };

  // Group fields by their `group` (if any) to support mutual exclusion.
  const groups = new Map<string, FieldDescriptor[]>();
  const ungrouped: FieldDescriptor[] = [];
  for (const f of fields) {
    if (f.group) {
      const list = groups.get(f.group) ?? [];
      list.push(f);
      groups.set(f.group, list);
    } else {
      ungrouped.push(f);
    }
  }

  // Walk ungrouped fields in declaration order. Pass `out` as the live
  // state so prompts that depend on earlier choices (e.g. `model` on the
  // chosen `provider`) see the user's just-picked value. Skip fields
  // whose `appliesTo` excludes the currently-chosen provider — showing a
  // freshness select for a Parallel preset would just be misleading.
  for (const f of ungrouped) {
    if (!fieldAppliesToCurrentProvider(f, out)) continue;
    const value = await runFieldPrompt(f, out, ctx);
    if (value === undefined) {
      // For create, undefined means "skip — drop the field".
      // For update, undefined keeps the carried-over value already in `out`.
      continue;
    }
    out[f.key] = value;
  }

  // Walk groups (currently just structured-output). Groups inherit the
  // same provider-applicability filter — if every member is filtered out,
  // skip the group selector too.
  for (const [groupKey, members] of groups) {
    const applicable = members.filter((m) => fieldAppliesToCurrentProvider(m, out));
    if (applicable.length === 0) continue;
    await runGroup(groupKey, applicable, current, out, ctx);
  }

  // Strip undefined.
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

function ensureTty(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new AICliError(
      'validation',
      'Interactive preset creation needs a TTY. Either run from a terminal or pass --mode and field flags directly.',
    );
  }
}

async function pickName(initial?: string): Promise<string> {
  if (initial) {
    validatePresetName(initial);
    return initial;
  }
  while (true) {
    const result = await text({
      message: 'Preset name',
      placeholder: 'e.g. tech-search, code-review, daily-digest',
      validate: (v) => {
        const trimmed = (v ?? '').trim();
        if (trimmed.length === 0) return 'Name is required.';
        try {
          validatePresetName(trimmed);
          return undefined;
        } catch (e) {
          return e instanceof Error ? e.message : 'Invalid name.';
        }
      },
    });
    if (isCancel(result)) bail('Cancelled.');
    return (result as string).trim();
  }
}

async function pickMode(): Promise<PresetMode> {
  const result = await select({
    message: 'Mode (which verb is this preset for?)',
    options: PRESET_MODES.map((m) => ({ value: m, label: MODE_LABELS[m] })),
    initialValue: 'text',
  });
  if (isCancel(result)) bail('Cancelled.');
  return result as PresetMode;
}

export type InteractiveCreateDeps = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

/** Interactive `marmot preset create`. */
export async function runInteractiveCreate(
  initialName: string | undefined,
  deps: InteractiveCreateDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  ensureTty();
  intro('Create a new marmot preset');

  try {
    const name = await pickName(initialName);
    const mode = await pickMode();

    note(`Walking ${mode}-mode fields. Press Enter on any prompt to skip.`);

    const candidate = await walkMode(mode, {}, env);

    const parsed = presetSchema.safeParse(candidate);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      throw new AICliError('validation', `Invalid preset: ${detail}.`);
    }

    note(JSON.stringify(parsed.data, null, 2), 'Preview');

    const ok = await confirm({ message: 'Save this preset?', initialValue: true });
    if (isCancel(ok) || !ok) bail('Discarded.');

    await upsertPreset(name, parsed.data, { overwrite: false }, env);
    outro(`Saved preset "${name}".`);
    writeLine(stdout, JSON.stringify({ ok: true, action: 'create', name, preset: parsed.data }, null, 2));
  } catch (err) {
    if (err instanceof InteractiveCancelled) {
      // clack already printed the cancel message; exit non-zero quietly.
      process.exit(1);
    }
    throw err;
  }
}

export type InteractiveUpdateDeps = InteractiveCreateDeps;

/** Interactive `marmot preset update <name>`. Loads the existing preset
 *  and walks its fields with current values shown as defaults. */
export async function runInteractiveUpdate(
  name: string,
  current: Preset,
  deps: InteractiveUpdateDeps = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  ensureTty();
  intro(`Update preset "${name}" (mode: ${current.mode})`);

  try {
    const candidate = await walkMode(
      current.mode,
      current as unknown as Record<string, unknown>,
      env,
    );

    // preset_id stays stable across updates.
    if ('preset_id' in current) {
      candidate.preset_id = (current as { preset_id?: string }).preset_id;
    }

    const parsed = presetSchema.safeParse(candidate);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ');
      throw new AICliError('validation', `Invalid preset: ${detail}.`);
    }

    note(JSON.stringify(parsed.data, null, 2), 'Updated preset');

    const ok = await confirm({ message: 'Save these changes?', initialValue: true });
    if (isCancel(ok) || !ok) bail('Discarded.');

    await upsertPreset(name, parsed.data, { overwrite: true }, env);
    outro(`Updated preset "${name}".`);
    writeLine(stdout, JSON.stringify({ ok: true, action: 'update', name, preset: parsed.data }, null, 2));
  } catch (err) {
    if (err instanceof InteractiveCancelled) {
      process.exit(1);
    }
    throw err;
  }
}

// Re-export so callers can do `try { ... } catch (e) { if (e instanceof InteractiveCancelled) ... }`.
export { InteractiveCancelled };
// Suppress an unused-import warning.
export type _ClackTokenForCallers = CancelToken;
