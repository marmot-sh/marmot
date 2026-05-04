---
name: marmot
description: Use the `marmot` CLI to outsource AI generation (text, image, speech, transcription), web retrieval (search, scrape, answer, map, crawl, deep research, find-all entities), and people/email/org data lookup (enrich, lookup, verify) to dedicated providers without leaving the terminal. Same flag shape across providers; switch with `--provider`. Default plain-text output for piping; `--json` for structured envelopes.
---

# marmot

`marmot` is a single CLI that wraps many AI and web/data providers behind one verb shape. Use it instead of in-context model calls or hand-rolled SDK code when the work is metered (search, enrichment, deliverability) or when a script-shaped pipeline is the right output.

## First step in every session

Before invoking any verb, read the current config:

```bash
marmot config show --json
```

That envelope returns:
- `defaults.<verb>` — which provider backs each verb (omit `--provider` when set)
- `providers.<slug>` — enabled/disabled state, custom env var names, response cache settings
- `presets` — saved invocation bundles available via `marmot @<name>`
- `cache.totals` and `cache.providers` — what's already cached

Use it to decide whether to pass `--provider`, whether the response cache will short-circuit your call, and which presets are pre-tuned for the task. If sessions matter for the task, also run `marmot session list`.

## Verb surface

| Category | Verb | One-liner |
| --- | --- | --- |
| AI | `run` | Text generation. Default verb; `marmot "..."` is shorthand. |
| AI | `image` | Image generation. TTY plays a path; piped emits raw bytes. |
| AI | `speak` | Text-to-speech. TTY plays audio; piped emits raw bytes. |
| AI | `transcribe` | Speech-to-text. Plain-text by default, `--json` for envelope. |
| Web | `search` | Web search. |
| Web | `scrape` | URL(s) → markdown / text / html. |
| Web | `answer` | Query → answer + citations. |
| Web | `map` | Domain → list of URLs. |
| Web | `crawl` | Domain → walked pages (async on Firecrawl, sync on Tavily). |
| Web | `research` | Async deep research, optional schema. |
| Web | `findall` | Async list-of-entities builder. |
| Web | `get` / `tasks` | Poll/manage async tasks. |
| Data | `enrich` | Identifier → full person or org record. |
| Data | `lookup` | Filters → list of people, orgs, or emails. |
| Data | `verify` | Email deliverability check. |

For any verb: `marmot --help <verb>` prints the full flag list. For a category-deep dive, see `references/`.

## When to use marmot

**Use it when:**
- The task is metered/billable (every search, enrichment, or verification call costs real money — caching matters).
- You need a deterministic shell-pipeable result (`marmot search ... | marmot "summarize"`).
- The agent harness's context is precious and the work is bulk or repetitive.
- You want to swap providers behind one flag without rewriting code.

**Don't use it when:**
- A one-off prompt fits in your context — in-context generation is usually cheaper than spawning marmot.
- You're parsing free-form text output by hand. Pass `--json` and parse the envelope.

## Universal patterns

- **Output channels:** results on stdout, status (spinners, cache hints, warnings) on stderr. Pipelines stay clean.
- **Output formats:**
  - `marmot run`, `marmot transcribe`, `marmot answer`, `marmot research` default to plain text.
  - `marmot image`, `marmot speak` are TTY-aware: human terminal gets a file path / playback; pipe gets raw bytes.
  - All web/data verbs default to a structured JSON envelope.
  - `--json` forces the envelope on plain-text verbs; `--text` does the inverse where applicable.
- **Provider override:** `--provider <slug>` on every verb beats `defaults.<verb>.provider` from config.
- **Auth:** marmot reads provider keys from env vars (`OPENAI_API_KEY`, `TAVILY_API_KEY`, etc.). Per-call override: `--api-key <key>`. Config can override env-var *names* (e.g. read `MY_APOLLO_KEY` instead of `APOLLO_API_KEY`) — surfaced in `marmot config show --json` under `providers.<slug>.apiKeyEnvVar`.
- **Exit codes:** `0` success, `1` user/validation error, `2` provider/network error, `3` auth failure. Non-zero is always actionable.
- **Cache:** disabled by default. When enabled per-provider, repeat calls within TTL skip the network. `--no-cache` bypasses for one call; `--refresh` forces a fresh call and rewrites the cache.

## Where to read more

| Need to do… | Read |
| --- | --- |
| Generate text, images, speech, or transcribe audio | `references/ai.md` |
| Search the web, scrape pages, run deep research, build entity lists | `references/web.md` |
| Enrich a person/org, look up by filters, verify an email | `references/data.md` |
| Read or change config, presets, sessions, cache, or run setup | `references/config.md` |

## Three canonical examples

```bash
# 1. AI: text generation, plain-text out, pipeable.
marmot run "summarize the last commit message in 12 words"
git diff | marmot --stream "commit message under 60 chars"

# 2. Web: search with a default provider, JSON envelope.
marmot search "openrouter pricing 2026" --limit 5

# 3. Data: enrich a person by email, structured envelope.
marmot enrich --type person --email tcook@apple.com --provider hunter
```
