import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMPLETION_BEGIN,
  COMPLETION_END,
  detectShell,
  getCompletionTarget,
  installCompletions,
  readCompletionsState,
  uninstallCompletions,
} from '../src/lib/completions.js';

describe('detectShell', () => {
  it('recognizes zsh', () => {
    expect(detectShell({ SHELL: '/bin/zsh' })).toBe('zsh');
  });
  it('recognizes bash', () => {
    expect(detectShell({ SHELL: '/usr/local/bin/bash' })).toBe('bash');
  });
  it('recognizes fish', () => {
    expect(detectShell({ SHELL: '/opt/homebrew/bin/fish' })).toBe('fish');
  });
  it('returns null for unknown shells', () => {
    expect(detectShell({ SHELL: '/bin/dash' })).toBe(null);
    expect(detectShell({})).toBe(null);
  });
});

describe('getCompletionTarget', () => {
  it('targets ~/.zshrc for zsh', () => {
    const t = getCompletionTarget('zsh', { HOME: '/h' });
    expect(t?.path).toBe('/h/.zshrc');
  });
  it('honors ZDOTDIR for zsh', () => {
    const t = getCompletionTarget('zsh', { HOME: '/h', ZDOTDIR: '/zd' });
    expect(t?.path).toBe('/zd/.zshrc');
  });
  it('targets fish completions dir', () => {
    const t = getCompletionTarget('fish', { HOME: '/h' });
    expect(t?.path).toBe('/h/.config/fish/completions/marmot.fish');
  });
});

describe('install / read / uninstall (zsh)', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'marmot-completions-'));
    env = { HOME: dir, SHELL: '/bin/zsh' };
  });

  it('installs into a new ~/.zshrc and is idempotent', async () => {
    const r1 = await installCompletions({ shell: 'zsh', env });
    expect(r1.alreadyInstalled).toBe(false);

    const text = await readFile(join(dir, '.zshrc'), 'utf8');
    expect(text).toContain(COMPLETION_BEGIN);
    expect(text).toContain('eval "$(marmot completions zsh)"');
    expect(text).toContain(COMPLETION_END);

    const r2 = await installCompletions({ shell: 'zsh', env });
    expect(r2.alreadyInstalled).toBe(true);
  });

  it('appends to an existing ~/.zshrc without clobbering', async () => {
    const before = '# user content\nexport PATH=/foo:$PATH\n';
    await writeFile(join(dir, '.zshrc'), before, 'utf8');
    await installCompletions({ shell: 'zsh', env });
    const text = await readFile(join(dir, '.zshrc'), 'utf8');
    expect(text.startsWith(before)).toBe(true);
    expect(text).toContain(COMPLETION_BEGIN);
  });

  it('readCompletionsState reflects install / uninstall lifecycle', async () => {
    const stateBefore = await readCompletionsState(env);
    expect(stateBefore.installed).toBe(false);
    expect(stateBefore.shell).toBe('zsh');

    await installCompletions({ shell: 'zsh', env });
    const stateInstalled = await readCompletionsState(env);
    expect(stateInstalled.installed).toBe(true);

    const removed = await uninstallCompletions({ shell: 'zsh', env });
    expect(removed.removed).toBe(true);

    const stateAfter = await readCompletionsState(env);
    expect(stateAfter.installed).toBe(false);
    const text = await readFile(join(dir, '.zshrc'), 'utf8');
    expect(text).not.toContain(COMPLETION_BEGIN);
  });

  it('uninstall is a no-op when no block is present', async () => {
    await writeFile(join(dir, '.zshrc'), '# untouched\n', 'utf8');
    const removed = await uninstallCompletions({ shell: 'zsh', env });
    expect(removed.removed).toBe(false);
    const text = await readFile(join(dir, '.zshrc'), 'utf8');
    expect(text).toBe('# untouched\n');
  });
});

describe('install / uninstall (fish)', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'marmot-completions-fish-'));
    env = { HOME: dir, SHELL: '/usr/bin/fish' };
  });

  it('writes the script body to ~/.config/fish/completions/marmot.fish', async () => {
    const body = '# fish completions\ncomplete -c marmot -f\ncomplete -c marmot -a run\n';
    const r = await installCompletions({ shell: 'fish', scriptBody: body, env });
    expect(r.path.endsWith('/.config/fish/completions/marmot.fish')).toBe(true);
    const text = await readFile(r.path, 'utf8');
    expect(text).toBe(body);

    const removed = await uninstallCompletions({ shell: 'fish', env });
    expect(removed.removed).toBe(true);
  });
});
