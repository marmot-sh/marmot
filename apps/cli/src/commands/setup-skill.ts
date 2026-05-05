// Agent skill install/update walkthrough — invoked from `marmot setup`.
//
// Detection-driven: shows current skill state (installed / outdated / missing),
// offers install/update/uninstall, picks scope (global vs project-local) and
// which detected harnesses receive symlinks.

import { cancel, confirm, isCancel, note, select, spinner } from '@clack/prompts';

import {
  detectHarnesses,
  installSkill,
  listKnownHarnesses,
  readSkillState,
  uninstallSkill,
  type HarnessSlug,
  type InstallScope,
  type SkillState,
} from '@marmot-sh/core';

const ACTION_INSTALL = '__install__';
const ACTION_UPDATE = '__update__';
const ACTION_UNINSTALL = '__uninstall__';
const ACTION_DONE = '__done__';

export async function walkSkillSetup(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const cwd = process.cwd();
  const detected = detectHarnesses(env);

  if (detected.length === 0) {
    note(
      'No agent harnesses detected (~/.claude, ~/.opencode, ~/.codex). Install one of those first, then re-run setup.',
      'agent skill',
    );
    return;
  }

  const detectSpin = spinner();
  detectSpin.start('Checking skill state');
  const [globalState, projectState] = await Promise.all([
    readSkillState('global', { env, cwd }),
    readSkillState('project', { env, cwd, skipRemote: true }),
  ]);
  detectSpin.stop('Skill state checked');

  note(formatStatus(globalState, projectState, detected), 'agent skill');

  const choice = await select({
    message: 'What would you like to do?',
    options: buildActionOptions(globalState, projectState),
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return;
  }

  if (choice === ACTION_DONE) return;

  if (choice === ACTION_INSTALL || choice === ACTION_UPDATE) {
    const scope = await pickScope();
    if (scope === null) return;

    const harnesses = await pickHarnesses(detected, scope);
    if (harnesses === null) return;

    const installSpin = spinner();
    installSpin.start(
      choice === ACTION_INSTALL ? 'Installing skill' : 'Updating skill',
    );
    try {
      const result = await installSkill(scope, { env, cwd, harnesses });
      installSpin.stop(
        choice === ACTION_INSTALL ? 'Skill installed' : 'Skill updated',
      );
      note(formatInstallResult(result, scope), 'done');
    } catch (error) {
      installSpin.stop('Install failed');
      const message = error instanceof Error ? error.message : 'Unknown error';
      note(
        `${message}\n\nYou can re-run \`marmot setup\` to retry, or skip the skill install and use marmot from the shell directly.`,
        'agent skill',
      );
    }
    return;
  }

  if (choice === ACTION_UNINSTALL) {
    const scope = globalState.installed ? 'global' : 'project';
    const confirmed = await confirm({
      message: `Remove ${scope} skill install at ${
        scope === 'global' ? globalState.canonicalPath : projectState.canonicalPath
      }?`,
      initialValue: false,
    });
    if (isCancel(confirmed) || !confirmed) {
      cancel('Uninstall canceled.');
      return;
    }
    const removeSpin = spinner();
    removeSpin.start('Removing skill');
    const result = await uninstallSkill(scope, { env, cwd });
    removeSpin.stop('Skill removed');
    note(
      `Removed canonical path:\n  ${result.canonicalPath}\n\nRemoved harness links:\n${
        result.removedSymlinks.length === 0
          ? '  (none)'
          : result.removedSymlinks.map((p) => `  - ${p}`).join('\n')
      }`,
      'done',
    );
  }
}

/* -- helpers --------------------------------------------------------------- */

function formatStatus(
  global: SkillState,
  project: SkillState,
  detected: HarnessSlug[],
): string {
  const lines: string[] = [];

  if (global.installed) {
    const ver = global.localVersion ? ` · ${global.localVersion.slice(0, 7)}` : '';
    const status = global.outdated ? ' (outdated)' : '';
    lines.push(`global   ${global.canonicalPath}${ver}${status}`);
    if (global.linkedHarnesses.length > 0) {
      lines.push(`         linked: ${global.linkedHarnesses.join(', ')}`);
    }
  } else {
    lines.push('global   not installed');
  }

  if (project.installed) {
    const ver = project.localVersion ? ` · ${project.localVersion.slice(0, 7)}` : '';
    lines.push(`project  ${project.canonicalPath}${ver}`);
    if (project.linkedHarnesses.length > 0) {
      lines.push(`         linked: ${project.linkedHarnesses.join(', ')}`);
    }
  } else {
    lines.push('project  not installed');
  }

  lines.push('');
  lines.push(`detected harnesses: ${detected.join(', ')}`);

  if (global.outdated && global.remoteVersion) {
    lines.push('');
    lines.push(`update available: ${global.remoteVersion.slice(0, 7)}`);
  }

  return lines.join('\n');
}

function buildActionOptions(
  global: SkillState,
  project: SkillState,
): Array<{ value: string; label: string; hint?: string }> {
  const opts: Array<{ value: string; label: string; hint?: string }> = [];

  if (!global.installed && !project.installed) {
    opts.push({ value: ACTION_INSTALL, label: 'Install agent skill' });
  } else if (global.outdated) {
    opts.push({ value: ACTION_UPDATE, label: 'Update agent skill', hint: 'newer version available' });
    opts.push({ value: ACTION_INSTALL, label: 'Reinstall (also for project-local)' });
  } else {
    opts.push({ value: ACTION_INSTALL, label: 'Reinstall / install in another scope' });
  }

  if (global.installed || project.installed) {
    opts.push({ value: ACTION_UNINSTALL, label: 'Uninstall agent skill' });
  }

  opts.push({ value: ACTION_DONE, label: 'Back to setup' });
  return opts;
}

async function pickScope(): Promise<InstallScope | null> {
  const choice = await select({
    message: 'Where should the skill be installed?',
    options: [
      {
        value: 'global',
        label: 'Global (~/.agents/skills/marmot)',
        hint: 'available across all projects',
      },
      {
        value: 'project',
        label: 'Project (./.agents/skills/marmot)',
        hint: 'committable to repo for team-shared agent context',
      },
    ],
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  return choice as InstallScope;
}

async function pickHarnesses(
  detected: HarnessSlug[],
  scope: InstallScope,
): Promise<readonly HarnessSlug[] | null> {
  if (detected.length === 1) return detected;

  const known = listKnownHarnesses();
  const choice = await select({
    message: `Which harnesses should get the symlink? (${scope})`,
    options: [
      { value: 'all', label: `All detected (${detected.join(', ')})` },
      ...detected.map((slug) => ({
        value: slug,
        label: `Only ${known.find((h) => h.slug === slug)!.displayName}`,
      })),
    ],
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  return choice === 'all' ? detected : [choice as HarnessSlug];
}

function formatInstallResult(
  result: { canonicalPath: string; version: string; symlinks: Array<{ harness: HarnessSlug; path: string; mode: 'symlink' | 'copy' }> },
  scope: InstallScope,
): string {
  const lines: string[] = [];
  lines.push(`scope:    ${scope}`);
  lines.push(`path:     ${result.canonicalPath}`);
  lines.push(`version:  ${result.version.slice(0, 7)}`);
  lines.push('');
  lines.push('Linked harnesses:');
  if (result.symlinks.length === 0) {
    lines.push('  (none)');
  } else {
    for (const link of result.symlinks) {
      lines.push(`  ${link.harness.padEnd(14)} ${link.path}  [${link.mode}]`);
    }
  }
  return lines.join('\n');
}
