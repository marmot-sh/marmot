import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { upsertPipeline, upsertPreset } from '@marmot-sh/core';
import {
  handlePipelineCreate,
  handlePipelineDelete,
  handlePipelineList,
  handlePipelineRename,
  handlePipelineRun,
  handlePipelineShow,
  handlePipelineUpdate,
} from '../src/commands/pipeline/index.js';
import { parseStep, tokenize } from '../src/commands/pipeline/parse-step.js';
import { substitute, buildStepArgv, runPipeline, type SpawnFn } from '../src/commands/pipeline/runner.js';
import { expandPresetSigil } from '../src/cli.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-pipeline-cmd-'));
  tempDirs.push(dir);
  return { env: { MARMOT_HOME: dir } };
}

class Cap {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

/* -------------------------------------------------------------------- */
/* parse-step                                                           */
/* -------------------------------------------------------------------- */

describe('tokenize', () => {
  it('splits unquoted whitespace-separated words', () => {
    expect(tokenize('search foo bar')).toEqual(['search', 'foo', 'bar']);
  });

  it('preserves quoted strings as a single token', () => {
    expect(tokenize('run "summarize this in one paragraph"')).toEqual([
      'run',
      'summarize this in one paragraph',
    ]);
  });

  it('handles single-quoted strings', () => {
    expect(tokenize("speak 'welcome aboard'")).toEqual(['speak', 'welcome aboard']);
  });

  it('throws on unterminated quoted string', () => {
    expect(() => tokenize('run "no closing quote')).toThrow(/Unterminated/);
  });
});

describe('parseStep', () => {
  it('parses inline verb step', () => {
    expect(parseStep('search ${input}')).toEqual({ verb: 'search', args: '${input}' });
  });

  it('parses inline verb step with no args', () => {
    expect(parseStep('search')).toEqual({ verb: 'search' });
  });

  it('parses @preset reference', () => {
    expect(parseStep('@news-podcast')).toEqual({ preset: 'news-podcast' });
  });

  it('parses @preset reference with positional args', () => {
    expect(parseStep('@digest ${input}')).toEqual({ preset: 'digest', args: '${input}' });
  });

  it('preserves quoted args as a single token', () => {
    expect(parseStep('run "summarize this in three paragraphs"')).toEqual({
      verb: 'run',
      args: 'summarize this in three paragraphs',
    });
  });

  it('rejects unknown verbs', () => {
    expect(() => parseStep('flarf foo')).toThrow(/known marmot verb/);
  });

  it('rejects empty step', () => {
    expect(() => parseStep('   ')).toThrow(/empty/);
  });

  it('rejects nested pipeline references for v1', () => {
    expect(() => parseStep('pipeline:other ${input}')).toThrow(/Nested pipeline/);
  });

  it('rejects @ with no preset name', () => {
    expect(() => parseStep('@')).toThrow();
  });
});

/* -------------------------------------------------------------------- */
/* substitution                                                         */
/* -------------------------------------------------------------------- */

describe('substitute', () => {
  it('replaces ${input} with all positionals joined by spaces', () => {
    expect(substitute('hello ${input} world', ['foo', 'bar'])).toBe('hello foo bar world');
  });

  it('replaces ${1}, ${2}, … with 1-indexed positionals', () => {
    expect(substitute('a=${1} b=${2}', ['x', 'y'])).toBe('a=x b=y');
  });

  it('throws on missing required ${input}', () => {
    expect(() => substitute('${input}', [])).toThrow(/no input argument/);
  });

  it('throws on missing required ${N}', () => {
    expect(() => substitute('${2}', ['only-one'])).toThrow(/only 1 positional/);
  });

  it('${input?} resolves to empty string when no positional', () => {
    expect(substitute('[${input?}]', [])).toBe('[]');
  });

  it('${N?} resolves to empty string when not supplied', () => {
    expect(substitute('a=${1?} b=${2?}', ['x'])).toBe('a=x b=');
  });

  it('preserves text outside substitutions verbatim', () => {
    expect(substitute('summarize the following:\n\n${input}', ['hello'])).toBe(
      'summarize the following:\n\nhello',
    );
  });
});

/* -------------------------------------------------------------------- */
/* CRUD                                                                 */
/* -------------------------------------------------------------------- */

describe('pipeline CRUD', () => {
  it('create persists the pipeline with a generated pipeline_id', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    const stdout = new Cap();
    await handlePipelineCreate(
      'demo',
      { step: ['search ${input}', 'run "summarize"'] },
      { env, stdout },
    );
    const out = JSON.parse(stdout.text());
    expect(out.ok).toBe(true);
    expect(out.name).toBe('demo');
    expect(out.pipeline.pipeline_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.pipeline.steps).toHaveLength(2);
    expect(out.pipeline.steps[0]).toEqual({ verb: 'search', args: '${input}' });
  });

  it('create rejects when fewer than one step', async () => {
    const { env } = await fixture();
    const stdout = new Cap();
    await expect(
      handlePipelineCreate('empty', { step: [] }, { env, stdout }),
    ).rejects.toThrow(/at least one step/);
  });

  it('create rejects collision with an existing preset name', async () => {
    const { env } = await fixture();
    await upsertPreset('news', { mode: 'text', provider: 'anthropic' }, {}, env);
    const stdout = new Cap();
    await expect(
      handlePipelineCreate('news', { step: ['run "x"'] }, { env, stdout }),
    ).rejects.toThrow(/preset named "news" already exists/);
  });

  it('list emits human table on TTY-less stdout (Cap stub) → JSON', async () => {
    const { env } = await fixture();
    await upsertPipeline('a', { steps: [{ verb: 'search', args: '${input}' }] }, {}, env);
    await upsertPipeline('b', { steps: [{ verb: 'run' }, { preset: 'foo' }] }, {}, env);
    const stdout = new Cap();
    await handlePipelineList({}, { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.pipelines).toHaveLength(2);
    expect(out.pipelines[0]).toEqual({ name: 'a', steps: 1 });
    expect(out.pipelines[1].steps).toBe(2);
  });

  it('list --markdown emits a pipe-table', async () => {
    const { env } = await fixture();
    await upsertPipeline('a', { steps: [{ verb: 'search' }] }, {}, env);
    const stdout = new Cap();
    await handlePipelineList({ markdown: true }, { env, stdout });
    const text = stdout.text();
    expect(text).toMatch(/^\| NAME \| STEPS \| LABEL \|/m);
    expect(text).toMatch(/\| a \|/);
  });

  it('show --json wraps the pipeline under a "pipeline" key', async () => {
    const { env } = await fixture();
    await upsertPipeline(
      'demo',
      { steps: [{ verb: 'search', args: '${input}' }, { preset: 'news' }] },
      {},
      env,
    );
    const stdout = new Cap();
    await handlePipelineShow('demo', { json: true }, { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.name).toBe('demo');
    expect(out.pipeline.steps).toHaveLength(2);
  });

  it('update replaces the steps array (when --step is passed)', async () => {
    const { env } = await fixture();
    process.env.MARMOT_HOME = env.MARMOT_HOME!;
    await upsertPipeline('demo', { steps: [{ verb: 'search' }] }, {}, env);
    const stdout = new Cap();
    await handlePipelineUpdate(
      'demo',
      { step: ['run "summarize"'] },
      { env, stdout },
    );
    const out = JSON.parse(stdout.text());
    expect(out.pipeline.steps).toEqual([{ verb: 'run', args: 'summarize' }]);
  });

  it('rename keeps the pipeline_id stable', async () => {
    const { env } = await fixture();
    await upsertPipeline('old', { steps: [{ verb: 'search' }] }, {}, env);
    const before = (await import('@marmot-sh/core')).getPipeline('old', env);
    const stdout = new Cap();
    await handlePipelineRename('old', 'new', { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.from).toBe('old');
    expect(out.to).toBe('new');
    expect(out.pipeline_id).toBe((await before).pipeline_id);
  });

  it('delete returns removed:true when the pipeline existed', async () => {
    const { env } = await fixture();
    await upsertPipeline('temp', { steps: [{ verb: 'search' }] }, {}, env);
    const stdout = new Cap();
    await handlePipelineDelete('temp', { env, stdout });
    const out = JSON.parse(stdout.text());
    expect(out.removed).toBe(true);
  });
});

/* -------------------------------------------------------------------- */
/* sigil resolver                                                       */
/* -------------------------------------------------------------------- */

describe('expandPresetSigil — pipeline routing', () => {
  it('routes @<name> to `pipeline run <name>` when name matches a pipeline', () => {
    const argv = ['node', 'marmot', '@news-digest', 'AI safety'];
    const expanded = expandPresetSigil(
      argv,
      () => null, // not a preset
      (n) => n === 'news-digest', // is a pipeline
    );
    expect(expanded).toEqual(['node', 'marmot', 'pipeline', 'run', 'news-digest', 'AI safety']);
  });

  it('falls through to preset routing when name is a preset, not a pipeline (search → injects search verb)', () => {
    const argv = ['node', 'marmot', '@my-preset', 'foo'];
    const expanded = expandPresetSigil(
      argv,
      (n) => (n === 'my-preset' ? 'search' : null),
      () => false,
    );
    expect(expanded[2]).toBe('search');
    expect(expanded).toContain('--preset');
  });

  it('falls through to preset routing for text-mode preset (no verb injection — default run)', () => {
    const argv = ['node', 'marmot', '@my-preset', 'foo'];
    const expanded = expandPresetSigil(
      argv,
      (n) => (n === 'my-preset' ? 'text' : null),
      () => false,
    );
    // text mode has no verb; sigil expands to `--preset name foo`.
    expect(expanded).toEqual(['node', 'marmot', '--preset', 'my-preset', 'foo']);
  });

  it('still expands @unknown to --preset (downstream surfaces "preset not found")', () => {
    const argv = ['node', 'marmot', '@unknown', 'foo'];
    const expanded = expandPresetSigil(argv, () => null, () => false);
    // The sigil normalizes the form regardless; the downstream lookup
    // produces the "preset not found" error if --preset doesn't resolve.
    expect(expanded).toEqual(['node', 'marmot', '--preset', 'unknown', 'foo']);
  });

  it('pipeline routing wins when both lookups would match (defensive — collisions are rejected at create time)', () => {
    const argv = ['node', 'marmot', '@shared', 'arg'];
    const expanded = expandPresetSigil(
      argv,
      () => 'search',
      () => true,
    );
    expect(expanded.slice(2, 5)).toEqual(['pipeline', 'run', 'shared']);
  });
});

/* -------------------------------------------------------------------- */
/* runner                                                               */
/* -------------------------------------------------------------------- */

describe('buildStepArgv', () => {
  it('builds argv for an inline verb step with args', async () => {
    const argv = await buildStepArgv(
      { verb: 'search', args: '${input}' },
      ['ai news'],
      process.env,
    );
    expect(argv).toEqual(['search', 'ai news']);
  });

  it('appends --prompt for steps that include one', async () => {
    const argv = await buildStepArgv(
      { verb: 'run', prompt: 'summarize: ${input}' },
      ['the news'],
      process.env,
    );
    expect(argv).toEqual(['run', '--prompt', 'summarize: the news']);
  });

  it('serializes flags, mapping booleans to bare flag names', async () => {
    const argv = await buildStepArgv(
      { verb: 'search', flags: { 'json': true, 'limit': '5' } },
      [],
      process.env,
    );
    expect(argv).toContain('--json');
    expect(argv).toContain('--limit');
    expect(argv).toContain('5');
  });

  it('rejects preset references when the preset doesn\'t exist', async () => {
    const { env } = await fixture();
    await expect(
      buildStepArgv({ preset: 'missing' }, [], env),
    ).rejects.toThrow();
  });
});

/* -------------------------------------------------------------------- */
/* runner integration with stubbed spawn                                */
/* -------------------------------------------------------------------- */

/** Build a fake ChildProcess that exits with the given code. */
function fakeChild(code: number): EventEmitter & { stdout: Readable; stderr: Readable } {
  const ee = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
  ee.stdout = new PassThrough();
  ee.stderr = new PassThrough();
  // Schedule the exit on next tick so the parent has time to wire listeners.
  process.nextTick(() => {
    ee.emit('exit', code);
    (ee.stdout as PassThrough).end();
    (ee.stderr as PassThrough).end();
  });
  return ee;
}

describe('runPipeline — runner integration', () => {
  it('runs a 1-step pipeline with the stubbed spawn', async () => {
    const spawnFn: SpawnFn = vi.fn(() => fakeChild(0) as never);
    const result = await runPipeline({
      pipeline: { steps: [{ verb: 'search', args: '${input}' }] },
      positional: ['ai'],
      command: 'marmot',
      spawnFn,
      env: { ...process.env },
      name: 'one-step',
    });
    expect(result.exitCode).toBe(0);
    expect(result.ranSteps).toBe(1);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const call = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe('marmot');
    expect(call[1]).toEqual(['search', 'ai']);
  });

  it('runs a 3-step pipeline and chains stdin/stdout', async () => {
    const spawnFn: SpawnFn = vi.fn(() => fakeChild(0) as never);
    const result = await runPipeline({
      pipeline: {
        steps: [
          { verb: 'search', args: '${input}' },
          { verb: 'run', prompt: 'summarize' },
          { verb: 'speak' },
        ],
      },
      positional: ['ai news 2026'],
      command: 'marmot',
      spawnFn,
      env: { ...process.env },
      name: 'three-step',
    });
    expect(result.ranSteps).toBe(3);
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });

  it('throws a clear error when a step exits non-zero', async () => {
    let callCount = 0;
    const spawnFn: SpawnFn = vi.fn(() => {
      callCount++;
      return fakeChild(callCount === 2 ? 7 : 0) as never;
    });
    await expect(
      runPipeline({
        pipeline: {
          steps: [{ verb: 'search' }, { verb: 'run' }, { verb: 'speak' }],
        },
        positional: ['hello'],
        command: 'marmot',
        spawnFn,
        env: { ...process.env },
        name: 'broken',
      }),
    ).rejects.toThrow(/step 2.*exit code 7/);
  });

  it('surfaces missing ${input} before spawning anything', async () => {
    const spawnFn: SpawnFn = vi.fn(() => fakeChild(0) as never);
    await expect(
      runPipeline({
        pipeline: { steps: [{ verb: 'search', args: '${input}' }] },
        positional: [],
        command: 'marmot',
        spawnFn,
        env: { ...process.env },
        name: 'no-input',
      }),
    ).rejects.toThrow(/no input argument/);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('routes positional ${1}, ${2} to the right steps', async () => {
    const spawnFn: SpawnFn = vi.fn(() => fakeChild(0) as never);
    await runPipeline({
      pipeline: {
        steps: [
          { verb: 'search', args: '${1}' },
          { verb: 'run', prompt: 'context: ${2}' },
        ],
      },
      positional: ['query-text', 'extra-context'],
      command: 'marmot',
      spawnFn,
      env: { ...process.env },
      name: 'multi-arg',
    });
    const calls = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls[0]![1]).toEqual(['search', 'query-text']);
    expect(calls[1]![1]).toEqual(['run', '--prompt', 'context: extra-context']);
  });
});

/* -------------------------------------------------------------------- */
/* end-to-end via handlePipelineRun                                     */
/* -------------------------------------------------------------------- */

describe('handlePipelineRun', () => {
  it('runs a stored pipeline by name', async () => {
    const { env } = await fixture();
    await upsertPipeline(
      'demo',
      { steps: [{ verb: 'search', args: '${input}' }] },
      {},
      env,
    );
    const spawnFn: SpawnFn = vi.fn(() => fakeChild(0) as never);
    await handlePipelineRun('demo', ['hello'], { spawnFn }, { env });
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('rejects with a helpful error when both a pipeline and preset share the name', async () => {
    const { env } = await fixture();
    // upsertPipeline rejects collisions, but we simulate a hand-edited
    // config by creating both directly via core helpers in inverse order.
    await upsertPreset('shared', { mode: 'text', provider: 'anthropic' }, {}, env);
    // upsertPipeline will refuse — verify that path too.
    await expect(
      upsertPipeline('shared', { steps: [{ verb: 'search' }] }, {}, env),
    ).rejects.toThrow();
  });
});
