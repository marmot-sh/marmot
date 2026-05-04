import type { Command } from 'commander';

import { writeLine, type OutputWriter } from '@marmot-sh/core';

export type CompletionsCommandOptions = {
  shell?: string;
};

type CompletionsDependencies = {
  stdout?: OutputWriter;
  stderr?: OutputWriter;
};

const SUPPORTED = ['bash', 'zsh', 'fish'] as const;
type Shell = (typeof SUPPORTED)[number];

export async function handleCompletionsCommand(
  shell: string | undefined,
  program: Command,
  dependencies: CompletionsDependencies = {},
): Promise<void> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  if (!shell) {
    writeLine(stderr, formatHelp());
    process.exitCode = 1;
    return;
  }

  if (!(SUPPORTED as readonly string[]).includes(shell)) {
    writeLine(
      stderr,
      `Unknown shell "${shell}". Supported: ${SUPPORTED.join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }

  writeLine(stdout, generateCompletionScript(shell as Shell, program));
}

export function generateCompletionScript(shell: Shell, program: Command): string {
  const tree = describeCommand(program);
  switch (shell) {
    case 'bash':
      return renderBash(tree);
    case 'zsh':
      return renderZsh(tree);
    case 'fish':
      return renderFish(tree);
  }
}

function formatHelp(): string {
  return [
    'Usage: marmot completions <shell>',
    '',
    'Print a shell completion script for the given shell to stdout.',
    `Supported shells: ${SUPPORTED.join(', ')}.`,
    '',
    'Install (recommended — write the script to a file once, source it from your rc):',
    '  # bash:',
    '  marmot completions bash > ~/.local/share/bash-completion/completions/marmot',
    '  # then add to ~/.bashrc (if not already):',
    '  #   [ -f ~/.local/share/bash-completion/completions/marmot ] && . ~/.local/share/bash-completion/completions/marmot',
    '',
    '  # zsh:',
    '  mkdir -p ~/.zsh/completions',
    '  marmot completions zsh > ~/.zsh/completions/_marmot',
    '  # then add to ~/.zshrc (if not already):',
    '  #   fpath=(~/.zsh/completions $fpath)',
    '  #   autoload -U compinit && compinit',
    '',
    '  # fish:',
    '  marmot completions fish > ~/.config/fish/completions/marmot.fish',
    '',
    'Avoid `eval "$(marmot completions bash)"` in your rc — it spawns marmot on every shell startup, adding ~200ms of cold-start latency.',
  ].join('\n');
}

type CommandNode = {
  name: string;
  description: string;
  options: Array<{ flags: string[]; description: string; takesValue: boolean }>;
  subcommands: CommandNode[];
};

function describeCommand(command: Command): CommandNode {
  const node: CommandNode = {
    name: command.name(),
    description: command.description(),
    options: command.options.map((opt) => {
      const flags = parseFlags(opt.flags);
      return {
        flags,
        description: opt.description,
        takesValue: /[<[]/.test(opt.flags),
      };
    }),
    subcommands: command.commands.map(describeCommand),
  };
  return node;
}

function parseFlags(raw: string): string[] {
  // "-p, --prompt-file <file>" → ["-p", "--prompt-file"]
  return raw
    .split(/[,\s]+/)
    .filter((tok) => tok.startsWith('-') && !tok.startsWith('<') && !tok.startsWith('['));
}

/* ---------- bash ---------- */

function renderBash(root: CommandNode): string {
  const topSubs = root.subcommands.map((c) => c.name).join(' ');
  const cases: string[] = [];
  for (const sub of root.subcommands) {
    cases.push(...emitBashSub(sub, [sub.name]));
  }

  return `# marmot bash completion
_marmot_completion() {
  local cur prev words cword
  _init_completion -n = || return

  local cmd_path=()
  local i=1
  while [[ $i -lt $cword ]]; do
    local word="\${words[i]}"
    if [[ "$word" != -* ]]; then
      cmd_path+=("$word")
    fi
    ((i++))
  done

  local path_str="\${cmd_path[*]}"

  case "$path_str" in
${cases.map((c) => `    ${c}`).join('\n')}
    "")
      if [[ "$cur" == -* ]]; then
        COMPREPLY=( $(compgen -W "${root.options.flatMap((o) => o.flags).join(' ')}" -- "$cur") )
      else
        COMPREPLY=( $(compgen -W "${topSubs}" -- "$cur") )
      fi
      ;;
  esac
}

complete -F _marmot_completion marmot
`;
}

function emitBashSub(node: CommandNode, path: string[]): string[] {
  const flags = node.options.flatMap((o) => o.flags).join(' ');
  const subs = node.subcommands.map((s) => s.name).join(' ');
  const completions = subs ? `${flags} ${subs}`.trim() : flags;
  const lines: string[] = [];
  lines.push(
    `"${path.join(' ')}") COMPREPLY=( $(compgen -W "${completions}" -- "$cur") );;`,
  );
  for (const child of node.subcommands) {
    lines.push(...emitBashSub(child, [...path, child.name]));
  }
  return lines;
}

/* ---------- zsh ---------- */

function renderZsh(root: CommandNode): string {
  const subs = root.subcommands
    .map((c) => `    '${escapeZsh(c.name)}:${escapeZsh(c.description)}'`)
    .join(' \\\n');

  const subFns = root.subcommands.map((sub) => emitZshSub(sub, [sub.name])).join('\n\n');

  const subDispatch = root.subcommands
    .map((sub) => `      (${sub.name}) _marmot_${sanitize(sub.name)} ;;`)
    .join('\n');

  return `#compdef marmot
