/**
 * Pipeline runner. Executes each step as a child `marmot` subprocess,
 * piping stdout of step N into stdin of step N+1. Final step's stdout
 * is the user's stdout.
 *
 * Subprocess (vs in-process) keeps the runtime simple: each step gets
 * its own provider auth, retry behavior, and output formatting, exactly
 * as if the user typed the equivalent shell pipe. Tests stub the
 * spawner to avoid hitting real APIs.
 */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

import {
  AICliError,
  getPreset,
  type Pipeline,
  type PipelineStep,
} from '@marmot-sh/core';

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type RunPipelineOptions = {
  pipeline: Pipeline;
  /** Positional arguments passed by the user at runtime. Resolves
   *  ${input}, ${1}, ${2}, ${input?}, ${N?}. */
  positional: readonly string[];
  /** Name of the executable to spawn for each step. Defaults to
   *  process.argv0 so a `marmot-dev` invocation chains to itself. */
  command?: string;
  /** Process env passed to each child. Defaults to current process.env. */
  env?: NodeJS.ProcessEnv;
  /** Spawn injection for tests. */
  spawnFn?: SpawnFn;
  /** Pipeline name, used purely for error messages. */
  name?: string;
};

export type RunPipelineResult = {
  /** Final step's exit code. 0 on success. */
  exitCode: number;
  /** Steps that ran (always equals pipeline.steps.length on success). */
  ranSteps: number;
};

/**
 * Resolve substitution tokens in a string. Throws on missing required
 * tokens. Supported tokens:
 *
 *   ${input}    all positional args joined with spaces, required
 *   ${input?}   same but resolves to '' when no positional was passed
 *   ${N}        Nth positional (1-indexed), required
 *   ${N?}       same but resolves to '' when not supplied
 */
export function substitute(template: string, positional: readonly string[]): string {
  const inputAll = positional.join(' ');
  return template.replace(
    /\$\{(input\??|\d+\??)\}/g,
    (_match, tok: string) => {
      const optional = tok.endsWith('?');
      const name = optional ? tok.slice(0, -1) : tok;
      if (name === 'input') {
        if (!inputAll && !optional) {
          throw new AICliError(
            'validation',
            `Pipeline step references \${input} but no input argument was provided. Pass one: marmot @<pipeline> <input>.`,
          );
        }
        return inputAll;
      }
      const index = Number.parseInt(name, 10);
      if (!Number.isFinite(index) || index < 1) {
        throw new AICliError('validation', `Unknown substitution token \${${tok}} in pipeline step.`);
      }
      const value = positional[index - 1];
      if (value === undefined) {
        if (optional) return '';
        throw new AICliError(
          'validation',
          `Pipeline step references \${${index}} but the pipeline was called with only ${positional.length} positional argument${positional.length === 1 ? '' : 's'}.`,
        );
      }
      return value;
    },
  );
}

/**
 * Build the argv (excluding the binary name) for a single step.
 * `presetRef` references a preset; we resolve via @<name> sigil so the
 * existing routing logic picks the right verb.
 */
export async function buildStepArgv(
  step: PipelineStep,
  positional: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  if ('preset' in step) {
    // Validate preset exists at run time so we surface a clear error
    // before spawning. (Create-time validation is best-effort because
    // presets can be defined later.)
    await getPreset(step.preset, env); // throws if missing
    const argv: string[] = [`@${step.preset}`];
    if (step.args) argv.push(substitute(step.args, positional));
    return argv;
  }
  // Inline verb step.
  const argv: string[] = [step.verb];
  if (step.args) argv.push(substitute(step.args, positional));
  if (step.prompt) {
    argv.push('--prompt', substitute(step.prompt, positional));
  }
  if (step.flags) {
    for (const [key, value] of Object.entries(step.flags)) {
      const flag = `--${key}`;
      if (typeof value === 'boolean') {
        if (value) argv.push(flag);
      } else {
        argv.push(flag, substitute(value, positional));
      }
    }
  }
  return argv;
}

/**
 * Pick the marmot binary to spawn for each step. Production users have
 * `marmot` in PATH (via the npm package). Dev users invoke through
 * `marmot-dev`, which loads `apps/cli/src/cli.ts` via tsx — when our
 * own argv[1] ends with `.ts` we're running in dev and should spawn
 * `marmot-dev` so the child also runs the dev tree. Override either
 * heuristic with `MARMOT_BIN` for testing or unusual setups.
 */
function defaultMarmotCommand(env: NodeJS.ProcessEnv): string {
  const fromEnv = env.MARMOT_BIN?.trim();
  if (fromEnv) return fromEnv;
  const script = process.argv[1] ?? '';
  if (script.endsWith('.ts')) return 'marmot-dev';
  return 'marmot';
}

/**
 * Spawn each step in sequence, piping stdout to the next step's stdin.
 * The first step's stdin is inherited from the parent (so a user could
 * `cat foo.txt | marmot @pipeline`); the last step's stdout is also
 * inherited (so output flows back to the terminal naturally).
 */
export async function runPipeline(opts: RunPipelineOptions): Promise<RunPipelineResult> {
  const { pipeline, positional } = opts;
  const env = opts.env ?? process.env;
  const command = opts.command ?? defaultMarmotCommand(env);
  const spawnFn = opts.spawnFn ?? (spawn as unknown as SpawnFn);
  const name = opts.name ?? '<pipeline>';

  if (pipeline.steps.length === 0) {
    throw new AICliError('validation', `Pipeline "${name}" has no steps.`);
  }

  // Pre-resolve every step's argv so substitution errors surface before
  // we spawn anything.
  const stepArgvs: string[][] = [];
  for (const step of pipeline.steps) {
    stepArgvs.push(await buildStepArgv(step, positional, env));
  }

  // For each step except the last, we need a pipe between its stdout
  // and the next step's stdin. Node's spawn supports passing a Stream
  // (or an existing process's stdout) as stdin.
  const children: ChildProcess[] = [];
  for (let i = 0; i < stepArgvs.length; i++) {
    const argv = stepArgvs[i]!;
    const isFirst = i === 0;
    const isLast = i === stepArgvs.length - 1;
    const stdin = isFirst ? 'inherit' : children[i - 1]!.stdout!;
    const stdout = isLast ? 'inherit' : 'pipe';
    const stderr = 'inherit';
    const child = spawnFn(command, argv, {
      stdio: [stdin, stdout, stderr] as SpawnOptions['stdio'],
      env,
    });
    children.push(child);
  }

  // Await every child. If any non-final step exits non-zero, kill the
  // rest and surface the error. The final step's exit code is the
  // pipeline's overall code.
  const results = await Promise.all(
    children.map(
      (c, i) =>
        new Promise<{ idx: number; code: number }>((resolve) => {
          c.on('exit', (code) => resolve({ idx: i, code: code ?? 0 }));
          c.on('error', () => resolve({ idx: i, code: 1 }));
        }),
    ),
  );

  const failure = results.find((r) => r.code !== 0);
  if (failure) {
    throw new AICliError(
      'provider',
      `Pipeline "${name}" failed at step ${failure.idx + 1} (${describeStep(pipeline.steps[failure.idx]!)}) with exit code ${failure.code}.`,
    );
  }

  return { exitCode: 0, ranSteps: results.length };
}

function describeStep(step: PipelineStep): string {
  if ('preset' in step) return `@${step.preset}`;
  return step.verb;
}
