# Changelog

All notable changes to Marmot are documented here.

This project follows [Semantic Versioning](https://semver.org/). Pre-1.0 minor bumps may include breaking changes; patch bumps will not.

## [Unreleased]

### Changed

- **Interactive preset model picker is now searchable + windowed + alphabetized.** When `marmot preset create` / `marmot preset update <name>` reaches the model field for a provider with a long cached model list (OpenRouter ships ~30), the picker now (a) shows a fixed visible window of 10 entries with scroll, (b) accepts typed input to filter by lowercase substring match across model id and label, and (c) sorts entries alphabetically by id so the list is scannable before you type. Behavior is identical for short lists — small providers still render every option. The `Keep current` / `Skip` and `Other / type a custom value` sentinels are preserved.

## [0.9.0] — 2026-05-10

A pipelines release. Where a preset configures a single verb invocation, a pipeline chains several invocations through stdin/stdout — `search → summarize → speak`, `scrape → extract → save`, etc. Define once with `marmot pipeline create`, invoke through the same `@<name>` sigil that routes presets. Each step runs as its own `marmot` subprocess, so per-step provider auth, retry behavior, and output are exactly what users would get typing the equivalent shell pipe — but discoverable, persisted in config, and shareable.

### Added

- **Pipelines: named multi-stage workflows.** A pipeline is a sequence of marmot invocations chained through stdin/stdout, defined once and invoked through the same `@<name>` sigil that routes presets today. Each step runs as its own `marmot` subprocess; stdout pipes into the next step's stdin; the final step's stdout is the user's stdout. Stored under a new top-level `pipelines` key in `~/.marmot/config.json`. Step shapes: inline verb (`{ verb, args, prompt, flags }`), preset reference (`{ preset: name, args }`), or — deferred for a future release — nested pipeline. New top-level command group: `marmot pipeline create / update / list / show / delete / rename / run`.
- **Substitution in pipeline steps:** `${input}` (all positional args joined), `${1}`, `${2}`, … (1-indexed positionals), plus `?`-suffixed optional variants. Required substitutions error before any subprocess is spawned: `Pipeline "<name>" step references ${input} but no input argument was provided.`
- **Sigil routing extended.** `@<name>` resolves to a pipeline first, then falls back to a preset. Name collisions between pipelines and presets are rejected at create time so resolution stays deterministic.
- **TTY-aware output for `pipeline list / show`** matches the 0.8.0 list/show pattern: human-readable on TTY, JSON when piped, `--json` / `--markdown` to force.

### Fixed

- **Sigil resolver no longer eats `@<name>` tokens that are flag values.** A `--step '@news-podcast'` in `marmot pipeline create` previously rewrote the step value to `--preset news-podcast`, breaking the parent command. The resolver now skips `@`-tokens whose previous argv element is a `--flag` (value-taking flag), preserving them for the parent verb.
- **Pipeline runner now spawns the right marmot binary.** Previously the runner spawned `process.argv[0]` (the node executable) directly with no script path, producing `Cannot find module '<verb>'` errors. The runner now picks `marmot` from PATH for production, `marmot-dev` when running through tsx, or whatever `MARMOT_BIN` is set to.

## [0.8.0] — 2026-05-09

A list/show output release. Seven JSON-only commands — `preset list`, `preset show`, `session list`, `session show`, `providers list`, `tasks list`, `tasks show` — now emit a human-readable table or grouped key/value layout when stdout is an interactive terminal, and fall back to today's JSON envelope when piped or redirected. New `--markdown` flag everywhere lets you embed output in docs / Slack / GitHub. `tasks list` gains `--since` and a `--limit` ceiling so the index can grow without flooding stdout. Behind the scenes, all seven commands consume one shared renderer, so the output story is consistent and adding new list/show commands is now a small lift.

### Added

- **TTY-aware human-readable defaults for list/show commands.** `marmot preset list`, `marmot preset show`, `marmot session list`, `marmot session show`, `marmot providers list`, `marmot tasks list`, and `marmot tasks show` now render a column-aligned table or grouped key/value layout when stdout is an interactive terminal. When piped or redirected (`| jq`, `> file`, etc.) they fall back to today's JSON envelope shape — same fields, same nesting — so existing tooling keeps working unchanged. Pass `--json` to always force JSON regardless of TTY, or `--markdown` to emit a markdown pipe-table (handy for embedding in docs / Slack / GitHub comments). `--json` and `--markdown` are mutually exclusive.
- **Pagination + `--since` filter on `marmot tasks list`.** New `--since <duration>` flag (e.g. `1h`, `24h`, `7d`) restricts results to tasks created within the window. Default `--limit` is 20 (max 1000); when more records match the filters, the human-mode footer reads `Showing N of M tasks. Pass --limit ... or filters ... to narrow.` JSON envelope gains `total` and `limit` fields so consumers can paginate programmatically.
- **Shared list/record renderer module** at `apps/cli/src/lib/list-renderer.ts` (with `output-mode-options.ts` for flag wiring). All affected commands consume the same renderer so output looks consistent across the seven commands.

## [0.7.1] — 2026-05-09

A preset-UX release. Bare `marmot preset create` (and `marmot preset update <name>`) now enter a guided walkthrough — the same kind of interactive walk `marmot setup` already had — instead of forcing users to remember every flag for every mode. The walk knows about each mode's preset-able fields, validates inputs at prompt time, hides fields the chosen provider doesn't actually honor, and surfaces current values when updating an existing preset. A behind-the-scenes refactor consolidates per-mode preset metadata into a single descriptor table, so the flag-driven path and the interactive walk read from the same source of truth — adding a new preset field touches one place going forward. Plus a small fix to the cache control semantics so a preset's `cache: true` actually means "cache on" without requiring a separate provider-level config flip.

### Changed

- **Preset truth wins for cache control** (web/data verbs: `search`, `scrape`, `answer`, `map`, `enrich`, `lookup`, `verify`). Previously a preset's `cache: true` was a no-op when the provider's `providers.<slug>.cache.enabled` was `false`; the only way to actually enable caching was to flip the provider-level master switch separately. Now an explicit `cache: true` on a preset (or `--cache` at runtime) forces caching on for that call regardless of the provider's master switch — matching the 0.7.0 framing that "preset is a complete configuration surface." The provider-level `cache.enabled` remains the default for calls with no explicit opinion. Explicit opt-out (`cache: false` / `--no-cache`) still wins over both. Implemented via a new `forceCache` field threaded through `withResponseCache`.

### Added

- **Interactive `marmot preset create` and `marmot preset update`.** Bare invocation (no field flags, on a TTY) enters a guided walkthrough that prompts for each preset-able field per mode. `create` walks: name (regex-validated, re-prompts on invalid) → mode (with verb labels) → provider (select; readiness markers — ✓/⚠ no key/⏸ disabled — pulled from `listProviderReadiness`; mode-scoped — text/image/speech/transcription/video filtered by adapter capability, web verbs by `providersForVerb`, data verbs by `DATA_PROVIDERS`) → model (select from the provider's modality-specific cache, fallback to free text if cache empty) → mode-specific fields. `update <name>` walks the existing preset's fields with current values shown as defaults; list fields offer Keep / Append / Replace; mode is locked. Per-field validation re-prompts on bad input: numeric ranges (e.g. `retries` ≥ 0, `topP` 0–1, `n` 1–10), date pattern (`YYYY-MM-DD` for `afterDate`/`beforeDate`), and a soft existence check on absolute / `~`-expanded paths (proceed-anyway for cwd-dependent paths). The flag-driven path (current behavior) is preserved unchanged. Errors clearly when stdin/stdout isn't a TTY.
- **Per-mode field descriptor table** — single source of truth at `apps/cli/src/commands/preset/field-descriptors.ts`. The flag-driven `buildPresetFromFlags` and the new interactive walks both consume the same table, so adding a new preset field only touches one place. Internal refactor; no user-visible behavior change.
- **Mutually-exclusive group support in the interactive walk.** Text mode's `schema | schemaFile | schemaModule` triad (and the same triad on `research` and `findall`) is asked as a single "structured output? pick one or none" question; only the chosen branch is walked.

## [0.7.0] — 2026-05-09

A presets release. Presets become a complete configuration surface for every verb: any positional argument and most flags are now preset-able, runtime values compose with preset values via consistent merge rules (scalars replace, lists append, prompt-like text concatenates), and runtime gets boolean negation flags so preset booleans aren't sticky. Schema additions are purely additive — every existing preset continues to validate. The release does carry five documented runtime-semantics shifts and removes two redundant CLI flags; see Changed and Removed below for migration guidance. The realistic shape of a preset is now "bake the persistent context, supply the per-call detail at runtime" — bake `--company acme.com` in an enrich preset and add `--first-name` per call; bake `--system` and `--file standards.md` in a run preset and add the runtime prompt and `--file code.ts`; bake `--query "site:linkedin.com"` in a search preset and append the per-call query.

### Added

- **Universal preset/runtime merge engine.** `applyPreset()` now dispatches per field by merge rule: scalar (replace), list-append (preset list + runtime list), or concat (`\n\n` join for prompt-like text). Rules are registered per `PresetMode` so subsequent verb features wire up without engine changes. `--provider-option` is intentionally kept as scalar replace despite being list-shaped — append would silently produce duplicate keys.
- **Expanded `text`-mode preset fields for `run`.** `presetTextSchema` now accepts `prompt`, `promptFile`, `file` (list), `image` (list), `output`, `text` (boolean), and `session`. Combined with the merge engine, presets can bake in a prompt prefix, a system prompt file, default attachments, an output path, and a session binding; runtime values compose with them rather than fully replacing.
- **`run` boolean negation flags: `--no-stream`, `--no-text`, `--no-json`.** Each is paired with the existing positive flag so a preset's `stream: true` / `text: true` / `json: true` can be flipped to `false` for a single call.
- **Expanded preset fields for AI verbs `image`, `speak`, `transcribe`, `video`.** `image` adds `prompt`, `promptFile`, `output`, `binary`, `b64`, `json`, `preview`, `session`. `speak` (speech mode) adds `text` (positional), `promptFile`, `output`, `binary`, `b64`, `json`, `play`, `wait`, `session`. `transcribe` (transcription mode) adds `audio` (positional), `output`, `text`, `json`, `session`. `video` adds `prompt`, `promptFile`, `image` (list — first-frame, last-frame), `output`, `binary`, `b64`, `json`, `session`. `prompt`/`text` fields concatenate with runtime positional; `image` list-appends.
- **Boolean negation flags for AI verbs.** `image` adds `--no-binary`, `--no-b64`, `--no-json`, `--preview`. `speak` adds `--no-binary`, `--no-b64`, `--no-json`, `--no-play`, `--no-wait`. `transcribe` adds `--no-text`, `--no-json`. `video` adds `--no-binary`, `--no-b64`, `--no-json`. Each pairs with its positive counterpart so preset booleans can be flipped at runtime.
- **Expanded preset fields for web verbs.** `search` / `answer` / `research` add `query` (concatenates with runtime). `scrape` adds `urls` (list — appends with runtime positional). `map` / `crawl` add `url` (scalar; positional URL becomes optional when the preset supplies it). `findall` adds `objective` (concatenates). All seven also add `cache`, `refresh`, `output`, `raw`, `session`. `crawl` and `research` add `wait`, `async`. The positional URL on `map` and `crawl` is now optional when a preset supplies one.
- **Boolean negation flags for web verbs.** New `--cache` flag (paired with existing `--no-cache`) so a preset's `cache: false` can be flipped at runtime; new `--no-refresh`, `--no-raw` on every web verb. Verb-specific: `--no-include-content` (search), `--no-include-search` (answer), `--no-allow-external` (crawl), `--no-wait`, `--no-async` (crawl/research/findall).
- **Expanded preset fields for data verbs `enrich`, `lookup`, `verify`.** `enrich` adds all 13 identifier fields (`email`, `emailHash`, `linkedin`, `phone`, `name`, `firstName`, `lastName`, `middleName`, `company`, `providerId`, `domain`, `website`, `ticker`) plus `cache`, `refresh`, `output`, `raw`, `session`. `lookup` adds `q`, `cursor`, all 10 person/org/email filter fields (`title`, `seniority`, `location`, `domain`, `industry`, `employees`, `tech`, `emailType`, `department`, `company`) plus the same shared fields. `verify` adds `email` (positional canonical) plus shared fields. All identifier and filter fields are scalar-replace; the realistic pattern is partial baking (preset establishes persistent context, runtime supplies the per-call identifier).
- **Boolean negation flags for data verbs.** New `--cache`, `--no-refresh`, `--no-raw` on each of `enrich` / `lookup` / `verify`.
- **`marmot preset create/update` ergonomic flags for data fields.** Added `--email`, `--email-hash`, `--linkedin`, `--phone`, `--name`, `--first-name`, `--last-name`, `--middle-name`, `--company`, `--provider-id`, `--domain`, `--website`, `--ticker` (enrich); `--q`, `--cursor`, `--title`, `--seniority`, `--location`, `--industry`, `--employees`, `--tech`, `--email-type`, `--department` (lookup).
- **`marmot preset create/update` ergonomic flags for the new fields.** `--output`, `--session`, `--prompt-file` (shared); `--binary` / `--no-binary`, `--b64` / `--no-b64`, `--preview` / `--no-preview` (image); `--play` / `--no-play`, `--wait` / `--no-wait` (speech / crawl / research / findall); `--cache` / `--no-cache`, `--refresh` / `--no-refresh`, `--raw` / `--no-raw`, `--async` / `--no-async`, `--url`, `--urls` (repeatable), `--objective` (web/data). The remaining new-field positionals (`prompt`, `text`, `audio`) are settable via direct config-file edit.
- **Documented permanent preset exclusions.** `--api-key`, `--preset`, and stdin-only modifiers (`--file-mime`, `--image-mime`, `--text-stdin`) are rejected at preset parse time via Zod `.strict()`. Reasons: security, recursion, and runtime-only context.
- **Documented preset path-resolution semantics.** Path-shaped preset fields (`systemFile`, `promptFile`, `file`, `image`, `output`, `schemaFile`, `schemaModule`, `audio`) resolve at use time: absolute as-is, `~` expanded to home, relative against the invocation cwd. Global presets in `~/.marmot/config.json` should prefer absolute or `~/...` paths.

### Changed

- **Breaking: `run --stop` switches from replace to append.** A preset with `stop: ["\`\`\`"]` plus a runtime `--stop "###"` previously produced `["###"]`; it now produces `["\`\`\`", "###"]`. This makes presets compositional — preset establishes baseline stops, runtime adds case-specific ones — but anyone who relied on the runtime list fully replacing the preset list will see different behavior. Workaround: define a separate preset, or omit `stop` from the preset.
- **Concat semantics for `--system` (text mode).** A preset with `system: "..."` plus runtime `--system "..."` previously dropped the preset value; now the two are joined with `\n\n` and both apply. Same logic applies to the new `prompt` field at the handler boundary.
- **Breaking: `transcribe --prompt` switches from replace to concatenate.** When both a `transcription` preset's `prompt` and a runtime `--prompt` are set, they now join with `\n\n` (compositional bias hints — the preset establishes baseline vocabulary; runtime adds call-specific names/jargon). Previously the preset value was dropped.
- **Breaking: `crawl --instructions` and `research --instructions` switch from replace to concatenate.** Same logic as transcribe — preset establishes baseline guidance, runtime adds call-specific direction; both apply.

### Fixed

- **`@typescript-eslint/no-explicit-any` warning in `packages/core/src/lib/presets.ts`.** Replaced `keyof any` with `PropertyKey` (the standard non-`any` equivalent for "any property key") in the `DistributiveOmit` helper. No behavior change.

### Removed

- **Breaking: `transcribe -i, --input <path>` flag.** The positional `[audio]` argument is the canonical surface, and the new `audio` field on `transcription`-mode presets covers the preset-side use case. Migration: `marmot transcribe --input foo.mp3` → `marmot transcribe foo.mp3`. Stdin and preset paths still work as documented.
- **Breaking: `verify --email <addr>` flag.** The positional `[email]` argument is canonical; the new `email` field on `verify`-mode presets covers the preset-side use case. Migration: `marmot verify --email foo@bar.com` → `marmot verify foo@bar.com` (or set `email` on a verify preset).

## [0.6.1] — 2026-05-08

A papercut release. AI generation no longer aborts at 120s in the middle of legitimately long-running calls (image HD, reasoning models, long-form TTS, multi-minute Whisper transcription) — defaults are now per-verb. Users on stale Node 18 (typically: nvm not loaded in a non-interactive shell) get a one-line diagnostic naming the detected version and binary path, instead of a cryptic `util.styleText is not a function` crash. Plus a lint cleanup.

### Added

- **Friendly Node version diagnostic at bin entry.** The bin shim now runs a Node version check before loading the main CLI. On Node <20, marmot prints a clear message naming the detected Node version and the path to the `node` binary in use, then exits 1 — replacing the cryptic `util.styleText is not a function` (or similar) crash users hit when their non-interactive shell loaded a stale system Node ahead of nvm. The Node 20 floor itself is unchanged.

### Changed

- **Per-verb default timeouts for AI generation.** Replaced the shared 120s default with per-verb defaults that match how long real generations actually take: `run` (text), `image`, `speak` now default to 300s; `transcribe` defaults to 600s; `video` stays at 600s. Web and data verbs (search, scrape, answer, map, crawl, lookup, research, findall, enrich, verify) continue to default to 120s. Anyone relying on the old 120s fail-fast on AI verbs can pass `--timeout 120` per-call or save it on a preset.

### Fixed

- **`prefer-const` lint error in `marmot usage`.** A stray `let` on a never-reassigned local variable was failing `pnpm check` in `apps/cli`. No runtime behavior change.

## [0.6.0] — 2026-05-08

A read-side observability release. The 0.5.0 usage log gets sub-day-aware local-time display, a live `--watch` tail, a per-call `marmot history` browser, a global `--dry-run` flag, and a verdict-driven `marmot doctor`. Presets get a stable `preset_id` and a `rename` verb. Several fixes close gaps in usage logging (AI error paths, async completions, web/data session binding). Three breaking changes to internal record/envelope shapes are documented inline; old records on disk continue to read tolerantly.

### Added

- **Stable `preset_id` UUID on every preset.** Auto-assigned at creation. Sessions and usage records reference presets by `preset_id` rather than slug; the display layer (`marmot session show`, `marmot session list`, chat-mode export) resolves `preset_id` → current slug at render time.
- **`marmot preset rename <old> <new>`** — atomic config rewrite. Validates that the new slug is well-formed and not already taken. Because the `preset_id` stays stable, sessions and historical usage records continue to resolve correctly to the new name.
- **`--session <name>` on every web/data verb.** `search`, `scrape`, `answer`, `map`, `crawl`, `research`, `findall`, `enrich`, `lookup`, `verify`, `video` accept `--session` so a metered call can be tagged with a session for `marmot usage --session <name>` filtering. Previously only AI verbs honored `--session`; web/data verbs hardcoded `session: null` even when a session was bound.
- **`marmot get` writes a completion usage record.** When an async task transitions to a terminal state (`done` / `failed` / `cancelled`), `marmot get` now appends a usage record using the task id as `request_id` so submit-time and completion-time rows join cleanly. Idempotent: a `usageLogged` flag on the local task record prevents double-logging across repeated `marmot get` calls.
- **Sub-day-aware, local-time `marmot usage` window header.** The header now renders timestamps in the user's local timezone and adapts to window length: sub-day windows include time-of-day (`Usage — last 1h (May 6 09:14 to 10:14)`), multi-day `--since` windows echo the duration token (`Usage — last 7d (May 1 to May 8)`), and explicit `--from/--to` shows just the range. Storage day-files remain UTC-named.
- **`--by day` groups records by local-TZ day** so "yesterday" matches the user's wall clock, not UTC.
- **`marmot doctor` verdict line.** The output now ends with a clear summary: `✓ Everything is in good order.` when clean, or `⚠ N issues found. Run X to fix.` where `X` is the highest-priority remediation across failed checks. Errors outrank warnings; within a level, the first-pushed check wins.
- **Per-check `fix_suggestion`** in `marmot doctor`. Each failing check carries an inline `→ command — description` hint in human output and a `fix_suggestion` field in the `--json` envelope so agents can self-heal programmatically. Suggestions cover corrupt config (`marmot config init --force`), zero providers ready (`marmot providers list --check-keys`), and oversized usage log (`marmot usage prune --older-than 90d`).
- **`marmot doctor --fix`** runs only safe, idempotent auto-fixes: writes a default `~/.marmot/config.json` when missing, prunes the usage log when over 100 MB. Refuses anything that needs user input (missing API keys, corrupt config, old Node — those are still surfaced as failing). The `--json` envelope gains `fixes_applied` and `fixes_skipped` arrays.
- **`marmot config get <key>`.** Single-key reader complementing `config set`. Primitives render bare for shell capture; objects and sub-buckets (`providers.openai.cache`, `text`, etc.) pretty-print as JSON. Missing keys exit non-zero with a stderr message so scripts can branch with `marmot config get x || ...`.
- **No-op cache warnings on AI-only providers.** AI verbs are intentionally never cached (sampling is non-deterministic; chat sessions mutate history per call), but the schema preserves `providers.<slug>.cache.enabled` for forward-compat with hybrid providers. `marmot config set providers.<ai-slug>.cache.enabled true` now warns on stderr that the setting is a no-op (it still persists). `marmot doctor` adds an informational `cache settings` check that lists AI-only providers with `cache.enabled: true`.
- **`--dry-run` on every verb.** Resolves options, auth, and the adapter, then prints a JSON envelope describing what would be sent and exits before making the provider call. No usage record is written, no async task is submitted, no chat history is appended. Useful for prompt iteration on metered AI verbs and pipeline debugging. Stripped from argv at the entrypoint and surfaced via `MARMOT_DRY_RUN=1` so every verb honors it without per-command wiring.
- **`marmot usage --watch`.** Live tail of today's usage file. Polls every 500ms; new records print one per line (or as JSONL with `--json`). Filters (`--provider`, `--verb`, `--failed-only`) apply per record. UTC midnight automatically rolls the watched file forward.
- **`marmot history`.** Lists individual recent calls (newest first), not aggregates. Default last 10, cap 1000. Same window/filter flags as `usage`, plus `--limit <n>`. Timestamps render in local timezone; `preset_id` is resolved to the current slug at render time so renames don't break readability.

### Fixed

- **AI verb error paths now log usage.** Previously, only successful adapter responses were recorded. When the provider failed (timeout, auth, 5xx), the call left no usage record, so `marmot usage --failed-only` undercounted. `run`, `image`, `speak`, `transcribe`, and `video` now wrap the adapter call in a try/catch that records `exit: 'error'` with a categorized error before re-throwing.

### Changed

- **Breaking:** `sessionMetaSchema` replaces the `preset` slug field with `preset_id` (UUID). Existing sessions that referenced presets by slug lose that linkage; new sessions created via `marmot session create --preset <slug>` resolve the slug to `preset_id` at creation.
- **Breaking:** `usageRecordSchema` now writes `preset_id` instead of `preset` (slug). Display layer resolves the current slug at render time. Old records on disk keep their original `preset` field; the aggregator tolerates both.
- **Breaking:** `logRecordSchema` (session log) replaces `preset` slug with `preset_id`.
- Existing presets in `~/.marmot/config.json` without `preset_id` get a fresh UUID assigned in-memory on next read; persisted on next write. No migration sweep.
- **Breaking:** `marmot usage` JSON envelope renames `calls` → `requests` everywhere it appears (`totals.calls`, `by_provider[].calls`, etc.). Tools that parse `.totals.calls` need to switch to `.totals.requests`.
- **Breaking:** Usage record schema field `call_id` → `request_id`. New records write `request_id`; the schema preprocess aliases the legacy `call_id` so pre-0.6.0 records on disk still parse and aggregate without migration. Async verbs now pass `request_id: task_id` (same join semantics, new field name).
- **Breaking:** `enrich` and `verify` write `quantity: { requests: 1 }` instead of `quantity: { calls: 1 }`. Old records keep their `calls` key; aggregation across the boundary shows both side-by-side until pruned.
- Helper `newCallId()` renamed to `newRequestId()` in `@marmot-sh/core`.

### Notes

- `marmot preset show` now includes the `preset_id` UUID in its output. End users typically never need to think about it; it's there so external tooling and audit flows can reference presets durably.

## [0.5.0] — 2026-05-06

### Added

- **Privacy-safe usage log.** Every metered call now writes a record to `~/.marmot/usage/<UTC-DATE>.jsonl` so users can answer "what did I run this week and how much did it cost?" without enabling the response cache or binding sessions. Wired into all 15 verbs: AI (`run`, `image`, `speak`, `transcribe`, `video`), web (`search`, `scrape`, `answer`, `map`, `crawl`, `research`, `findall`), data (`enrich`, `lookup`, `verify`). One file per UTC day, append-only, mode 0600.
- **Default-on, but only metadata.** Records carry verb, provider, model, preset name, non-sensitive flag values, boolean presence of sensitive flags, cached, duration, exit, error category, quantity (`results`, `pages`, `tokens_input`, `tokens_output`, `entities`, etc.), cost when the provider returns it (OpenRouter, AI Gateway), `call_id` (UUID; equals provider task id for async work so submit/poll/completion records can be joined), and `session` when bound. Never records prompts, queries, target URLs, or person identifiers by default.
- **`marmot usage` verb.** Summarize the log: totals, error rate, latency p50/p95, cost coverage, per-grouping breakdowns (provider/verb/day/model). Composable with `--since 1h|24h|7d|30d|4w`, `--from/--to`, `--by`, `--provider`, `--verb`, `--failed-only`, `--json`. Plus `marmot usage prune --older-than Nd` for cleanup.
- **`marmot doctor` verb.** Diagnostic health check: marmot version, Node version, config readability, provider readiness count, usage logging state with size warning, total `~/.marmot` size. Read-only, makes no API calls. `--json` for an envelope.
- **Opt-in sensitive recording.** `marmot config set logging.recordSensitive true` populates a new `sensitive` field on every record with the verb's actual prompt/query/URLs/identifier values. Off by default. The schema is verb-shaped so `marmot usage --json | jq '.. | .sensitive?'` gives an audit trail when the user wants one.
- **Per-call overrides.** Two global flags work on every verb: `--no-log` skips the record entirely; `--redact` writes the record but omits the `sensitive` payload (so a single private call doesn't land in an audit log even when sensitive recording is otherwise on). Env-var equivalents: `MARMOT_NO_LOG=1`, `MARMOT_REDACT=1`, `MARMOT_RECORD_SENSITIVE=1`.
- **`logging.enabled` and `logging.recordSensitive` config keys.** Both settable via `marmot config set` and surfaced in `marmot doctor`.

### Examples

```bash
# Default privacy posture — metadata only
marmot search "anything" --provider parallel --include-domains linkedin.com
marmot usage --by verb --since 7d

# Full audit trail, including queries and identifiers
marmot config set logging.recordSensitive true

# Redact one specific call even when sensitive recording is on
marmot search "private query" --redact

# Run a call without writing any record at all
marmot search "ephemeral" --no-log

# Cost rollup across a week
marmot usage --since 7d --json | jq '.totals.cost_usd_total'

# Health check
marmot doctor
```

### Notes

- Default-on logging is a behavior change from prior releases (which logged nothing unless a session was bound). It's privacy-safe by construction: only metadata, with sensitive payloads gated behind opt-in. Disable globally with `marmot config set logging.enabled false` or per call with `--no-log`.
- Async verbs use the provider's `task_id` as the `call_id` so a submit (with `--async`) and a later `marmot get` write records that join under one identifier.
- Per-day file rotation keeps individual files small for typical workloads. `marmot doctor` warns above 100 MB; users can prune with `marmot usage prune --older-than 90d`.
- The `--explain` / `--dry-run` flag floated alongside this work is deferred to a follow-up release; this release focuses on observability (logging, summarization, diagnostics).

## [0.4.7] — 2026-05-06

### Added

- **`@preset` sigil now infers the verb.** Previously `marmot @linkedin "query"` rewrote to `marmot --preset linkedin "query"`, which dispatched to the default text-run verb and errored: "preset has mode 'search' but this command requires 'text'." The sigil now peeks at the saved preset's mode and injects the matching verb when no explicit verb is present, so `marmot @linkedin "query"` dispatches to `search` automatically. Mode→verb mapping covers all 15 modes; the three AI exceptions (`speech`→`speak`, `transcription`→`transcribe`, `text`→default-run) are remapped. Explicit verbs still win — `marmot scrape @some-search-preset url` keeps `scrape` and surfaces a clean mode-mismatch error rather than silently swapping.
- **`marmot models --search <query>`**. Case-insensitive substring filter on model id and display name. Composes with existing `--provider` and `--mode` filters: `marmot models --search gpt --provider openai --mode text`. Defaults to `--limit 10` total matches across providers; pass `--limit 0` to remove the cap. Plain `marmot models` (no `--search`) keeps current behavior — full list per bucket.

### Fixed

- **Cache key normalization.** Two improvements that increase hit rate without conflating semantically-different requests:
  - **Trim leading/trailing whitespace on string values.** `"acme"` and `"  acme  "` now hash to the same cache key. Internal whitespace and word ordering remain significant — `"John Smith Acme"` and `"Acme John Smith"` still hash differently because search engines rank them differently and we don't want a hit on one to return the other's results.
  - **Sort filter arrays whose order doesn't change API semantics.** `includeDomains: ["a.com","b.com"]` and `["b.com","a.com"]` now produce the same cache key. Same for `excludeDomains`, `includePaths`, `excludePaths`, and `stop`. Other arrays (e.g. message history) remain order-sensitive.
- Case in queries remains a meaningful distinction (`Apple` company vs `apple` fruit are different search intents — separate cache entries by design).

## [0.4.6] — 2026-05-06

### Added

- **Preset coverage extends to all 10 web and data verbs.** Previously, `marmot preset create` only supported AI modes (`text`, `image`, `video`, `speech`, `transcription`). Saved bundles for search/research/etc. weren't possible, so every invocation re-typed the same provider/limit/domain flags. 0.4.6 adds preset modes for `search`, `scrape`, `answer`, `map`, `crawl`, `research`, `findall`, `enrich`, `lookup`, and `verify`.
- Each new preset mode validates only the fields that make sense for that verb. `search` carries provider, limit, depth, freshness, after-/before-date, include/exclude domains, include-content, retries, timeout. `research` carries provider, depth, schema (or schema-file), instructions, poll cadence, max-wait. `enrich` carries provider, type (person/org), min-likelihood, require/fields. Per-call identifiers (`--email`, `--linkedin`, `--query`, etc.) intentionally stay as call-time flags, not preset-shaped.
- `--preset <name>` flag (and `@name` shorthand) wired onto every web/data verb command. Same merge semantics as the AI verbs: explicit flags win, preset values fill `undefined` slots, mode discriminator is dropped.

### Examples

```bash
marmot preset create linkedin-people \
  --mode search --provider parallel --include-domains linkedin.com --limit 25
marmot search "Daniel Francis Abel Police" --preset linkedin-people
marmot @linkedin-people "another query"

marmot preset create deep-research-fintech \
  --mode research --provider parallel --depth deep \
  --schema-file ~/schemas/research-output.json --instructions "Cite primary sources."
marmot @deep-research-fintech "competitive analysis on stripe vs adyen"

marmot preset create enrich-people-pdl \
  --mode enrich --provider pdl --type person --min-likelihood 8
marmot @enrich-people-pdl --email tcook@apple.com
```

### Fixed

- **Ollama: spurious AI SDK warning on every call.** Commander defaults `--stop` to `[]`, and that empty array was forwarded to the Vercel AI SDK as `stopSequences: []`. The SDK's Ollama provider doesn't implement `stopSequences`, so it emitted `AI SDK Warning (ollama.responses / <model>): The feature "setting" is not supported. stopSequences` to stderr on every Ollama text run, even when the user hadn't passed `--stop`. The empty array is now treated as absent, and the Ollama adapter only forwards `stopSequences` when the user actually supplied stop tokens. (When users do pass `--stop`, the warning still appears — correctly — flagging that Ollama won't honor it.)

### Notes

- Strictly additive: existing presets (text/image/video/speech/transcription) continue to validate without change. New preset shapes use strict zod unions; passing a flag from the wrong mode (e.g. `--temperature` on a search preset) is silently dropped at flag-build time, same as the AI verbs.
- Schema field names match commander's option keys verbatim (e.g. `includeDomains` as a CSV string, not `string[]`) so the generic `applyPreset` merge engine fills option slots without per-verb glue.

## [0.4.5] — 2026-05-06

### Fixed

- **Parallel search**: 0.4.4 placed `include_domains`, `exclude_domains`, and `after_date` at the top level of the request body. Per the [V1SearchRequest spec](https://docs.parallel.ai/api-reference/search-api/search), those fields are nested under `advanced_settings.source_policy` — sending them at the top level returned `422 Request validation error` on every filtered call. The 0.4.4 user repro `marmot search "..." --include-domains "linkedin.com" --provider parallel` returned 422; with this fix it returns three `linkedin.com` URLs from a live API call.
- **Parallel `--limit`**: previously approximated via `max_chars_total = limit*500`. Now maps directly to the documented `advanced_settings.max_results` field.
- **Firecrawl `sources`**: 0.4.4 sent `["web"]` (array of strings); per the [`/v2/search` spec](https://docs.firecrawl.dev/api-reference/v2-openapi.json) it's an array of objects (`[{ "type": "web" }]`). The string form may have worked via back-compat coercion; the documented shape is now used.
- **Firecrawl `tbs` cdr format**: zero-pads month and day to match the spec example exactly (`cd_min:01/15/2026` not `cd_min:1/15/2026`).
- **Parallel adapter errors** now surface the response body (e.g. `ErrorResponse.error.message`) alongside the status code. A `422` no longer reads as `Parallel search failed with status 422.` — it includes the offending-field message Parallel returns, which is what makes wire-shape drift visible immediately.

### Notes

- All changes live-tested against real Parallel / Exa / Firecrawl APIs with keys from the maintainer's env. Mocked-fetch tests can't catch contract drift; live tests are the only way to verify the wire format matches the spec. This shipped because 0.4.4's tests verified our adapter sends a specific shape, but didn't verify that shape was what the API accepts.

## [0.4.4] — 2026-05-06

### Fixed

- `marmot search` no longer silently drops filters that the resolved provider's API doesn't honor. Surfaced when `--include-domains "linkedin.com" --provider parallel` returned everything but LinkedIn pages.
  - **Parallel** previously dropped `--include-domains`, `--exclude-domains`, AND `--freshness`. All three are now wired through (`include_domains`, `exclude_domains`, and a freshness→`after_date` mapping).
  - **Exa** previously dropped `--freshness`. Now mapped to `startPublishedDate`.
  - **Firecrawl** previously dropped `--freshness`. Now mapped to Google-style `tbs=qdr:d|w|m|y`.
- When a flag truly isn't supported by the resolved provider's API (Brave's domain filters, absolute-date filters on Brave/Tavily, `--before-date` on Parallel), `marmot search` now warns on stderr instead of silently dropping the flag, so a user sees that their filter didn't apply.

### Added

- `--after-date <YYYY-MM-DD>` and `--before-date <YYYY-MM-DD>` on `marmot search` for absolute publication-date filtering. Honored by Exa (`startPublishedDate` / `endPublishedDate`), Firecrawl (Google-style `tbs=cdr,cd_min,cd_max`), and Parallel (`after_date` only — Parallel's API has no upper bound today). Brave and Tavily warn on stderr.
- `WebSearchInput` type gains `afterDate` and `beforeDate` (both `YYYY-MM-DD` strings). Type comments document per-provider honor/ignore behavior.
- New per-provider filter-support matrix in the [search docs](/docs/reference/commands/data/search) and the agent skill's `references/web.md`.
- Date-input validation runs before any API call: `--after-date` / `--before-date` reject non-ISO formats (`2026/01/15`), impossible calendar dates (`2026-02-30`, `2026-13-45`, leap-year nuance), and inverted ranges (`--after-date 2026-12-31 --before-date 2026-01-01`). Same-day windows (`after === before`) are allowed.

### Notes

- Explicit `--after-date` wins over relative `--freshness` on every provider that honors both. `--after-date` and `--before-date` together produce a closed range on Exa and Firecrawl; on Parallel only the lower bound applies.
- 15 new tests across `parallel-provider.test.ts`, `exa-provider.test.ts`, and `firecrawl-provider.test.ts` cover pass-through, mapping, precedence, and omission paths.

## [0.4.3] — 2026-05-06

### Added

- **Presets now cover the full AI flag surface.** Each preset mode gained the flags that landed in 0.3.0 / 0.3.1 but never propagated into preset support. Strictly additive — existing presets validate without change.
  - **Text**: `system-file`, `schema`, `schema-file`, `schema-module`, `temperature`, `max-tokens`, `top-p`, `seed`, `stop` (repeatable), `reasoning`, `provider-option` (repeatable), `stream`, `json`.
  - **Image**: `seed`, `negative`, `provider-option`.
  - **Speech**: `instructions`, `provider-option`.
  - **Transcription**: `prompt`, `provider-option`.
- **New `video` preset mode.** `marmot video` shipped in 0.3.0 without preset support; this release adds it. New `presetVideoSchema` covers `aspect`, `resolution`, `duration`, `fps`, `audio`, `n`, `seed`, `provider-option`, plus the shared `provider`/`model`/`retries`/`timeout`. `marmot video` gains `--preset <name>` and the `@name` sigil (via the global rewrite, no per-verb plumbing needed).
- `--provider-option <key=value>` on `marmot video`. Plumbs through to the `generateVideo` adapter call. Vercel's video adapter already reads `providerOptions`; OpenRouter passes them through silently for now.
- New `VideoPreset` type export in `@marmot-sh/core`.

### Notes

- All preset field names are camelCase to match commander's parsed option keys verbatim. Runtime merging is unchanged — `applyPreset` already iterates preset keys and fills `undefined` slots, so any new field automatically flows into the verb's options without per-verb glue. The `--preset` flag and the `@name` sigil work the same way they did in earlier versions.

## [0.4.2] — 2026-05-06

### Maintenance

- Republished both `@marmot-sh/cli` and `marmot-sh` to refresh maintainer metadata on npm. The published-by email on these packages now resolves to the `team@paradoc.dev` group address instead of an individual contributor email. No code changes from 0.4.1 — the `dist/cli.js` artifact is byte-identical.

## [0.4.1] — 2026-05-06

### Fixed

- `marmot setup` no longer reports "Agent skill: not installed" when run from a project directory that has a skill installed. Detection now walks upward from `process.cwd()` looking for a project-root marker (`.agents`, `.claude`, `.codex`, or `.opencode`) and uses the first marker-bearing ancestor as the project root for skill-state checks. Both the setup hub's status table and the menu-item hint now consult project scope alongside global, so a project install surfaces as `installed in project (<harness>)` (or `installed (global + project)` if both exist) instead of being invisible. The Agent skill submenu (`marmot setup` → "Agent skill") gets the same fix. Stops before `$HOME` so the global agent dirs (e.g. `~/.claude/`) can't be misread as project roots.

### Added

- New `findProjectRoot(cwd)` export in `@marmot-sh/core` for the upward walk used by setup-skill. Useful for any future code that needs the same "this is a project" signal.
- The "project not installed" line in `marmot setup` → "Agent skill" status now shows which directory was searched, so wrong-cwd mistakes are visible at a glance.

## [0.4.0] — 2026-05-06

### Breaking

- `marmot providers list` output shape changed:
  - Each row no longer carries a top-level `defaultModel`. The field was a relic from before marmot expanded to multi-modality — it only ever held the *text* default but was unlabeled, so an OpenAI row showing `gpt-4o-mini` looked like an across-the-board default while hiding the separate image / speech / transcription / video defaults. Per-verb defaults already live in `defaults.<verb>` in `marmot config show --json`. Web and data providers never had a meaningful `defaultModel` either.
  - The output set grew from 6 rows (AI only) to 19 rows. Web providers (Brave, Exa, Firecrawl, Parallel, Tavily) and data providers (Apollo, Hunter, PDL, Tomba, Bouncer, Datagma, ZeroBounce, Kickbox) are now first-class in the listing — they were silently omitted before.
  - Each row carries a new `category: "ai" | "web" | "data"` field. `cachePath` is now optional (AI-only; web and data providers have no model cache).

### Added

- `marmot providers list --check-keys` — diagnostic flag that layers per-provider readiness onto each row: `enabled` (config toggle), `keys[]` (every env var marmot would read with set/unset booleans), and `ready` (overall callable signal). Useful for "why isn't X ready?" debugging.
- `marmotVersion` field in `marmot config show --json` — the installed CLI version. Distinct from the existing schema-version `version: 1` field. Saves an agent from running `marmot --version` separately.
- `readyProviders` field in `marmot config show --json` — alphabetically sorted slugs of every provider that's callable right now (enabled in config + required credentials resolved). Single source of truth for "what are valid `--provider <slug>` arguments?" An agent can read installed version, configured defaults, and live providers in one command.
- New core helpers: `isProviderReady(slug, config, env)`, `getReadyProviders(config, env)`, `listProviderReadiness(config, env)`.
- Human-readable `marmot config show` now prints:
  - Installed marmot version at the top
  - The `video` row in AI defaults (closes a 0.3.0 oversight where the verb shipped but the human formatter never displayed it)
  - A new "Data defaults" section listing `enrich`, `lookup`, `verify` (previously invisible in the human view despite being settable via `marmot config set`)
  - A "Ready providers" section grouped AI / Web / Data, mirroring the JSON `readyProviders` field

### Changed

- Skill bundle bootstrap rewritten in `SKILL.md`: replaced "First step in every session" with "Before invoking any verb." The agent now runs a single command (`marmot config show --json`) to learn installed version, defaults, and ready providers. Added an install-fallback path (`command not found` → `npm install -g marmot-sh`) and a feature-detection note keyed on `marmotVersion`.
- Skill `references/config.md` example envelope updated to include `marmotVersion`, `readyProviders`, and all five AI verb defaults in canonical order.
- Skill `references/ai.md` adds the `marmot image | marmot video` canonical pipe (enabled by 0.3.1's stdin sniffing) to the patterns block and the video section's example list.
- Docs: `configuration.mdx` documents the full `config show --json` envelope including the new fields. `providers.mdx` adds a "Discovery: which providers are wired?" section for `marmot providers list` and `--check-keys`. `quickstart.mdx` mentions `marmot config show` as the inspect-your-setup command.

## [0.3.1] — 2026-05-06

### Added

- Binary stdin sniffing on `marmot video`. A piped image (PNG, JPEG, WebP, GIF) is auto-detected and slotted into the first reference-image position, so `marmot image 'a marmot waving' | marmot video 'gentle waving, slight breeze'` now works without an explicit `--image` flag. Mirrors the pattern that 0.3.0 added to `marmot run`. Stdin image counts toward the existing two-image (first-frame + last-frame) cap; explicit `--image` flags shift one slot over so a stdin first-frame combines naturally with an explicit last-frame.
- `marmot video` rejects audio / video / PDF stdin with a clear validation error instead of decoding the bytes as UTF-8 prompt text.
- `marmot video` warns when stdin is piped but empty and a positional or `--prompt-file` prompt rescued the call (matches the 0.3.0 `marmot run` behavior).

## [0.3.0] — 2026-05-05

### Added

- `marmot video` — video generation as a fifth AI modality. Routes through OpenRouter (Veo 3.1, Sora 2 Pro, Kling, MiniMax Hailuo, ByteDance Seedance, Alibaba Wan) and Vercel AI Gateway. Default model `google/veo-3.1-lite` (~$0.03/sec, 720p, no audio) keeps typical usage in pennies-per-second. TTY-aware output mirroring `marmot image`. Image-to-video conditioning via `--image` (1st = first frame, 2nd = last frame on Veo/Kling/Seedance/Wan).
- Sampling and reasoning controls on `marmot run`: `--temperature`, `--max-tokens`, `--top-p`, `--seed`, `--stop` (repeatable), and `--reasoning low|medium|high` (maps to Anthropic thinking budget, OpenAI `reasoning_effort`, OpenRouter `reasoning.effort`).
- `--provider-option key=value` escape hatch on `run`, `image`, `speak`, and `transcribe`. Repeatable. Lands in `providerOptions[<provider>]` for niche params (gpt-image-1 `background`/`output_format`/`moderation`, OpenAI `logprobs`, STT `timestamp_granularities`, etc.).
- `-o, --output` and stdin merge on data query verbs (`search`, `answer`, `research`, `findall`, `scrape`) for writing the JSON envelope to a file and composing query input from stdin + flags.
- Stdin auto-sniffing on `marmot run`: binary stdin (image, PDF, audio) is routed to `--image`/`--file` based on magic bytes, with a modality capability check before the call so non-vision text models reject early.
- Audio mime sniff on `marmot transcribe` when reading piped binary stdin.

### Changed

- Setup wizard: flat hub layout, two-step category drill (AI vs Context), per-provider cache folded into the providers menu, "Response cache" renamed to "Global cache", "data" renamed to "context". Keyless provider rows render inline with `(no key)` in yellow. "Exit setup" reachable from any submenu. Pickers mark the current default and pre-select it.
- Auto-config emits a richer one-line summary of which providers were detected and which became defaults.
- OpenRouter transcription default switched to `gpt-4o-transcribe`.
- Per-modality model caches unified behind `ensureProvider*Cache` helpers (text, image, speech, transcription, video).

### Fixed

- Broken OpenRouter slugs in default model lists for image and speech.
- Empty-pipe warning when stdin is empty and a positional argument rescued the call.
- Stale-default validator warns when a configured default no longer exists in the cached model list.
- HTTP adapter errors surface the response body in the error message instead of swallowing it; auto-config error text is more specific.

## [0.2.0] — 2026-05-04

### Breaking

- Flattened the on-disk layout. The `.marmot/ai/` namespace has been dropped. Top level holds persistent state (`config.json`, `sessions/`, `tasks.json`, `current-session`); `cache/` holds anything safe to wipe (model lists per modality, response payloads).

### Changed

- `~/.marmot/ai/config.json` → `~/.marmot/config.json`
- `~/.marmot/ai/sessions/` → `~/.marmot/sessions/`
- `~/.marmot/ai/tasks.json` → `~/.marmot/tasks.json`
- `~/.marmot/ai/current-session` → `~/.marmot/current-session`
- `~/.marmot/ai/providers/` → `~/.marmot/cache/models/text/`
- `~/.marmot/ai/image-models/` → `~/.marmot/cache/models/images/`
- `~/.marmot/ai/speech-models/` → `~/.marmot/cache/models/speech/`
- `~/.marmot/ai/transcription-models/` → `~/.marmot/cache/models/transcription/`
- `~/.marmot/ai/cache/responses/` → `~/.marmot/cache/responses/`
- `MARMOT_HOME=<dir>` now uses `<dir>` as the root directly. Previously the code appended `/ai` automatically; the env var docs already described the new behavior.

### Migration

0.1.x users should `rm -rf ~/.marmot/` before upgrading and re-run `marmot setup`. No migration helper — the install base from 0.1.0 (published two hours earlier) is small enough that a clean reset is simpler than carrying migration code forward.

## [0.1.0] — 2026-05-04

Initial public release.

- `@marmot-sh/cli` (canonical scoped) and `marmot-sh` (unscoped install alias) published to npm. Both ship the same `marmot` binary.
- Provider matrix:
  - **AI** (text/image/speech/transcribe): OpenAI, Anthropic, OpenRouter, Vercel AI Gateway, Cloudflare Workers AI, Ollama
  - **Web** (search/scrape/answer/map/crawl/research/findall): Brave, Exa, Firecrawl, Parallel, Tavily
  - **Data** (enrich/lookup/verify): Apollo, Hunter, PDL, Tomba, Bouncer, Datagma, ZeroBounce, Kickbox
- Shell-native verb shape with consistent flags across providers.
- Default plain-text output for piping; `--json` envelope for structured parsing.
- Sessions and presets, async tasks (research/crawl/findall), response cache (opt-in per provider), agent skill bundle for Claude Code, OpenCode, Codex, and similar harnesses.

[0.4.5]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.5
[0.4.4]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.4
[0.4.3]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.3
[0.4.2]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.2
[0.4.1]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.1
[0.4.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.0
[0.3.1]: https://github.com/marmot-sh/marmot/releases/tag/v0.3.1
[0.3.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.2.0
[0.1.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.1.0
