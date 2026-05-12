/**
 * Regression coverage for the 0.11.2 fix: `marmot setup` must NEVER drop
 * top-level config keys when persisting changes. Earlier versions built
 * a fresh `{ version, defaults }` object inside the populate-prompt, the
 * AI-defaults walk, and the data-defaults walk — silently wiping
 * `presets`, `pipelines`, `providers`, and `logging`.
 *
 * These tests apply the exact build pattern from each fixed call site
 * to a fully-populated config and assert every top-level field
 * round-trips through `writeMarmotConfig` + `readMarmotConfig`.
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readMarmotConfig,
  writeMarmotConfig,
  type MarmotConfig,
} from '@marmot-sh/core';

async function freshEnv(): Promise<NodeJS.ProcessEnv> {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-setup-test-'));
  return { ...process.env, MARMOT_HOME: dir };
}

function plantedConfig(): MarmotConfig {
  return {
    version: 1,
    defaults: { search: { provider: 'exa' } },
    presets: {
      mypreset: {
        mode: 'search',
        provider: 'exa',
        preset_id: randomUUID(),
      },
    },
    pipelines: {
      mypipe: {
        pipeline_id: randomUUID(),
        steps: [{ verb: 'search', args: '${input}' }],
      },
    },
    providers: {
      exa: { cache: { enabled: true, ttlDays: 7 } },
    },
    logging: { enabled: true, recordSensitive: false },
  };
}

function expectFullyPreserved(after: MarmotConfig, before: MarmotConfig): void {
  expect(after.presets).toEqual(before.presets);
  expect(after.pipelines).toEqual(before.pipelines);
  expect(after.providers).toEqual(before.providers);
  expect(after.logging).toEqual(before.logging);
}

describe('marmot setup config-preservation (0.11.2 regression)', () => {
  let env: NodeJS.ProcessEnv;
  let planted: MarmotConfig;

  beforeEach(async () => {
    env = await freshEnv();
    planted = plantedConfig();
    await writeFile(
      join(env.MARMOT_HOME!, 'config.json'),
      JSON.stringify(planted, null, 2),
    );
  });

  afterEach(() => {
    // mkdtemp leaves no lockfiles; OS will reap eventually
  });

  it('first-run populate prompt preserves presets/pipelines/providers/logging', async () => {
    // Pattern from apps/cli/src/commands/setup.ts:147 (post-fix).
    const config = (await readMarmotConfig(env))!;
    const updated: MarmotConfig = {
      ...config,
      version: 1,
      defaults: {
        ...(config.defaults ?? {}),
        text: { provider: 'openrouter', model: 'openai/gpt-oss-120b' },
      },
    };
    await writeMarmotConfig(updated, env);

    const after = (await readMarmotConfig(env))!;
    expectFullyPreserved(after, planted);
    expect(after.defaults?.text?.provider).toBe('openrouter');
  });

  it('editMode (AI defaults walk) preserves presets/pipelines/providers/logging', async () => {
    // Pattern from apps/cli/src/commands/setup.ts:330 (post-fix).
    const config = (await readMarmotConfig(env))!;
    const updated: MarmotConfig = {
      ...config,
      version: 1,
      defaults: {
        ...(config.defaults ?? {}),
        image: { provider: 'openai', model: 'gpt-image-1' },
      },
    };
    await writeMarmotConfig(updated, env);

    const after = (await readMarmotConfig(env))!;
    expectFullyPreserved(after, planted);
    expect(after.defaults?.image?.provider).toBe('openai');
  });

  it('applyVerb (data/web defaults walk) preserves presets/pipelines/providers/logging', async () => {
    // Pattern from apps/cli/src/commands/setup-data-defaults.ts:101 (post-fix).
    const config = (await readMarmotConfig(env))!;
    const defaults = (config.defaults ?? {}) as Record<string, unknown>;
    const updated: MarmotConfig = {
      ...config,
      version: 1,
      defaults: {
        ...(defaults as MarmotConfig['defaults']),
        search: { provider: 'tavily' },
      },
    };
    await writeMarmotConfig(updated, env);

    const after = (await readMarmotConfig(env))!;
    expectFullyPreserved(after, planted);
    expect(after.defaults?.search?.provider).toBe('tavily');
  });

  it('the BUG pattern (no `...config` spread) would have wiped — historical guard', async () => {
    // This documents the bug shape so anyone reverting the fix gets a
    // failing test pointing at the exact issue.
    const config = (await readMarmotConfig(env))!;
    const updated: MarmotConfig = {
      // Note: NO `...config` spread — this is what was broken in <0.11.2.
      version: 1,
      defaults: {
        ...(config.defaults ?? {}),
        text: { provider: 'openrouter', model: 'openai/gpt-oss-120b' },
      },
    };
    await writeMarmotConfig(updated, env);

    const after = (await readMarmotConfig(env))!;
    expect(after.presets).toBeUndefined();
    expect(after.pipelines).toBeUndefined();
    expect(after.providers).toBeUndefined();
    expect(after.logging).toBeUndefined();
  });
});
