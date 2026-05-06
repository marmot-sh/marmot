# Changelog

All notable changes to Marmot are documented here.

This project follows [Semantic Versioning](https://semver.org/). Pre-1.0 minor bumps may include breaking changes; patch bumps will not.

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

[0.3.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.2.0
[0.1.0]: https://github.com/marmot-sh/marmot/releases/tag/v0.1.0
