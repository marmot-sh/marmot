/**
 * Interactive preset create/update walks. Triggered when the user runs
 * `marmot preset create` or `marmot preset update <name>` with no field
 * flags on a TTY. Driven by the per-mode field descriptor table so any
 * new field automatically appears in the walk without touching this file.
 */
import {
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
  PRESET_MODES,
  presetSchema,
  upsertPreset,
  validatePresetName,
  writeLine,
  type OutputWriter,
  type Preset,
  type PresetMode,
} from '@marmot-sh/core';

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

/** Prompt a string. Empty input means "skip" (returns undefined). */
async function promptString(desc: FieldDescriptor, currentValue?: string): Promise<string | undefined> {
  const placeholder = currentValue ? `current: ${currentValue}` : 'skip';
  const result = await text({
    message: desc.label,
    placeholder,
    initialValue: '',
  });
  if (isCancel(result)) bail('Cancelled.');
  const trimmed = (result as string).trim();
  if (trimmed.length === 0) return currentValue; // empty → keep current (or undefined for create)
  return trimmed;
}

/** Prompt a number. Re-prompts on parse failure. */
async function promptNumber(
  desc: FieldDescriptor,
  kind: 'int' | 'float',
  currentValue?: number,
): Promise<number | undefined> {
  while (true) {
    const result = await text({
      message: desc.label,
      placeholder: currentValue !== undefined ? `current: ${currentValue}` : 'skip',
      initialValue: '',
    });
    if (isCancel(result)) bail('Cancelled.');
    const raw = (result as string).trim();
    if (raw.length === 0) return currentValue;
    const n = kind === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
    note(`"${raw}" is not a valid ${kind === 'int' ? 'integer' : 'number'}. Try again.`);
  }
}

/** Three-way bool: enable / disable / skip-or-keep. */
async function promptBool(desc: FieldDescriptor, currentValue?: boolean): Promise<boolean | undefined> {
  const skipLabel = currentValue === undefined ? 'Skip (use runtime default)' : `Keep current (${currentValue})`;
  const result = await select({
    message: desc.label,
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
    message: desc.label,
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
      message: `${desc.label} (currently ${currentValue.length} entries)`,
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
  for (let i = 1; ; i++) {
    const result = await text({
      message: `${desc.label} — entry ${i} (empty to finish)`,
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

/** Run one field's prompt based on its descriptor type. */
async function runFieldPrompt(
  desc: FieldDescriptor,
  current: Record<string, unknown>,
): Promise<unknown> {
  const cur = current[desc.key];
  switch (desc.type) {
    case 'string':
    case 'path':
      return promptString(desc, typeof cur === 'string' ? cur : undefined);
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
  const value = await runFieldPrompt(picked, current);
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
): Promise<Record<string, unknown>> {
  const fields = MODE_FIELDS[mode];
  const out: Record<string, unknown> = { mode };
  // Carry over any current values we haven't re-prompted yet, so a user
  // who skips everything on update gets a no-op.
  for (const k of Object.keys(current)) {
    if (k === 'mode' || k === 'preset_id') continue;
    out[k] = current[k];
  }

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

  // Walk ungrouped fields in declaration order.
  for (const f of ungrouped) {
    const value = await runFieldPrompt(f, current);
    if (value === undefined) {
      // For create, undefined means "skip — drop the field".
      // For update, undefined could also mean "user cleared an existing value";
      // we approximate by leaving the existing carry-over in place. The walker
      // can't distinguish "skip" from "clear" via the same affordance — we
      // bias toward keep, matching the placeholder-based prompt UX.
      continue;
    }
    out[f.key] = value;
  }

  // Walk groups (currently just structured-output).
  for (const [groupKey, members] of groups) {
    await runGroup(groupKey, members, current, out);
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

    const candidate = await walkMode(mode, {});

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
