---
name: marmot
description: The `marmot` CLI bundles AI generation (text, image, video, speech, transcription), web retrieval (search, scrape, answer, map, crawl, research, findall), and data lookup (enrich, lookup, verify) behind one shell-pipeable verb shape. **Opt-in only:** use when the user invokes this skill directly, names marmot in their request, or has granted ongoing session permission. Otherwise keep using the agent's native capabilities. Plain-text default output; `--json` for structured envelopes.
---

# marmot

`marmot` is a single CLI that wraps many AI and web/data providers behind one verb shape. Use it instead of in-context model calls or hand-rolled SDK code when the work is metered (search, enrichment, deliverability) or when a script-shaped pipeline is the right output.

## Before invoking any verb

One command does the whole bootstrap:

```bash
marmot config show --json
```

The envelope returns:

- `marmotVersion` — installed CLI version. If this errors with `command not found: marmot`, ask the user to install with `npm install -g marmot-sh` (or `npm install -g @marmot-sh/cli` — same binary). Don't run the install yourself without permission.
- `readyProviders` — alphabetically sorted slugs of every provider that is callable right now (enabled in config + required credentials resolved). These are your valid `--provider <slug>` arguments. If a provider you want isn't here, the user is missing a key — surface that, don't try and hit a 401.
- `defaults.<verb>` — which provider (and model, for AI verbs) backs each verb. Omit `--provider` when a default is set.
- `providers.<slug>` — per-provider config: explicit enabled/disabled, custom env var name overrides, response cache settings.
- `presets` — saved invocation bundles available via `marmot @<name>`.
- `cache.totals` and `cache.providers` — what's already cached on disk.

Use this to decide whether to pass `--provider`, whether the response cache will short-circuit your call, and which presets are pre-tuned for the task. If sessions matter for the task, also run `marmot session list`.

Verbs and flags this skill describes target marmot 0.11.0 and later. Earlier versions may not have `marmot video`, sampling controls (`--temperature`, `--reasoning`, `--provider-option`), stdin image sniffing on `marmot run` and `marmot video`, the `readyProviders` envelope field, presets for web/data verbs, sigil verb-routing (`marmot @<name>` auto-dispatches to the matching verb), `marmot models --search`, the privacy-safe usage log (`~/.marmot/usage/<UTC-DATE>.jsonl`), `marmot usage`, or `marmot doctor`. Pre-0.6.0 versions also lack `marmot history`, `marmot usage --watch`, `marmot config get`, `marmot preset rename`, the `--session` flag on web/data verbs, the `--dry-run` flag on every verb, the `marmot doctor --fix` flag and verdict line, and the stable `preset_id` / `request_id` schema fields. Pre-0.6.1 versions default AI generation to a 120s timeout (now 300s for text/image/speech and 600s for transcription/video) and crash with a cryptic error on Node <20 instead of printing a friendly diagnostic. Pre-0.7.0 versions lack the universal preset/runtime merge engine — preset fields beyond a small core set didn't exist; positional inputs (`prompt`, `query`, `urls`, `audio`, `email`, `url`, `objective`, `text`) couldn't be set in a preset; list fields (`--file`, `--image`, `--stop`) replaced rather than appended; prompt-like text (`--system`, transcribe `--prompt`, crawl/research `--instructions`) didn't concatenate; runtime negation flags (`--no-stream`, `--no-binary`, `--cache`, `--no-refresh`, `--no-raw`, …) didn't exist so preset booleans were sticky-true; and the legacy `transcribe -i, --input` and `verify --email` flags were still around. Pre-0.8.0 versions emit JSON unconditionally for `marmot preset list/show`, `marmot session list/show`, `marmot providers list`, and `marmot tasks list/show` — the human-readable defaults, `--markdown` flag, and `tasks list` pagination (`--since`, default `--limit 20`) are 0.8.0+. Pre-0.9.0 versions don't have pipelines (named multi-stage workflows): `marmot pipeline create / update / list / show / delete / rename / run` and the `pipelines` top-level config key are 0.9.0+; the `@<name>` sigil only resolves presets in pre-0.9.0. Pre-0.10.0 versions hard-require a user prompt on `marmot run` even when a `system` prompt is in scope (so `marmot @pdf-to-md --file foo.pdf` fails validation); lack the universal `-q, --quiet` flag and the new TTY-aware stdout default (with `-o` set on a TTY, pre-0.10.0 verbs *also* echo the rendered output to the terminal — 0.10.0 stays silent and emits to a pipe only when one is attached); and the preset interactive model picker shows every cached model unsorted instead of a searchable, alphabetized, windowed list. Pre-0.11.0 versions use `show` instead of `get` for single-record retrieval: `marmot preset show <name>`, `marmot pipeline show <name>`, `marmot session show <name>`, `marmot tasks show <id>` are the 0.11.0+ `get` equivalents. The interactive preset walker on `marmot preset update` also shows current string/number/path values as gray placeholder text in pre-0.11.0 (forcing a full retype) — 0.11.0+ pre-fills the input buffer so Enter keeps and inline edits work. Suggest an upgrade if `marmotVersion` is below 0.11.0.

## Verb surface

| Category | Verb | One-liner |
| --- | --- | --- |
| AI | `run` | Text generation. Default verb; `marmot "..."` is shorthand. |
| AI | `image` | Image generation. TTY writes a path; piped emits raw bytes. |
| AI | `video` | Video generation (Veo, Sora, Kling, Hailuo, Seedance, Wan). Async; routinely 1–5 min. |
| AI | `transcribe` | Speech-to-text. Plain-text by default, `--json` for envelope. |
| AI | `speak` | Text-to-speech. TTY plays audio; piped emits raw bytes. |
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
| Ops | `usage` | Summarize call log: totals, breakdowns, cost per provider, errors. |
| Ops | `doctor` | Health check: CLI version, config, providers, logging state, disk usage. |

For any verb: `marmot --help <verb>` prints the full flag list. For a category-deep dive, see `references/`.

## Invocation gate

Marmot is opt-in. Default: keep using the agent's native capabilities. Switch to marmot only when one of these holds:

- The user invokes the skill directly.
- The user names marmot in the request ("use marmot to scrape…").
- An active marmot pipeline is in flight in this conversation.
- The user has granted ongoing session permission.

On the first marmot call in a session, confirm the verb + provider before dialing — these calls cost real money. Subsequent calls within the user's stated scope proceed without re-asking.

If a request would expand scope (new verb category, materially higher cost — e.g. switching to `video`), check before continuing.

When writing scripts whose purpose maps to marmot's wheelhouse (search, scrape, enrich, AI generation), ask whether the script should use marmot — don't decide for the user.

## Universal patterns

- **Output channels:** results on stdout, status (spinners, cache hints, warnings) on stderr. Pipelines stay clean.
- **Output formats:**
  - `marmot run`, `marmot transcribe`, `marmot answer`, `marmot research` default to plain text.
  - `marmot image`, `marmot speak` are TTY-aware: human terminal gets a file path / playback; pipe gets raw bytes.
  - All web/data verbs default to a structured JSON envelope.
  - `--json` forces the envelope on plain-text verbs; `--text` does the inverse where applicable.
- **Stdout when `-o` is set:** any verb that writes to a file via `-o <path>` now stays silent on the terminal by default and emits to a pipe if one is attached. `--quiet` / `-q` forces full silence (file is still written; pipe — if any — gets nothing). Stderr status (spinners, cache hints, warnings) is unaffected. To watch a stream AND save it, drop `-o` and use shell `tee`.
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
