// Shell-completion installer.
//
// Writes a small managed block into the user's shell rc file (bash/zsh) or
// drops a completion file into fish's completions directory. The installer
// is idempotent and removable: each managed block is bracketed with sentinel
// comments so we can find and remove it cleanly later.
//
// We never modify a file the user hasn't opted into modifying. Detection is
// env-only (`$SHELL` and the existence of the rc file); we don't run shell
// commands.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { AICliError } from './errors.js';

export type ShellSlug = 'bash' | 'zsh' | 'fish';

export const COMPLETION_BEGIN = '# >>> marmot completions >>>';
export const COMPLETION_END = '# <<< marmot completions <<<';

export type CompletionTarget = {
  shell: ShellSlug;
  /** Path where the install lands (rc file for bash/zsh, completion file for fish). */
  path: string;
  /** Human-readable hint shown in the prompt. */
  description: string;
};

export type CompletionsState = {
  shell: ShellSlug | null;
  /** True when a target file is identified for the detected shell. */
  hasTarget: boolean;
  target?: CompletionTarget;
  installed: boolean;
};

/** Returns the slug for the user's shell, derived from $SHELL. */
export function detectShell(env: NodeJS.ProcessEnv = process.env): ShellSlug | null {
  const sh = env.SHELL ?? '';
  if (/\/zsh$/.test(sh)) return 'zsh';
  if (/\/bash$/.test(sh)) return 'bash';
  if (/\/fish$/.test(sh)) return 'fish';
  return null;
}

/**
 * Resolves the install target for the given shell. Returns null if no
 * sensible target exists (e.g. a shell we don't support).
 */
export function getCompletionTarget(
  shell: ShellSlug,
  env: NodeJS.ProcessEnv = process.env,
): CompletionTarget | null {
  const home = env.HOME ?? homedir();
  switch (shell) {
    case 'zsh': {
      const path = env.ZDOTDIR ? join(env.ZDOTDIR, '.zshrc') : join(home, '.zshrc');
      return { shell, path, description: `appends an eval block to ${path}` };
    }
    case 'bash': {
      // Prefer ~/.bashrc on Linux; on macOS many users only source ~/.bash_profile,
      // so we pick whichever exists. Fall back to ~/.bashrc.
      const bashrc = join(home, '.bashrc');
      const bashProfile = join(home, '.bash_profile');
      const path = existsSync(bashrc)
        ? bashrc
        : existsSync(bashProfile)
        ? bashProfile
        : bashrc;
      return { shell, path, description: `appends an eval block to ${path}` };
    }
    case 'fish': {
      const path = join(home, '.config', 'fish', 'completions', 'marmot.fish');
      return { shell, path, description: `writes a completion file to ${path}` };
    }
  }
}

export async function readCompletionsState(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompletionsState> {
  const shell = detectShell(env);
  if (!shell) return { shell: null, hasTarget: false, installed: false };

  const target = getCompletionTarget(shell, env);
  if (!target) return { shell, hasTarget: false, installed: false };

  const installed = await isInstalled(target);
  return { shell, hasTarget: true, target, installed };
}

async function isInstalled(target: CompletionTarget): Promise<boolean> {
  if (!existsSync(target.path)) return false;
  if (target.shell === 'fish') {
    // Fish: any non-empty completions file at the canonical path counts as installed.
    try {
      const text = await readFile(target.path, 'utf8');
      return text.includes('marmot') && text.includes('complete -c marmot');
    } catch {
      return false;
    }
  }
  try {
    const text = await readFile(target.path, 'utf8');
    return text.includes(COMPLETION_BEGIN);
  } catch {
    return false;
  }
}

export type InstallCompletionsInput = {
  shell: ShellSlug;
  /** The completion script body to install. For bash/zsh we wrap in `eval`; for fish we write verbatim. */
  scriptBody?: string;
  env?: NodeJS.ProcessEnv;
};

export type InstallCompletionsResult = {
  shell: ShellSlug;
  path: string;
  alreadyInstalled: boolean;
};

export async function installCompletions(
  input: InstallCompletionsInput,
): Promise<InstallCompletionsResult> {
  const env = input.env ?? process.env;
  const target = getCompletionTarget(input.shell, env);
  if (!target) {
    throw new AICliError('io', `Cannot determine completion install path for ${input.shell}.`);
  }

  if (target.shell === 'fish') {
    if (!input.scriptBody) {
      throw new AICliError('io', 'Fish install requires the completion script body.');
    }
    await mkdir(dirname(target.path), { recursive: true });
    await writeFile(target.path, input.scriptBody, 'utf8');
    return { shell: target.shell, path: target.path, alreadyInstalled: false };
  }

  const block = renderRcBlock(input.shell);
  let existing = '';
  if (existsSync(target.path)) {
    existing = await readFile(target.path, 'utf8');
  }
  if (existing.includes(COMPLETION_BEGIN)) {
    return { shell: target.shell, path: target.path, alreadyInstalled: true };
  }
  const sep = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  await writeFile(target.path, `${existing}${sep}${block}`, 'utf8');
  return { shell: target.shell, path: target.path, alreadyInstalled: false };
}

export async function uninstallCompletions(
  input: { shell: ShellSlug; env?: NodeJS.ProcessEnv },
): Promise<{ shell: ShellSlug; path: string; removed: boolean }> {
  const env = input.env ?? process.env;
  const target = getCompletionTarget(input.shell, env);
  if (!target) {
    throw new AICliError('io', `Cannot determine completion install path for ${input.shell}.`);
  }

  if (!existsSync(target.path)) {
    return { shell: target.shell, path: target.path, removed: false };
  }

  if (target.shell === 'fish') {
    await rm(target.path, { force: true });
    return { shell: target.shell, path: target.path, removed: true };
  }

  const text = await readFile(target.path, 'utf8');
  const block = renderRcBlock(input.shell);
  if (!text.includes(COMPLETION_BEGIN)) {
    return { shell: target.shell, path: target.path, removed: false };
  }
  // Remove the managed block (and any leading separator newline) idempotently.
  const updated = text
    .replace(`\n${block}`, '')
    .replace(block, '');
  await writeFile(target.path, updated, 'utf8');
  return { shell: target.shell, path: target.path, removed: true };
}

function renderRcBlock(shell: ShellSlug): string {
  return `${COMPLETION_BEGIN}\neval "$(marmot completions ${shell})"\n${COMPLETION_END}\n`;
}