# marmot zsh completion

_marmot() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C \\
${root.options.map((o) => formatZshOption(o)).join(' \\\n')} \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _values 'marmot command' \\
${subs}
      ;;
    args)
      case $line[1] in
${subDispatch}
      esac
      ;;
  esac
}

${subFns}

_marmot "$@"
`;
}

function emitZshSub(node: CommandNode, path: string[]): string {
  const fnName = `_marmot_${sanitize(path.join('_'))}`;
  const opts = node.options.map((o) => formatZshOption(o)).join(' \\\n');

  if (node.subcommands.length === 0) {
    return `${fnName}() {
  _arguments \\
${opts || "    '*::arg:'"}
}`;
  }

  const subValues = node.subcommands
    .map((c) => `    '${escapeZsh(c.name)}:${escapeZsh(c.description)}'`)
    .join(' \\\n');

  const dispatch = node.subcommands
    .map((c) => `      (${c.name}) _marmot_${sanitize([...path, c.name].join('_'))} ;;`)
    .join('\n');

  const childFns = node.subcommands
    .map((c) => emitZshSub(c, [...path, c.name]))
    .join('\n\n');

  return `${fnName}() {
  local context state state_descr line
  typeset -A opt_args

  _arguments -C \\
${opts ? `${opts} \\\n` : ''}    '1: :->subcommand' \\
    '*::arg:->args'

  case $state in
    subcommand)
      _values '${escapeZsh(node.name)} subcommand' \\
${subValues}
      ;;
    args)
      case $line[1] in
${dispatch}
      esac
      ;;
  esac
}

${childFns}`;
}

function formatZshOption(opt: { flags: string[]; description: string; takesValue: boolean }): string {
  const flagsList = opt.flags;
  const desc = escapeZsh(opt.description || '');
  const valueSpec = opt.takesValue ? ': :_files' : '';
  if (flagsList.length === 1) {
    return `    '${flagsList[0]}[${desc}]${valueSpec}'`;
  }
  return `    '(${flagsList.join(' ')})'{${flagsList.join(',')}}'[${desc}]${valueSpec}'`;
}

function escapeZsh(s: string): string {
  return s.replace(/'/g, "''").replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/:/g, '\\:');
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}

/* ---------- fish ---------- */

function renderFish(root: CommandNode): string {
  const lines: string[] = ['# marmot fish completion', ''];

  // Disable file completion at top level after the binary name.
  lines.push("complete -c marmot -f");
  lines.push('');

  // Top-level subcommands as conditional completions when no subcommand has been entered.
  const topSubs = root.subcommands.map((c) => c.name).join(' ');
  lines.push(`function __marmot_needs_command`);
  lines.push(`  set -l cmd (commandline -opc)`);
  lines.push(`  if [ (count $cmd) -le 1 ]; return 0; end`);
  lines.push(`  for i in $cmd[2..-1]`);
  lines.push(`    switch $i`);
  lines.push(`      case ${topSubs}; return 1`);
  lines.push(`    end`);
  lines.push(`  end`);
  lines.push(`  return 0`);
  lines.push(`end`);
  lines.push('');

  for (const sub of root.subcommands) {
    lines.push(
      `complete -c marmot -n '__marmot_needs_command' -a '${sub.name}' -d '${escapeFish(sub.description)}'`,
    );
  }
  lines.push('');

  // Per-subcommand options + nested subcommands.
  emitFishCommands(root.subcommands, [], lines);

  return lines.join('\n') + '\n';
}

function emitFishCommands(nodes: CommandNode[], parentPath: string[], lines: string[]): void {
  for (const node of nodes) {
    const path = [...parentPath, node.name];
    const cond = `__fish_seen_subcommand_from ${node.name}`;
    // Avoid bleeding deeper-path completions into a parent-level context: only
    // emit if no DEEPER subcommand from this node's path is visible.
    const guard =
      parentPath.length === 0
        ? cond
        : `${parentPath.map((p) => `__fish_seen_subcommand_from ${p}`).join('; and ')}; and __fish_seen_subcommand_from ${node.name}`;

    for (const opt of node.options) {
      const short = opt.flags.find((f) => f.startsWith('-') && !f.startsWith('--'));
      const long = opt.flags.find((f) => f.startsWith('--'));
      const parts = [`complete -c marmot -n '${guard}'`];
      if (short) parts.push(`-s ${short.replace(/^-/, '')}`);
      if (long) parts.push(`-l ${long.replace(/^--/, '')}`);
      if (opt.takesValue) parts.push('-r');
      if (opt.description) parts.push(`-d '${escapeFish(opt.description)}'`);
      lines.push(parts.join(' '));
    }

    for (const child of node.subcommands) {
      lines.push(
        `complete -c marmot -n '${guard}' -a '${child.name}' -d '${escapeFish(child.description)}'`,
      );
    }

    if (node.subcommands.length > 0) {
      emitFishCommands(node.subcommands, path, lines);
    }
  }
}

function escapeFish(s: string): string {
  return (s ?? '').replace(/'/g, "\\'");
}
