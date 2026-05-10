/**
 * CRUD helpers for pipelines — named multi-stage workflows persisted in
 * the marmot config. Mirrors the shape of `presets.ts` so consumers
 * have a familiar API. The `@<name>` sigil routes to a pipeline first;
 * if no pipeline matches, it falls back to a preset (handled in the
 * CLI layer, not here).
 */
import { randomUUID } from 'node:crypto';

import { AICliError } from './errors.js';
import { readMarmotConfig, writeMarmotConfig } from './config.js';
import { listPresets } from './presets.js';
import {
  PIPELINE_NAME_REGEX,
  marmotConfigSchema,
  pipelineSchema,
  type MarmotConfig,
  type Pipeline,
} from '../schemas/config.js';

export type PipelineInput = Omit<Pipeline, 'pipeline_id'> & { pipeline_id?: string };

export function validatePipelineName(name: string): void {
  if (!PIPELINE_NAME_REGEX.test(name)) {
    throw new AICliError(
      'validation',
      `Invalid pipeline name "${name}". Names must be lowercase letters/digits with single - or _ separators (no leading, trailing, or consecutive separators).`,
    );
  }
}

export async function listPipelines(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, Pipeline>> {
  const config = await readMarmotConfig(env);
  return config?.pipelines ?? {};
}

export async function getPipeline(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Pipeline> {
  validatePipelineName(name);
  const pipelines = await listPipelines(env);
  const pipeline = pipelines[name];
  if (!pipeline) {
    throw new AICliError(
      'validation',
      `Pipeline "${name}" not found. Run "marmot pipeline list" to see available pipelines.`,
    );
  }
  return pipeline;
}

export type UpsertPipelineOptions = {
  /** When false (default), refuse to overwrite an existing pipeline. */
  overwrite?: boolean;
};

export async function upsertPipeline(
  name: string,
  pipeline: PipelineInput,
  options: UpsertPipelineOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<MarmotConfig> {
  validatePipelineName(name);
  const existing = (await readMarmotConfig(env)) ?? { version: 1 as const };
  const pipelines = { ...(existing.pipelines ?? {}) };
  const inputId = pipeline.pipeline_id ?? pipelines[name]?.pipeline_id ?? randomUUID();
  const validated = pipelineSchema.parse({ ...pipeline, pipeline_id: inputId } as Pipeline);

  if (pipelines[name] && !options.overwrite) {
    throw new AICliError(
      'validation',
      `Pipeline "${name}" already exists. Pass { overwrite: true } or use the update command.`,
    );
  }

  // Reject collision with an existing preset name. The `@<name>` sigil
  // resolution prefers pipelines, so a collision would silently shadow
  // a preset — surface it now instead.
  const presets = await listPresets(env);
  if (presets[name]) {
    throw new AICliError(
      'validation',
      `A preset named "${name}" already exists. The @-sigil would collide; choose a different pipeline name or rename the preset first.`,
    );
  }

  pipelines[name] = validated;
  const merged = marmotConfigSchema.parse({ ...existing, pipelines });
  await writeMarmotConfig(merged, env);
  return merged;
}

/**
 * Rename a pipeline. The `pipeline_id` stays stable so any future
 * referencing-by-id stays valid.
 */
export async function renamePipeline(
  oldSlug: string,
  newSlug: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ from: string; to: string; pipeline: Pipeline }> {
  validatePipelineName(oldSlug);
  validatePipelineName(newSlug);

  if (oldSlug === newSlug) {
    throw new AICliError('validation', `Old and new pipeline names are identical ("${oldSlug}").`);
  }

  const existing = await readMarmotConfig(env);
  const pipelines = existing?.pipelines;
  if (!pipelines || !pipelines[oldSlug]) {
    throw new AICliError(
      'validation',
      `Pipeline "${oldSlug}" not found. Run "marmot pipeline list" to see available pipelines.`,
    );
  }
  if (pipelines[newSlug]) {
    throw new AICliError(
      'validation',
      `Pipeline "${newSlug}" already exists. Pick a different name or "marmot pipeline delete ${newSlug}" first.`,
    );
  }
  // Reject preset collision on the new slug.
  const presets = await listPresets(env);
  if (presets[newSlug]) {
    throw new AICliError(
      'validation',
      `A preset named "${newSlug}" already exists. Pick a different name or rename the preset first.`,
    );
  }

  const pipeline = pipelines[oldSlug];
  const next = { ...pipelines, [newSlug]: pipeline };
  delete next[oldSlug];

  const merged = marmotConfigSchema.parse({ ...existing, pipelines: next });
  await writeMarmotConfig(merged, env);
  return { from: oldSlug, to: newSlug, pipeline };
}

export async function deletePipeline(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  validatePipelineName(name);
  const existing = await readMarmotConfig(env);
  if (!existing?.pipelines?.[name]) return false;

  const pipelines = { ...existing.pipelines };
  delete pipelines[name];
  const merged = marmotConfigSchema.parse({ ...existing, pipelines });
  await writeMarmotConfig(merged, env);
  return true;
}
