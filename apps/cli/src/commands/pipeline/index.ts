/**
 * `marmot pipeline ...` subcommand handlers. Pipelines are named multi-
 * stage workflows whose steps execute as subprocesses (one per step,
 * stdin/stdout chained). The `@<name>` sigil routes here when the name
 * resolves to a pipeline.
 */
import {
  AICliError,
  deletePipeline,
  getPipeline,
  listPipelines,
  listPresets,
  renamePipeline,
  upsertPipeline,
  validatePipelineName,
  writeLine,
  type OutputWriter,
  type Pipeline,
  type PipelineStep,
} from '@marmot-sh/core';

import { renderList, renderRecord, type Column, type Section } from '../../lib/list-renderer.js';
import { resolveOutputMode, type OutputModeOptions } from '../../lib/output-mode-options.js';
import { parseStep } from './parse-step.js';
import { runPipeline } from './runner.js';

export type PipelineCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

export type PipelineWriteOptions = OutputModeOptions & {
  /** Repeatable `--step '...'` flag (commander collects into array). */
  step?: string[];
  label?: string;
};

/* -------------------------------------------------------------------- */
/* create / update                                                      */
/* -------------------------------------------------------------------- */

function buildPipelineFromOptions(opts: PipelineWriteOptions): Pipeline {
  const stepStrings = opts.step ?? [];
  if (stepStrings.length === 0) {
    throw new AICliError(
      'validation',
      'A pipeline needs at least one step. Pass --step \'<verb> [args]\' (repeatable).',
    );
  }
  const steps: PipelineStep[] = stepStrings.map((s) => parseStep(s));
  return { steps, ...(opts.label ? { label: opts.label } : {}) };
}

export async function handlePipelineCreate(
  name: string,
  options: PipelineWriteOptions,
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  validatePipelineName(name);
  const pipeline = buildPipelineFromOptions(options);
  await upsertPipeline(name, pipeline, { overwrite: false }, env);
  const stored = await getPipeline(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'create', name, pipeline: stored }, null, 2));
}

export async function handlePipelineUpdate(
  name: string,
  options: PipelineWriteOptions,
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  validatePipelineName(name);
  const existing = await getPipeline(name, env);
  // `update` replaces the whole steps array (per spec); label is also
  // overwritable but optional.
  const next: Pipeline = {
    pipeline_id: existing.pipeline_id,
    ...(options.label !== undefined ? { label: options.label } : existing.label ? { label: existing.label } : {}),
    steps: (options.step ?? []).length > 0
      ? buildPipelineFromOptions({ ...options, step: options.step }).steps
      : existing.steps,
  };
  await upsertPipeline(name, next, { overwrite: true }, env);
  const stored = await getPipeline(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'update', name, pipeline: stored }, null, 2));
}

/* -------------------------------------------------------------------- */
/* delete / rename                                                      */
/* -------------------------------------------------------------------- */

export async function handlePipelineDelete(
  name: string,
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  validatePipelineName(name);
  const removed = await deletePipeline(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'delete', name, removed }, null, 2));
}

export async function handlePipelineRename(
  oldName: string,
  newName: string,
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const result = await renamePipeline(oldName, newName, env);
  writeLine(
    stdout,
    JSON.stringify(
      { ok: true, action: 'rename', from: result.from, to: result.to, pipeline_id: result.pipeline.pipeline_id },
      null,
      2,
    ),
  );
}

/* -------------------------------------------------------------------- */
/* list / show                                                          */
/* -------------------------------------------------------------------- */

type PipelineListRow = {
  name: string;
  steps: number;
  label?: string;
};

const PIPELINE_LIST_COLUMNS: Column<PipelineListRow>[] = [
  { key: 'name', header: 'NAME' },
  { key: 'steps', header: 'STEPS', align: 'right' },
  { key: 'label', header: 'LABEL' },
];

export async function handlePipelineList(
  options: OutputModeOptions = {},
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const pipelines = await listPipelines(env);
  const rows: PipelineListRow[] = Object.keys(pipelines)
    .sort()
    .map((name) => {
      const p = pipelines[name]!;
      return {
        name,
        steps: p.steps.length,
        label: p.label,
      };
    });
  const mode = resolveOutputMode(options, stdout as NodeJS.WriteStream);
  writeLine(
    stdout,
    renderList({
      rows,
      columns: PIPELINE_LIST_COLUMNS,
      mode,
      envelopeKey: 'pipelines',
      emptyMessage: 'No pipelines configured. Run `marmot pipeline create` to add one.',
    }),
  );
}

export async function handlePipelineShow(
  name: string,
  options: OutputModeOptions = {},
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;
  const pipeline = await getPipeline(name, env);
  const mode = resolveOutputMode(options, stdout as NodeJS.WriteStream);

  if (mode === 'json') {
    writeLine(stdout, JSON.stringify({ name, pipeline }, null, 2));
    return;
  }

  // Format steps as a numbered list for human / markdown.
  const stepLines = pipeline.steps.map((s, i) => {
    const desc = 'preset' in s
      ? `@${s.preset}${s.args ? ` ${s.args}` : ''}`
      : `${s.verb}${s.args ? ` ${s.args}` : ''}${s.prompt ? ` --prompt "${s.prompt}"` : ''}`;
    return `${i + 1}. ${desc}`;
  });

  const flat: Record<string, unknown> = {
    name,
    pipeline_id: pipeline.pipeline_id,
    label: pipeline.label,
    steps: stepLines.join('\n'),
  };
  const sections: Section<typeof flat>[] = [
    { title: 'Identity', keys: ['name', 'pipeline_id', 'label'] },
    { title: 'Steps', keys: ['steps'] },
  ];
  writeLine(
    stdout,
    renderRecord({
      record: flat,
      mode,
      envelopeKey: 'pipeline',
      sections,
      title: `Pipeline "${name}"`,
    }),
  );
}

/* -------------------------------------------------------------------- */
/* run                                                                  */
/* -------------------------------------------------------------------- */

export type PipelineRunOptions = {
  /** Used for tests to inject a fake spawn. */
  spawnFn?: import('./runner.js').SpawnFn;
};

export async function handlePipelineRun(
  name: string,
  positional: readonly string[],
  options: PipelineRunOptions = {},
  deps: PipelineCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const pipeline = await getPipeline(name, env);
  // Refuse if a preset with the same name shadows it (defensive — should
  // be rejected at create time, but configs can be hand-edited).
  const presets = await listPresets(env);
  if (presets[name]) {
    throw new AICliError(
      'validation',
      `Both a pipeline and a preset are named "${name}" — the @-sigil collision was likely introduced by a hand-edited config. Rename one before continuing.`,
    );
  }
  await runPipeline({
    pipeline,
    positional,
    name,
    env,
    spawnFn: options.spawnFn,
  });
}
