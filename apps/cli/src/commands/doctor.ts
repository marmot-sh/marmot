import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import { Command } from 'commander';

import {
  getMarmotConfigPath,
  getMarmotHome,
  isUsageLoggingEnabled,
  listProviderReadiness,
  listUsageFiles,
  pruneUsageOlderThan,
  readMarmotConfig,
  writeLine,
  writeMarmotConfig,
  type OutputWriter,
} from '@marmot-sh/core';

import { listProviderSummaries } from '../providers/index.js';
import { MARMOT_VERSION } from '../lib/version.js';

export type DoctorCommandOptions = {
  json?: boolean;
  fix?: boolean;
};

type CheckLevel = 'ok' | 'warn' | 'error' | 'info';

type FixSuggestion = {
  command?: string;
  description: string;
};

type Check = {
  name: string;
  level: CheckLevel;
  detail: string;
  fix_suggestion?: FixSuggestion;
};

type FixOutcome = {
  applied: string[];
  skipped: string[];
};

export type DoctorCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
};

const USAGE_SIZE_WARN_MB = 100;
const USAGE_PRUNE_DAYS = 90;

async function runChecks(env: NodeJS.ProcessEnv): Promise<Check[]> {
  const checks: Check[] = [];

  // 1. CLI version
  checks.push({
    name: 'marmot version',
    level: 'info',
    detail: MARMOT_VERSION,
  });

  // 2. Node version
  const major = Number.parseInt(process.versions.node.split('.')[0]!, 10);
  if (major >= 20) {
    checks.push({ name: 'node version', level: 'ok', detail: `v${process.versions.node}` });
  } else {
    checks.push({
      name: 'node version',
      level: 'warn',
      detail: `v${process.versions.node} (marmot targets Node 20+)`,
      fix_suggestion: {
        description: 'Upgrade Node to 20 or newer (https://nodejs.org/).',
      },
    });
  }

  // 3. Config readable
  const configPath = getMarmotConfigPath(env);
  let config = null;
  try {
    config = await readMarmotConfig(env);
    checks.push({
      name: 'config readable',
      level: 'ok',
      detail: config === null ? `${configPath} (not yet created — defaults in use)` : configPath,
    });
  } catch (error) {
    checks.push({
      name: 'config readable',
      level: 'error',
      detail: `${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      fix_suggestion: {
        command: 'marmot config init --force',
        description: 'Overwrite the corrupt config with a fresh default. Existing provider keys in your environment still apply.',
      },
    });
  }

  // 4. Provider readiness
  const summaries = listProviderSummaries(env);
  const readiness = listProviderReadiness(config, env);
  const ready = summaries.filter((s) => readiness.get(s.slug)?.ready === true);
  const enabled = summaries.filter((s) => readiness.get(s.slug)?.enabled !== false);
  if (ready.length > 0) {
    checks.push({
      name: 'providers',
      level: 'ok',
      detail: `${ready.length} ready · ${enabled.length} enabled · ${summaries.length} total`,
    });
  } else {
    checks.push({
      name: 'providers',
      level: 'warn',
      detail: `0 ready · ${enabled.length} enabled · ${summaries.length} total`,
      fix_suggestion: {
        command: 'marmot providers list --check-keys',
        description: 'See which provider API keys are missing from your environment, with the env-var name to set per provider.',
      },
    });
  }

  // 5. Usage logging state
  const loggingEnabled = isUsageLoggingEnabled(config, env);
  if (loggingEnabled) {
    const files = await listUsageFiles(env);
    const totalBytes = await sumUsageDirBytes(env);
    const sizeMb = totalBytes / (1024 * 1024);
    if (sizeMb > USAGE_SIZE_WARN_MB) {
      checks.push({
        name: 'usage logging',
        level: 'warn',
        detail: `enabled · ${files.length} day-files · ${sizeMb.toFixed(2)} MB`,
        fix_suggestion: {
          command: `marmot usage prune --older-than ${USAGE_PRUNE_DAYS}d`,
          description: `Drop usage day-files older than ${USAGE_PRUNE_DAYS} days. Recent records are kept.`,
        },
      });
    } else {
      const detail = files.length === 0
        ? 'enabled · 0 records yet'
        : `enabled · ${files.length} day-files · ${sizeMb.toFixed(2)} MB`;
      checks.push({ name: 'usage logging', level: 'ok', detail });
    }
  } else {
    const reason = env.MARMOT_NO_LOG === '1' ? 'MARMOT_NO_LOG=1' : 'logging.enabled=false in config';
    checks.push({
      name: 'usage logging',
      level: 'info',
      detail: `disabled (${reason})`,
    });
  }

  // 6. Usage dir size — informational
  const home = getMarmotHome(env);
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

  return checks;
}

/** Run only safe, idempotent fixes. Returns which fixes ran (and which
 *  were skipped because they need user input). */
async function runFixes(env: NodeJS.ProcessEnv): Promise<FixOutcome> {
  const applied: string[] = [];
  const skipped: string[] = [];

  // Fix 1: missing config file → write a fresh default. Idempotent — only
  // runs when the file does not exist; never overwrites a corrupt one.
  const configPath = getMarmotConfigPath(env);
  let configFileExists = false;
  try {
    await stat(configPath);
    configFileExists = true;
  } catch {
    /* missing */
  }
  if (!configFileExists) {
    await writeMarmotConfig(
      { version: 1, defaults: { text: {}, image: {} } },
      env,
    );
    applied.push(`wrote default config to ${configPath}`);
  }

  // Fix 2: usage dir > threshold → prune older than the cutoff.
  const totalBytes = await sumUsageDirBytes(env);
  const sizeMb = totalBytes / (1024 * 1024);
  if (sizeMb > USAGE_SIZE_WARN_MB) {
    const cutoffIso = new Date(Date.now() - USAGE_PRUNE_DAYS * 86_400_000).toISOString();
    const result = await pruneUsageOlderThan(cutoffIso, env);
    applied.push(
      `pruned ${result.filesDeleted} usage day-file(s) older than ${USAGE_PRUNE_DAYS}d (${(result.bytesFreed / (1024 * 1024)).toFixed(2)} MB freed)`,
    );
  }

  // Anything else (missing keys, corrupt config, old Node, etc.) requires
  // user input or a host-system change. --fix never touches those.
  skipped.push('missing API keys (set the env var per `marmot providers list --check-keys`)');
  skipped.push('corrupt config (run `marmot config init --force` after backing up if needed)');

  return { applied, skipped };
}

/** Rank failed checks for the verdict line. Errors outrank warnings;
 *  within a level, the first check pushed wins (config → providers →
 *  usage → node). The single highest-priority suggestion becomes the
 *  "Run X to fix" hint. */
function pickPrimaryFix(checks: Check[]): FixSuggestion | null {
  const errors = checks.filter((c) => c.level === 'error' && c.fix_suggestion);
  if (errors.length > 0) return errors[0]!.fix_suggestion!;
  const warns = checks.filter((c) => c.level === 'warn' && c.fix_suggestion);
  if (warns.length > 0) return warns[0]!.fix_suggestion!;
  return null;
}

function countIssues(checks: Check[]): number {
  return checks.filter((c) => c.level === 'error' || c.level === 'warn').length;
}

export async function handleDoctorCommand(
  options: DoctorCommandOptions,
  dependencies: DoctorCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  let fixOutcome: FixOutcome | null = null;
  if (options.fix) {
    fixOutcome = await runFixes(env);
  }

  const checks = await runChecks(env);
  const issues = countIssues(checks);
  const primary = pickPrimaryFix(checks);
  const verdict = issues === 0
    ? '✓ Everything is in good order.'
    : primary?.command
      ? `⚠ ${issues} issue${issues === 1 ? '' : 's'} found. Run \`${primary.command}\` to fix.`
      : `⚠ ${issues} issue${issues === 1 ? '' : 's'} found.`;

  if (options.json) {
    writeLine(
      stdout,
      JSON.stringify(
        {
          ok: !checks.some((c) => c.level === 'error'),
          verdict,
          issues_found: issues,
          checks,
          ...(fixOutcome ? { fixes_applied: fixOutcome.applied, fixes_skipped: fixOutcome.skipped } : {}),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (fixOutcome) {
    if (fixOutcome.applied.length === 0) {
      writeLine(stdout, 'No safe auto-fixes applied (nothing matched).');
    } else {
      writeLine(stdout, 'Applied fixes:');
      for (const a of fixOutcome.applied) writeLine(stdout, `  • ${a}`);
    }
    writeLine(stdout, '');
  }

  for (const check of checks) {
    const icon = check.level === 'ok' ? '✓' : check.level === 'warn' ? '⚠' : check.level === 'error' ? '✗' : '·';
    writeLine(stdout, `${icon} ${check.name.padEnd(20)} ${check.detail}`);
    if (check.fix_suggestion && (check.level === 'warn' || check.level === 'error')) {
      const prefix = check.fix_suggestion.command ? `\`${check.fix_suggestion.command}\` — ` : '';
      writeLine(stdout, `  → ${prefix}${check.fix_suggestion.description}`);
    }
  }
  writeLine(stdout, '');
  writeLine(stdout, verdict);
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
    .description('Run health checks: CLI version, config, providers, usage logging, disk usage. Pass --fix to apply safe auto-fixes.')
    .option('--json', 'Emit a structured envelope.')
    .option('--fix', 'Apply safe, idempotent auto-fixes (write missing config, prune oversized usage log).')
    .action(async (options: DoctorCommandOptions) => {
      await handleDoctorCommand(options, deps);
    });
}
