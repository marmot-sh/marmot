import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Command } from 'commander';

import {
  getMarmotConfigPath,
  getMarmotHome,
  isUsageLoggingEnabled,
  listProviderReadiness,
  listUsageFiles,
  readMarmotConfig,
  writeLine,
  type OutputWriter,
} from '@marmot-sh/core';

import { listProviderSummaries } from '../providers/index.js';
import { MARMOT_VERSION } from '../lib/version.js';

export type DoctorCommandOptions = {
  json?: boolean;
};

type CheckLevel = 'ok' | 'warn' | 'error' | 'info';

type Check = {
  name: string;
  level: CheckLevel;
  detail: string;
};

export type DoctorCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

export async function handleDoctorCommand(
  options: DoctorCommandOptions,
  dependencies: DoctorCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const checks: Check[] = [];

  // 1. CLI version
  checks.push({
    name: 'marmot version',
    level: 'info',
    detail: MARMOT_VERSION,
  });

  // 2. Node version
  checks.push({
    name: 'node version',
    level: process.versions.node.split('.')[0]! >= '20' ? 'ok' : 'warn',
    detail: `v${process.versions.node}`,
  });

  // 3. Marmot home + config
  const home = getMarmotHome(env);
  const configPath = getMarmotConfigPath(env);
  let config = null;
  try {
    config = await readMarmotConfig(env);
    checks.push({
      name: 'config readable',
      level: 'ok',
      detail: configPath,
    });
  } catch (error) {
    checks.push({
      name: 'config readable',
      level: 'error',
      detail: `${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // 4. Provider readiness
  const summaries = listProviderSummaries(env);
  const readiness = listProviderReadiness(config, env);
  const ready = summaries.filter((s) => readiness.get(s.slug)?.ready === true);
  const enabled = summaries.filter((s) => readiness.get(s.slug)?.enabled !== false);
  checks.push({
    name: 'providers',
    level: ready.length > 0 ? 'ok' : 'warn',
    detail: `${ready.length} ready · ${enabled.length} enabled · ${summaries.length} total`,
  });

  // 5. Usage logging state
  const loggingEnabled = isUsageLoggingEnabled(config, env);
  if (loggingEnabled) {
    const files = await listUsageFiles(env);
    const totalBytes = await sumUsageDirBytes(env);
    const sizeMb = totalBytes / (1024 * 1024);
    const level: CheckLevel = sizeMb > 100 ? 'warn' : 'ok';
    const detail = files.length === 0
      ? `enabled · 0 records yet`
      : `enabled · ${files.length} day-files · ${sizeMb.toFixed(2)} MB${sizeMb > 100 ? ' (consider `marmot usage prune --older-than 90d`)' : ''}`;
    checks.push({ name: 'usage logging', level, detail });
  } else {
    const reason = env.MARMOT_NO_LOG === '1' ? 'MARMOT_NO_LOG=1' : 'logging.enabled=false in config';
    checks.push({
      name: 'usage logging',
      level: 'info',
      detail: `disabled (${reason})`,
    });
  }

  // 6. Usage dir size — informational
  let homeBytes = 0;
  try {
    const s = await stat(home);
    if (s.isDirectory()) {
      homeBytes = await sumDirBytes(home);
    }
  } catch {
    /* ignore */
  }
  checks.push({
    name: 'marmot home',
    level: 'info',
    detail: `${home} · ${(homeBytes / (1024 * 1024)).toFixed(2)} MB`,
  });

  // Render
  if (options.json) {
    writeLine(
      stdout,
      JSON.stringify(
        {
          ok: !checks.some((c) => c.level === 'error'),
          checks,
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const check of checks) {
    const icon = check.level === 'ok' ? '✓' : check.level === 'warn' ? '⚠' : check.level === 'error' ? '✗' : '·';
    writeLine(stdout, `${icon} ${check.name.padEnd(20)} ${check.detail}`);
  }
  if (checks.some((c) => c.level === 'error')) {
    writeLine(stdout, '');
    writeLine(stdout, 'Some checks failed. Run `marmot config show` and `marmot providers list --check-keys` for details.');
  }
}

async function sumUsageDirBytes(env: NodeJS.ProcessEnv): Promise<number> {
  const files = await listUsageFiles(env);
  let total = 0;
  for (const f of files) {
    try {
      const s = await stat(f.path);
      total += s.size;
    } catch {
      /* ignore */
    }
  }
  return total;
}

async function sumDirBytes(dir: string): Promise<number> {
  // Shallow walk — we only care about gross size of ~/.marmot.
  const { readdir } = await import('node:fs/promises');
  let total = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (s.isDirectory()) {
        total += await sumDirBytes(full);
      } else if (s.isFile()) {
        total += s.size;
      }
    } catch {
      /* ignore */
    }
  }
  return total;
}

export function buildDoctorCommand(deps: DoctorCommandDependencies = {}): Command {
  return new Command('doctor')
    .description('Run health checks: CLI version, config, providers, usage logging, disk usage.')
    .option('--json', 'Emit a structured envelope.')
    .action(async (options: DoctorCommandOptions) => {
      await handleDoctorCommand(options, deps);
    });
}
