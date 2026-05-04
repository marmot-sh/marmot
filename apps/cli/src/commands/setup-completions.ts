// Shell-completions install/update walkthrough — invoked from `marmot setup`.
//
// Detects the user's shell ($SHELL), shows current install state, and lets
// them install or remove a managed completion block. We never touch a file
// without an explicit confirmation.

import { cancel, confirm, isCancel, note, select, spinner } from '@clack/prompts';

import {
  installCompletions,
  readCompletionsState,
  uninstallCompletions,
  type CompletionsState,
  type ShellSlug,
} from '@marmot-sh/core';

import { createProgram } from '../cli.js';
import { generateCompletionScript } from './completions.js';

const ACTION_INSTALL = '__install__';
const ACTION_OTHER_SHELL = '__other__';
const ACTION_UNINSTALL = '__uninstall__';
const ACTION_DONE = '__done__';

const SUPPORTED: readonly ShellSlug[] = ['bash', 'zsh', 'fish'];

export async function walkCompletionsSetup(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const detectSpin = spinner();
  detectSpin.start('Checking shell completions');
  const state = await readCompletionsState(env);
  detectSpin.stop('Shell completions checked');

  note(formatStatus(state), 'shell completions');

  const choice = await select({
    message: 'What would you like to do?',
    options: buildActionOptions(state),
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return;
  }

  if (choice === ACTION_DONE) return;

  if (choice === ACTION_INSTALL) {
    if (!state.shell) {
      note('Could not auto-detect a shell. Pick one manually.', 'shell completions');
      return;
    }
    await runInstall(state.shell, env);
    return;
  }

  if (choice === ACTION_OTHER_SHELL) {
    const shell = await pickShell();
    if (shell === null) return;
    await runInstall(shell, env);
    return;
  }

  if (choice === ACTION_UNINSTALL) {
    if (!state.target) return;
    const confirmed = await confirm({
      message: `Remove the marmot completions block from ${state.target.path}?`,
      initialValue: false,
    });
    if (isCancel(confirmed) || !confirmed) {
      cancel('Uninstall canceled.');
      return;
    }
    const result = await uninstallCompletions({ shell: state.target.shell, env });
    note(
      result.removed
        ? `Removed completions from ${result.path}. Open a new shell for the change to take effect.`
        : `No marmot completions block found at ${result.path}.`,
      'done',
    );
  }
}

async function runInstall(shell: ShellSlug, env: NodeJS.ProcessEnv): Promise<void> {
  const target = (await readCompletionsState(env)).target
    ?? null;
  // Re-resolve target for an alternate shell if the user picked one.
  const resolvedTarget = target && target.shell === shell
    ? target
    : (await readCompletionsState({ ...env, SHELL: shellPathFor(shell) })).target;

  if (!resolvedTarget) {
    note(`Could not resolve install path for ${shell}.`, 'shell completions');
    return;
  }

  const confirmed = await confirm({
    message: `Install marmot completions? This ${resolvedTarget.description}.`,
    initialValue: true,
  });
  if (isCancel(confirmed) || !confirmed) {
    cancel('Install canceled.');
    return;
  }

  const installSpin = spinner();
  installSpin.start('Installing completions');
  try {
    const scriptBody = shell === 'fish'
      ? generateCompletionScript('fish', createProgram())
      : undefined;
    const result = await installCompletions({ shell, scriptBody, env });
    installSpin.stop(result.alreadyInstalled ? 'Already installed' : 'Completions installed');
    note(
      `${result.alreadyInstalled ? 'Already present' : 'Wrote'} at:\n  ${result.path}\n\nOpen a new shell, or run:\n  ${reloadHintFor(shell)}`,
      'done',
    );
  } catch (error) {
    installSpin.stop('Install failed');
    note(error instanceof Error ? error.message : 'Unknown error', 'shell completions');
  }
}

async function pickShell(): Promise<ShellSlug | null> {
  const choice = await select({
    message: 'Which shell?',
    options: SUPPORTED.map((s) => ({ value: s, label: s })),
  });
  if (isCancel(choice)) {
    cancel('Setup canceled.');
    return null;
  }
  return choice as ShellSlug;
}

function buildActionOptions(state: CompletionsState): Array<{ value: string; label: string; hint?: string }> {
  const opts: Array<{ value: string; label: string; hint?: string }> = [];

  if (state.shell && !state.installed && state.hasTarget) {
    opts.push({
      value: ACTION_INSTALL,
      label: `Install for ${state.shell}`,
      hint: state.target?.path,
    });
  } else if (state.shell && state.installed) {
    opts.push({
      value: ACTION_INSTALL,
      label: `Reinstall for ${state.shell}`,
      hint: 'no-op if already present',
    });
    opts.push({ value: ACTION_UNINSTALL, label: 'Uninstall completions' });
  } else {
    opts.push({
      value: ACTION_INSTALL,
      label: 'Install for the detected shell',
      hint: 'no shell auto-detected',
    });
  }
  opts.push({ value: ACTION_OTHER_SHELL, label: 'Install for a different shell' });
  opts.push({ value: ACTION_DONE, label: 'Done — leave as is' });
  return opts;
}

function formatStatus(state: CompletionsState): string {
  const lines: string[] = [];
  if (state.shell) {
    lines.push(`detected shell: ${state.shell}`);
  } else {
    lines.push('detected shell: (none — $SHELL is unset or unrecognized)');
  }
  if (state.target) {
    lines.push(`target path:    ${state.target.path}`);
    lines.push(`status:         ${state.installed ? 'installed' : 'not installed'}`);
  } else {
    lines.push('target path:    (none)');
  }
  return lines.join('\n');
}

function shellPathFor(shell: ShellSlug): string {
  return `/bin/${shell}`;
}

function reloadHintFor(shell: ShellSlug): string {
  switch (shell) {
    case 'zsh':
      return 'source ~/.zshrc';
    case 'bash':
      return 'source ~/.bashrc';
    case 'fish':
      return '(fish auto-loads completions on next prompt)';
  }
}
