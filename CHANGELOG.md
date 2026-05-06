# Changelog

All notable changes to Marmot are documented here.

This project follows [Semantic Versioning](https://semver.org/). Pre-1.0 minor bumps may include breaking changes; patch bumps will not.

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

[0.4.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.4.0
[0.3.1]: https://github.com/marmot-sh/marmot/releases/tag/v0.3.1
[0.3.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.2.0
[0.1.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.1.0
