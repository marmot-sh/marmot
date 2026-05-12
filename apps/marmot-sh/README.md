# marmot-sh

Unscoped install alias for **marmot** — the unified CLI for AI generation, web search, and enrichment data, built for agents and scripts.

## Install

```bash
npm install -g marmot-sh
```

The installed binary is `marmot`.

## Usage

```bash
marmot 'tell me a joke'
marmot search 'news about apple' | marmot 'give me 5 bullet highlights'
gh pr diff | marmot 'write a commit message under 60 chars'
```

See [marmot.sh](https://marmot.sh) for full docs, the verb reference, and provider catalog.

## Agent skill

Marmot ships an agent skill for Claude Code, OpenCode, Codex, and similar harnesses. Two ways to install:

```bash
# Interactive — pick "Install or update agent skill" from the menu
marmot setup

# One-shot via the open skills CLI
npx skills add https://github.com/marmot-sh/marmot --skill marmot
```

Either path installs to the canonical `~/.agents/skills/marmot/` and creates per-harness symlinks. Claude Code users can also install natively:

```bash
/plugin marketplace add marmot-sh/marmot
/plugin install marmot@marmot
```

See the [`@marmot-sh/cli` README](https://www.npmjs.com/package/@marmot-sh/cli#agent-skill) for full details.

## Uninstall

```bash
# Remove the CLI
npm uninstall -g marmot-sh            # or @marmot-sh/cli

# Optional — also remove config, presets, pipelines, cache, sessions, usage:
rm -rf "${MARMOT_HOME:-$HOME/.marmot}"

# Optional — also remove the agent skill (if installed):
rm -rf ~/.agents/skills/marmot
rm -f  ~/.claude/skills/marmot ~/.opencode/skills/marmot ~/.codex/skills/marmot
```

## What this package is

This is a thin install alias for the canonical [`@marmot-sh/cli`](https://www.npmjs.com/package/@marmot-sh/cli) package. The bundled binary is bit-identical — only the package name differs. The unscoped name exists for two reasons:

1. **Shorter install command** — `npm i -g marmot-sh` vs `npm i -g @marmot-sh/cli`.
2. **Discoverability** — appears in plain `npm search marmot` results.

If you're already comfortable with scoped packages, install `@marmot-sh/cli` directly. Both produce the same `marmot` binary.

## License

MIT — see `LICENSE`.
