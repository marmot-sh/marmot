<p align="center">
  <a href="https://marmot.sh?utm_source=github&utm_medium=main" target="_blank" rel="noopener noreferrer">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://assets.marmot.sh/marmot-logo.png" type="image/png">
      <img src="https://assets.marmot.sh/marmot-logo.png" height="64" alt="Marmot logo">
    </picture>
  </a>
  <br />
</p>

<h1 align="center">Welcome to Marmot</h1>

<div align="center">

[![Marmot documentation](https://img.shields.io/badge/Documentation-Marmot-orange.svg)](https://marmot.sh/docs?utm_source=github&utm_medium=main)
[![npm version](https://img.shields.io/npm/v/@marmot-sh/cli.svg)](https://www.npmjs.com/package/@marmot-sh/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/marmot-sh/marmot/blob/main/LICENSE)

</div>

[Marmot](https://marmot.sh?utm_source=github&utm_medium=main) is **a single CLI for AI generation and web/data retrieval**. It wraps providers like OpenAI, Anthropic, OpenRouter, Tavily, Exa, Apollo, and Hunter behind one consistent verb shape, so scripts and AI agents stay portable across vendors. Switching providers is a flag.

## Why Marmot

A lot of work in agent workflows is basic. A quick search, a one-shot enrichment, a simple text generation. Routing it through your orchestrator's heavy model wastes context and money. Marmot is a small, deterministic CLI that handles those calls outside the agent's context.

- 🔌 **One shape, many providers.** Same flags across OpenRouter, Anthropic, OpenAI, Vercel AI Gateway, Cloudflare Workers AI, and Ollama for AI; Brave, Exa, Firecrawl, Parallel, Tavily for web; Apollo, Hunter, PDL, Tomba, Bouncer, Datagma, ZeroBounce, Kickbox for data.
- 🤖 **Agent-friendly.** Default plain-text output for piping; `--json` envelope for structured parsing.
- 🧰 **Composable.** Chain verbs through pipes: `marmot search ... | marmot run "summarize"`.
- 🪵 **Predictable.** Stable exit codes, stderr/stdout separation, deterministic JSON envelope shapes.
- 💾 **Optional response cache.** Disabled by default; enable per-provider for repeat calls.
- 🪟 **Sessions and presets.** Persist chat history; save flag bundles for reuse.

## Installation

```bash
npm install -g @marmot-sh/cli
# or the shorter unscoped alias (same binary):
npm install -g marmot-sh
```

Or with pnpm / yarn / bun:

```bash
pnpm add -g @marmot-sh/cli
```

This installs the `marmot` binary globally. Verify with `marmot --version`.

## Setup

Set at least one provider API key, then run the wizard:

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
marmot setup
```

`marmot setup` is an interactive wizard that walks you through:

- Picking default providers and models for each verb.
- Enabling/disabling providers, custom env var names, and the response cache.
- Installing the agent skill (for Claude Code, OpenCode, Codex, and similar harnesses).

Re-run `marmot setup` any time to change settings, or use `marmot config set/show/unset` for individual changes.

## Quickstart

The default verb is text generation, so this works:

```bash
marmot "write me a haiku about caching"
```

Pipe stdin into the prompt:

```bash
git diff | marmot --stream "commit message under 60 chars"
```

Search the web:

```bash
marmot search "openrouter pricing 2026"
```

Enrich a person from an email:

```bash
marmot enrich --type person --email tcook@apple.com
```

## Command reference

| Category | Command | Purpose |
| --- | --- | --- |
| **AI** | `marmot <prompt>` | Text generation (alias for `marmot run`) |
| | `marmot run [prompt]` | Text generation, explicit |
| | `marmot image <prompt>` | Image generation |
| | `marmot speak <text>` | Text-to-speech |
| | `marmot transcribe <audio>` | Speech-to-text |
| **Web** | `marmot search <query>` | Web search |
| | `marmot scrape <url...>` | URL(s) → markdown |
| | `marmot answer <query>` | Answer with citations |
| | `marmot map <url>` | List URLs on a domain |
| | `marmot crawl <url>` | Walk a domain, return pages |
| | `marmot research <query>` | Async deep research |
| | `marmot findall <objective>` | Async list-of-entities builder |
| | `marmot get <id>` | Poll/retrieve an async task |
| | `marmot tasks list/show/...` | Manage async-task index |
| **Data** | `marmot enrich --type person\|org` | Identifier → full record |
| | `marmot lookup --type person\|org\|email` | Filters → list of entities |
| | `marmot verify <email>` | Email deliverability |
| **Config** | `marmot setup` | Interactive setup |
| | `marmot config show/set/unset/path` | Read/write config |
| | `marmot providers list` | Inspect providers |
| | `marmot cache stats/clear/refresh` | Manage caches |
| **Presets** | `marmot preset create/list/show/delete` | Saved invocation bundles |
| | `marmot @<name> ...` | Use a preset |
| **Sessions** | `marmot session create/use/show/...` | Persistent chat sessions |

For the full flag list on any verb, run `marmot <verb> --help` (or `marmot help <verb>`).

## Pipes

Marmot is built around shell pipes. stdout carries results, stderr carries spinners and status, so chains stay clean.

```bash
# search → summarize
marmot search "openrouter pricing" | marmot "summarize for a slack message"

# scrape → translate
marmot scrape https://example.com/article --format text | marmot "translate to French"

# git diff → commit message → clipboard
git diff | marmot --stream "commit message under 60 chars" | pbcopy
```

The `--json` flag forces a structured envelope for verbs that default to plain text:

```bash
marmot run --json "give me 3 ideas" | jq -r '.text'
```

## Presets

Save flag bundles with names. Reuse with `--preset` or the `@` sigil.

```bash
marmot preset create haiku --mode text \
  --provider anthropic --model claude-haiku-4-5-20251001 \
  --system "Reply only with a 5-7-5 haiku, no prose."

marmot @haiku "the sea at dusk"
```

Other modes: `image`, `speech`, `transcription`. Same pattern works for image styles, voice + speed bundles, and transcription language defaults. Override any preset flag at the call site.

## Sessions

Persist chat history across `marmot run` invocations.

```bash
marmot session create research --mode chat
marmot session use research

marmot run "What are the leading vector databases in 2026?"
marmot run "Of those, which support hybrid search?"
marmot run "Pick one and write a setup script"

marmot session show research      # totals, message count, window usage
marmot session export research    # export as jsonl or markdown
```

Stateless mode (logs only, no history threading) is also available with `--mode stateless`.

## Agent skill

Marmot ships an agent skill for Claude Code, OpenCode, Codex, and similar harnesses. The skill teaches the agent Marmot's verb shape, output formats, and provider matrix so it can compose calls without you writing prompts.

Run `marmot setup` and choose "Install or update agent skill", or install via the [`skills`](https://github.com/vercel-labs/skills) CLI:

```bash
npx skills add https://github.com/marmot-sh/marmot --skill marmot
```

Either path installs to the canonical `~/.agents/skills/marmot/` and creates per-harness symlinks (`~/.claude/skills/marmot`, `~/.opencode/skills/marmot`, `~/.codex/skills/marmot`).

## Documentation

Full docs at [marmot.sh/docs](https://marmot.sh/docs?utm_source=github&utm_medium=main):

- [Quickstart](https://marmot.sh/docs/quickstart) — set a key, run a prompt.
- [Installation](https://marmot.sh/docs/installation) — install the binary.
- [Providers](https://marmot.sh/docs/core/providers) — capability matrix and env vars.
- [Configuration](https://marmot.sh/docs/core/configuration) — config schema.
- [Caching](https://marmot.sh/docs/core/caching) — response cache details.
- [Command reference](https://marmot.sh/docs/command-reference/overview) — all verbs.

## Contributing

Contributions welcome. The repo is a pnpm + Turborepo monorepo:

```bash
git clone https://github.com/marmot-sh/marmot
cd marmot
pnpm install
pnpm test          # run all tests
pnpm typecheck     # run typecheck
pnpm check         # lint + typecheck across the workspace
```

The `marmot` CLI source lives under `apps/cli/`. Provider adapters live under `packages/<provider>/`. See individual package READMEs for adapter-specific notes.

## License

MIT. See [LICENSE](https://github.com/marmot-sh/marmot/blob/main/LICENSE) for details.
