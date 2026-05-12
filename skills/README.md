# Marmot agent skills

Drop-in skill files that teach a coding agent to use the `marmot` CLI. The skill is standalone — once installed, the agent can answer questions about Marmot and invoke it without fetching anything from the web.

## What's in here

```
marmot/
  SKILL.md                  # entry point the agent reads first
  references/
    ai.md                   # text, image, speech, transcription verbs
    web.md                  # search, scrape, answer, map, crawl, research, findall, get, tasks
    data.md                 # enrich, lookup, verify
    config.md               # config, presets, sessions, providers, caching, setup
```

The agent reads `SKILL.md` to learn what marmot is and which reference to consult; references hold the full flag detail and provider matrices.

## Install

### Recommended: built-in installer (no extra dependencies)

If you already have `marmot` installed:

```bash
marmot setup
```

The setup walkthrough has an "Agent skill" step that detects whether the skill is installed, fetches it from GitHub if not, and creates per-harness symlinks. Pick global (`~/.agents/skills/marmot`) or project-local (`./.agents/skills/marmot`). Re-running setup updates the skill in place if a newer version is available.

### Alternate: `skills` CLI

If you'd rather use the [Vercel `skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add https://github.com/marmot-sh/marmot --skill marmot
```

The CLI auto-detects your harness (Claude Code, OpenCode, Codex, and others) and follows the same `.agents/skills/<name>/` canonical pattern with per-harness symlinks. Re-running the command updates an existing install.

### Claude Code native plugin

Claude Code users can install through the native plugin marketplace:

```bash
/plugin marketplace add marmot-sh/marmot
/plugin install marmot@marmot
```

This reads the repo's `.claude-plugin/marketplace.json` and installs the skill into Claude Code's plugin directory. Re-running `/plugin install marmot@marmot` updates an existing install.

### Manual install

If you don't have the `skills` CLI, copy the `marmot/` directory into your harness's skill directory.

```bash
# Claude Code
cp -r marmot ~/.claude/skills/

# OpenCode
cp -r marmot ~/.opencode/skills/

# Codex
cp -r marmot ~/.codex/skills/
```

Or symlink during development so updates flow through:

```bash
ln -s "$(pwd)/marmot" ~/.claude/skills/marmot
```

Most agent harnesses look for skills under `~/.<harness>/skills/<skill-name>/SKILL.md`. If your harness uses a different layout, the file the agent must read first is `marmot/SKILL.md`.

### Recommended: install via the CLI

```bash
marmot setup
# pick "Agent skill" → "Install" → choose scope and harnesses
```

The CLI installer pins the download to a specific commit SHA before fetching, writes per-harness symlinks, and stamps `.skill-version` so future `marmot setup` runs detect updates. Prefer this over a manual download.

### Manual install (no CLI, no clone)

If you need to install without the CLI (e.g., on a machine without Node), use this script. **Pin `SHA` to a specific commit** rather than `main` so the bytes you install match an audited version:

```bash
SHA=<paste-a-commit-sha-from-https://github.com/marmot-sh/marmot/commits/main>
TMPDIR=$(mktemp -d) && \
  curl -sSL "https://github.com/marmot-sh/marmot/archive/${SHA}.tar.gz" \
    | tar -xz -C "$TMPDIR" --strip-components=1 && \
  mkdir -p ~/.agents/skills && \
  rm -rf ~/.agents/skills/marmot && \
  mv "$TMPDIR/skills/marmot" ~/.agents/skills/marmot && \
  rm -rf "$TMPDIR" && \
  ln -sfn ~/.agents/skills/marmot ~/.claude/skills/marmot
```

Replace the final `~/.claude/skills/` symlink target with `~/.opencode/skills/` or `~/.codex/skills/` for those harnesses, or repeat for each. Avoid `heads/main` directly — a force-push or compromised commit between resolve and download could ship code you didn't expect.

## Updating

```bash
marmot setup            # the "Agent skill" step detects outdated installs
# or
npx skills add https://github.com/marmot-sh/marmot --skill marmot
# or, in Claude Code
/plugin install marmot@marmot
```

All three paths overwrite in place. If you symlinked into a clone of the marmot repo, just `git pull` the clone.

## License

MIT, same as the marmot repo.
