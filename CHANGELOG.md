# Changelog

All notable changes to Marmot are documented here.

This project follows [Semantic Versioning](https://semver.org/). Pre-1.0 minor bumps may include breaking changes; patch bumps will not.

## [Unreleased]

### Added

- **Stable `preset_id` UUID on every preset.** Auto-assigned at creation. Sessions and usage records reference presets by `preset_id` rather than slug; the display layer (`marmot session show`, `marmot session list`, chat-mode export) resolves `preset_id` → current slug at render time.
- **`marmot preset rename <old> <new>`** — atomic config rewrite. Validates that the new slug is well-formed and not already taken. Because the `preset_id` stays stable, sessions and historical usage records continue to resolve correctly to the new name.

### Changed

- **Breaking:** `sessionMetaSchema` replaces the `preset` slug field with `preset_id` (UUID). Existing sessions that referenced presets by slug lose that linkage; new sessions created via `marmot session create --preset <slug>` resolve the slug to `preset_id` at creation.
- **Breaking:** `usageRecordSchema` now writes `preset_id` instead of `preset` (slug). Display layer resolves the current slug at render time. Old records on disk keep their original `preset` field; the aggregator tolerates both.
- **Breaking:** `logRecordSchema` (session log) replaces `preset` slug with `preset_id`.
- Existing presets in `~/.marmot/config.json` without `preset_id` get a fresh UUID assigned in-memory on next read; persisted on next write. No migration sweep.

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
