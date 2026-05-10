# Marmot configuration reference

Everything an agent needs to read, mutate, and reason about marmot's on-disk state: config file, presets, sessions, response cache, and the `setup` walkthrough.

## 1. Where the config lives

Single JSON file at `~/.marmot/config.json`.

```bash
marmot config path        # prints the absolute path (honors $MARMOT_HOME)
```

| Path | Mode |
| --- | --- |
| `~/.marmot/` | `0o700` |
| `~/.marmot/config.json` | `0o600` |
| `~/.marmot/cache/responses/<slug>/` | `0o700` |
| `~/.marmot/sessions/<name>/` | `0o700` |

`MARMOT_HOME` overrides `~/.marmot` (so `MARMOT_HOME=/x/y` puts everything under `/x/y` directly). The file is JSON; agents may hand-edit it but the CLI is safer (validates before write).

## 2. Top-level schema

```json
{
  "version": 1,
  "defaults":  { },
  "providers": { },
  "presets":   { }
}
```

| Key | Type | Purpose |
| --- | --- | --- |
| `version` | number | Always `1`. Bumped on breaking schema changes. |
| `defaults` | object | Per-verb defaults (provider, model, voice). |
| `providers` | object | Per-provider settings: enable, custom env vars, response cache. |
| `presets` | object | Saved invocation bundles, used via `--preset` or `@<name>`. |

The whole envelope is validated by Zod (`marmotConfigSchema`) on every write. Unknown keys are rejected (strict object).

## 3. Reading the config

Agents should always start with `marmot config show --json` to learn what's already there.

```bash
marmot config show          # human-readable: version, AI/Web/Data tables, ready providers, cache
marmot config show --json   # raw envelope plus runtime fields (marmotVersion, readyProviders, cache)
```

Example `--json` output:

```json
{
  "marmotVersion": "0.4.0",
  "version": 1,
  "defaults": {
    "text": { "provider": "anthropic", "model": "claude-opus-4-7" },
    "image": { "provider": "openai", "model": "gpt-image-1" },
    "video": { "provider": "openrouter", "model": "google/veo-3.1-lite" },
    "transcription": { "provider": "openai", "model": "whisper-1" },
    "speech": { "provider": "openai", "model": "tts-1", "voice": "alloy" },
    "search": { "provider": "tavily" },
    "enrich": { "provider": "pdl" }
  },
  "providers": {
    "tavily": { "cache": { "enabled": true, "ttlDays": 14 } },
    "apollo": { "apiKeyEnvVar": "WORK_APOLLO_KEY" },
    "openrouter": { "enabled": false }
  },
  "presets": {
    "deep-research": { "mode": "text", "provider": "anthropic", "model": "claude-opus-4-7", "system": "Be terse." }
  },
  "readyProviders": ["anthropic", "openai", "pdl", "tavily"],
  "cache": {
    "totals": { "entries": 42, "bytes": 1258291 },
    "providers": [
      { "provider": "tavily", "entries": 18, "bytes": 540000, "bytesHuman": "527 KB",
        "oldestRequestedAt": "2026-04-12T...", "newestRequestedAt": "2026-05-01T..." }
    ]
  }
}
```

Two runtime-derived fields are added to the on-disk envelope:

- **`marmotVersion`** — installed CLI version. Different from the schema-version `version: 1` field. Use this for feature detection.
- **`readyProviders`** — alphabetically sorted slugs of every provider that's callable right now (enabled in config + required credentials resolved). These are valid `--provider <slug>` arguments. If a provider you need isn't in the list, the user is missing a key — surface that to them rather than attempting a call that will 401.

`marmot config init` creates an empty config (`{version:1, defaults:{text:{}, image:{}}}`). Pass `--force` to overwrite an existing file. If the file already exists without `--force`, the command no-ops and returns `{ok: true, alreadyExists: true}`.

## 4. `marmot config set <key> <value>`

Three accepted key shapes. Unknown shapes throw `validation`.

### 4a. AI verb defaults (under `defaults.<verb>.<field>`)

| Key | Value type | Allowed providers |
| --- | --- | --- |
| `text.provider` | string | `openrouter`, `ollama`, `anthropic`, `openai`, `vercel`, `cloudflare` |
| `text.model` | string | any model id valid for the provider |
| `image.provider` | string | `openai`, `openrouter`, `vercel`, `cloudflare` |
| `image.model` | string | any image model id |
| `video.provider` | string | `openrouter`, `vercel` |
| `video.model` | string | any video model id (e.g. `google/veo-3.1-lite`, `openai/sora-2-pro`) |
| `speech.provider` | string | `openai`, `openrouter`, `vercel`, `cloudflare` |
| `speech.model` | string | TTS model id |
| `speech.voice` | string | provider-specific voice id |
| `transcription.provider` | string | `openai`, `openrouter`, `vercel`, `cloudflare` |
| `transcription.model` | string | STT model id |

### 4b. Web/data verb defaults (under `defaults.<verb>.provider`)

| Key | Allowed providers |
| --- | --- |
| `search.provider` | `brave`, `exa`, `firecrawl`, `parallel`, `tavily` |
| `scrape.provider` | `exa`, `firecrawl`, `parallel`, `tavily` |
| `answer.provider` | `brave`, `exa`, `tavily` |
| `map.provider` | `firecrawl`, `tavily` |
| `crawl.provider` | `firecrawl`, `tavily` |
| `research.provider` | `exa`, `firecrawl`, `parallel`, `tavily` |
| `findall.provider` | `exa`, `parallel` |
| `enrich.provider` | `apollo`, `hunter`, `pdl`, `tomba`, `datagma` |
| `lookup.provider` | `apollo`, `hunter`, `pdl`, `tomba` |
| `verify.provider` | `hunter`, `tomba`, `bouncer`, `datagma`, `zerobounce`, `kickbox` |

Data verbs only carry `provider`. There is no per-verb model concept on `enrich`/`lookup`/`verify`; capability per `--type` is fixed in the adapter.

### 4c. Per-provider settings (under `providers.<slug>.<field>`)

Slug union: AI providers + web providers + data providers (16 total).

| Suffix | Type | Purpose |
| --- | --- | --- |
| `enabled` | boolean | `false` blocks calls routed to this provider, with a fast actionable error. |
| `apiKeyEnvVar` | string | Custom env var name for the primary credential. |
| `apiSecretEnvVar` | string | Custom env var name for a secondary credential (Tomba secret, Cloudflare account id). |
| `cache.enabled` | boolean | Opt the provider into response cache. Web/data only. Default `false`. |
| `cache.ttlDays` | integer ≥ 1 | TTL for cached responses. Default 30. |

### Value coercion

- Keys ending in `.enabled` accept only `true` / `false`. Anything else throws.
- Keys ending in `.ttlDays` are parsed with `parseInt`, must be ≥ 1.
- All other values stay strings.

### Examples

```bash
marmot config set text.provider anthropic
marmot config set text.model claude-opus-4-7
marmot config set speech.voice alloy
marmot config set search.provider tavily
marmot config set enrich.provider pdl
marmot config set providers.openrouter.enabled false
marmot config set providers.tavily.cache.enabled true
marmot config set providers.tavily.cache.ttlDays 14
marmot config set providers.apollo.apiKeyEnvVar WORK_APOLLO_KEY
marmot config set providers.tomba.apiSecretEnvVar WORK_TOMBA_SECRET
```

Successful writes echo `{ok: true, key, value, path}` as JSON. Schema validation runs before write; an invalid value never touches the file.

## 4b. `marmot config get <key>` (0.6.0+)

Per-key reader. Accepts the same dotted-path keys as `config set`, plus any of their bucket prefixes (`text`, `providers`, `providers.openai`, `providers.openai.cache`).

```bash
marmot config get text.provider                      # → openrouter (bare)
marmot config get logging.recordSensitive            # → false (bare)
marmot config get providers.openai.cache             # → { "enabled": true, "ttlDays": 30 } (JSON)
```

Primitives render bare on stdout so shells can capture them with `$()`. Objects and sub-buckets pretty-print as JSON. Missing keys exit non-zero with `Key "X" is not set.` on stderr — script with `marmot config get x || ...`. A typo'd key (not a known prefix) gets the same friendly "valid shapes" hint as `config set`.

## 5. `marmot config unset <key>`

Symmetrical to `set`. Accepts the same three key shapes. Walks up after delete and prunes empty parent objects, so the file never carries dead branches.

```bash
marmot config unset providers.tavily.cache.ttlDays
marmot config unset providers.tavily.cache         # remove the whole cache subobject
marmot config unset text.model                     # leave provider, drop model
```

If the key isn't present, returns `{ok: true, removed: false}` (idempotent).

## 6. Per-provider settings deep dive

The `providers` block, keyed by provider slug:

```json
{
  "providers": {
    "tavily":  { "enabled": true, "cache": { "enabled": true, "ttlDays": 30 } },
    "apollo":  { "apiKeyEnvVar": "MY_APOLLO_KEY" },
    "tomba":   { "apiKeyEnvVar": "WORK_TOMBA_KEY", "apiSecretEnvVar": "WORK_TOMBA_SECRET" },
    "openrouter": { "enabled": false }
  }
}
```

Default primary env vars (used when `apiKeyEnvVar` is absent): `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY` (Vercel), `CLOUDFLARE_API_TOKEN`, `BRAVE_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`, `PARALLEL_API_KEY`, `TAVILY_API_KEY`, `APOLLO_API_KEY`, `HUNTER_API_KEY`, `PDL_API_KEY`, `TOMBA_API_KEY`, `BOUNCER_API_KEY`, `DATAGMA_API_KEY`, `ZEROBOUNCE_API_KEY`, `KICKBOX_API_KEY`. Ollama has no key. Tomba's default secondary is `TOMBA_SECRET_KEY`. Cloudflare's default secondary is `CLOUDFLARE_ACCOUNT_ID`.

## 7. Response cache

Disabled by default. Web/data sync verbs only: `search`, `scrape`, `answer`, `map`, `enrich`, `lookup`, `verify`. AI verbs and async verbs (`research`, `crawl`, `findall`, `get`) are never cached.

**AI verbs are intentionally never cached.** Sampling is non-deterministic and chat-mode sessions mutate history each call, so a hit would silently return stale or wrong output. The `providers.<slug>.cache.enabled` field stays in the schema for hybrid providers, but on AI-only slugs (`openai`, `anthropic`, `openrouter`, `vercel`, `cloudflare`, `ollama`) the setting is a no-op. `marmot config set providers.openai.cache.enabled true` warns on stderr; `marmot doctor` surfaces the no-op as an informational check.

### Enable

```bash
marmot config set providers.tavily.cache.enabled true
marmot config set providers.tavily.cache.ttlDays 14   # default 30
```

### Storage

```
~/.marmot/cache/responses/<provider>/<sha256>.json   # mode 0o600
```

Cache key is SHA-256 of canonicalized `{verb, input}` with `apiKey`, `apiSecret`, `fetchFn`, `abortSignal` stripped. Identical inputs hash to the same key regardless of property order. Each entry stores `{hash, verb, requestedAt, ttlSeconds, response, query?}`.

A cache hit within TTL returns the cached payload with `"cached": true` on the envelope.

### Per-call flags (sync verbs)

| Flag | Behavior |
| --- | --- |
| `--no-cache` | Skip both cache read and write. |
| `--refresh` | Skip read, force a fresh fetch, overwrite the entry. |

### Inspect

```bash
marmot cache stats                  # totals + per-provider, with oldest/newest timestamps
marmot cache stats --provider tavily
```

`marmot config show` includes the same totals (no timestamps) under the "Response cache" section. `--json` returns them under `cache.totals` and `cache.providers`.

### Invalidate

```bash
marmot cache clear --all                              # everything
marmot cache clear --provider exa                     # one provider
marmot cache clear --provider exa --query "rag"       # substring on the human label
marmot cache clear --provider exa --older-than 7      # entries older than 7 days
marmot cache clear --all --older-than 30
```

Constraints: must pass either `--provider` or `--all`, never both. `--query` requires `--provider`. The `--query` filter matches the human-readable `query` label stored on each entry (search query, email, LinkedIn URL, etc.; case-insensitive substring).

### Model-catalog cache vs response cache

`marmot cache refresh [provider|all]` is a different cache. It rebuilds the per-provider model catalogs under `~/.marmot/cache/models/{text,images,speech,transcription}/<provider>.json`. Unrelated to the response cache. Use it after rotating keys or when a new model isn't visible in `setup`.

### Listing and searching models (0.4.7+)

```bash
marmot models                                    # all cached models, every provider/mode
marmot models --provider openai --mode text      # filter to one bucket
marmot models --search gpt                       # case-insensitive substring on id + name (top 10)
marmot models --search sora --provider openai --limit 5
marmot models --search claude --mode text --limit 0   # 0 = no cap
```

`--search` matches case-insensitive substrings of model id and display name. Default `--limit 10` total matches across all returned buckets; pass `--limit 0` to remove the cap. `--json` returns the structured envelope with `buckets`, plus `search` and `totalMatches` when `--search` is set. Use this when you know part of a model name but not the exact slug — faster than scrolling through the full `marmot models` output.

## 7b. Usage log + `marmot usage` (0.5.0+)

Privacy-safe per-call log at `~/.marmot/usage/<UTC-DATE>.jsonl`. Default ON, records verb-shape and outcome metadata only — never prompt text, query strings, or person identifiers unless explicitly opted in via `logging.recordSensitive`. One file per UTC day, append-only. Wired into all 15 verbs.

### Schema (per record)

```
request_id        UUID, equals provider task id for async work
ts             ISO 8601
verb           search | scrape | run | enrich | ...
provider       slug
model          AI verbs and some web verbs
preset_id      stable preset UUID; resolved to current slug at display time (0.6.0+)
flags          { limit, depth, freshness, format, type, ... }   non-sensitive flag values
flag_presence  { includeDomains, email, linkedin, schema, ... } sensitive flags as boolean only
cached         boolean
duration_ms    integer
quantity       { results | pages | urls | entities | citations | tokens_input | tokens_output | ... }
cost           USD when provider reports it (OpenRouter, AI Gateway), null otherwise
exit           ok | error
error_category validation | provider | auth | cache | io   (when exit=error)
session        session name when bound, null otherwise
sensitive      { prompt | query | system | schema | urls | flags } — opt-in only (see below)
```

### Reading

```bash
marmot usage                                       # default 7d, by provider
marmot usage --since 1h | 24h | 7d | 30d | 4w
marmot usage --from 2026-05-01 --to 2026-05-06
marmot usage --by verb | day | model | provider
marmot usage --provider parallel
marmot usage --verb search
marmot usage --failed-only
marmot usage --json                                # envelope for piping
```

`--since` accepts a positive integer plus `h`/`d`/`w`. Aggregator reports `requests`, `errors`, `error_rate`, `cached`, `cache_hit_rate`, `duration_avg/p50/p95`, `cost_total/avg`, `requests_with_cost`, `requests_without_cost`, and `quantity_totals` (sum of every numeric child key, e.g. `tokens_input: 142310`).

### Live tail: `--watch`

```bash
marmot usage --watch                  # human format, one record per line
marmot usage --watch --json           # JSONL on stdout for piping
marmot usage --watch --provider openrouter --failed-only
```

Polls today's `~/.marmot/usage/<UTC-DATE>.jsonl` every 500ms; initial scan jumps to EOF so only NEW records print. Filters apply per record. UTC midnight swaps the watched file automatically. Ctrl-C exits cleanly.

### Browse individual calls: `marmot history`

```bash
marmot history                              # newest 10 by default
marmot history --since 1h --limit 50
marmot history --provider parallel --verb search --json
```

Lists individual records (newest first), not aggregates. Same window/filter flags as `usage`, plus `--limit <n>` (default 10, cap 1000). Timestamps render in local TZ. `preset_id` resolves to the current slug at render time; deleted presets fall back to `(preset:<short-id>)`.

### Pruning

```bash
marmot usage prune --older-than 90d
```

Deletes day files older than the cutoff. Returns `{files_deleted, bytes_freed}`.

### Pre-flight: `--dry-run`

Every verb honors `--dry-run`. Marmot resolves options, auth, and the adapter, then prints a JSON envelope describing what would be sent and exits without firing the provider call. No usage record is written, no async task is submitted, no chat history is appended. Useful for prompt iteration on metered AI verbs (don't burn tokens while tweaking) and pipeline debugging ("what's actually being sent?"). Equivalent env var: `MARMOT_DRY_RUN=1`.

```bash
marmot search "x" --provider parallel --include-domains linkedin.com --dry-run
# → { "ok": true, "dry_run": true, "verb": "search", ... }
```

### Disabling and sensitive recording

Three controls, in precedence order from highest to lowest:

```bash
# Per call:
marmot search "..." --no-log          # skip the record entirely
marmot search "..." --redact          # log metadata, omit sensitive payload

# Env-var equivalents (script-friendly):
MARMOT_NO_LOG=1 marmot search "..."
MARMOT_REDACT=1 marmot search "..."
MARMOT_RECORD_SENSITIVE=1 marmot search "..."   # opposite: force sensitive ON

# Global config:
marmot config set logging.enabled false           # turn logging off entirely
marmot config set logging.recordSensitive true    # opt in to capturing prompts/queries/identifiers
```

The `sensitive` field on each record is verb-shaped:

```
run             { prompt, system?, schema? }
image/speak/video  { prompt, flags?: {negative | instructions} }
transcribe      { urls: [audioPath], flags?: {prompt} }
search/answer   { query, flags?: {includeDomains, excludeDomains, afterDate, beforeDate} }
scrape/map      { urls, flags?: {query | search} }
crawl           { urls: [url], flags?: {instructions, includePaths, excludePaths} }
research/findall { query, schema?, flags?: {instructions | matchConditions} }
enrich/lookup/verify { flags?: {email, linkedin, phone, firstName, lastName, q, title, ...} }
```

### Verb coverage as of 0.5.0

All 15 verbs log: AI (`run`, `image`, `speak`, `transcribe`, `video`), web (`search`, `scrape`, `answer`, `map`, `crawl`, `research`, `findall`), data (`enrich`, `lookup`, `verify`). Async verbs (`crawl`, `research`, `findall`) use the provider's task id as `request_id` so submit/poll/completion records can be joined.

## 7c. `marmot doctor` (0.5.0+)

```bash
marmot doctor              # human-readable, ends with a verdict line
marmot doctor --json       # envelope (every check carries fix_suggestion when applicable)
marmot doctor --fix        # apply safe, idempotent auto-fixes
```

Health check. Reports: CLI version, Node version, config readability, provider readiness count (`N ready · N enabled · N total`), usage logging state (with file count + dir size + ⚠ above 100 MB), and total `~/.marmot` size. Does not make API calls.

The output ends with a **verdict line**: `✓ Everything is in good order.` when clean, or `⚠ N issues found. Run X to fix.` where X is the highest-priority remediation across failed checks (errors outrank warnings; first-pushed check wins within a level).

`--fix` (0.6.0+) applies only safe, idempotent fixes: writes a default `~/.marmot/config.json` when the file is missing, prunes the usage log when it exceeds 100 MB. Anything that needs user input (missing API keys, corrupt config, old Node) is surfaced as still-failing, never silently fixed. The `--json` envelope adds `fixes_applied` and `fixes_skipped` arrays.

## 8. Presets

Saved invocation bundles. Stored under top-level `presets` map in `config.json`. One preset is scoped to one mode. Each preset carries a stable `preset_id` UUID (auto-assigned at creation, 0.6.0+) so sessions and usage records reference presets by id, not by mutable slug — renames don't break references.

### Modes and fields

Presets exist for every verb category. Common to every mode: `--provider`, `--retries`, `--timeout`. AI modes additionally accept `--model`. Web and data modes do not — provider implies the API surface.

**AI modes**

| Mode | Verb | Extra fields |
| --- | --- | --- |
| `text` | (default) | `--prompt`, `--prompt-file`, `--system`, `--system-file`, `--schema`, `--schema-file`, `--schema-module`, `--file` (list), `--image` (list), `--temperature`, `--max-tokens`, `--top-p`, `--seed`, `--stop` (list), `--reasoning`, `--provider-option`, `--output`, `--stream`, `--text`, `--json`, `--session` |
| `image` | `image` | `--prompt`, `--prompt-file`, `--size`, `--quality`, `--style`, `--negative`, `--seed`, `--n`, `--provider-option`, `--output`, `--binary`, `--b64`, `--json`, `--preview`, `--session` |
| `video` | `video` | `--prompt`, `--prompt-file`, `--image` (list), `--aspect`, `--resolution`, `--duration`, `--fps`, `--audio`/`--no-audio`, `--n`, `--seed`, `--provider-option`, `--output`, `--binary`, `--b64`, `--json`, `--session` |
| `speech` | `speak` | `--text` (positional), `--prompt-file`, `--voice`, `--format`, `--speed`, `--instructions`, `--provider-option`, `--output`, `--binary`, `--b64`, `--json`, `--play`, `--wait`, `--session` |
| `transcription` | `transcribe` | `--audio` (positional), `--language`, `--format`, `--prompt` (concat), `--provider-option`, `--output`, `--text`, `--json`, `--session` |

**Web modes**

| Mode | Verb | Extra fields |
| --- | --- | --- |
| `search` | `search` | `--query` (concat), `--limit`, `--depth`, `--freshness`, `--after-date`, `--before-date`, `--include-domains`, `--exclude-domains`, `--include-content`, `--cache`, `--refresh`, `--output`, `--raw`, `--session` |
| `scrape` | `scrape` | `--urls` (list), `--format`, `--query`, `--cache`, `--refresh`, `--output`, `--raw`, `--session` |
| `answer` | `answer` | `--query` (concat), `--max-citations`, `--include-search`, `--cache`, `--refresh`, `--output`, `--raw`, `--session` |
| `map` | `map` | `--url`, `--search`, `--limit`, `--cache`, `--refresh`, `--output`, `--raw`, `--session` |
| `crawl` | `crawl` | `--url`, `--max-pages`, `--max-depth`, `--instructions` (concat), `--include-paths`, `--exclude-paths`, `--allow-external`, `--wait`, `--async`, `--output`, `--raw`, `--session` |
| `research` | `research` | `--query` (concat), `--depth`, `--schema`, `--schema-file`, `--instructions` (concat), `--wait`, `--async`, `--poll-interval`, `--max-wait`, `--output`, `--raw`, `--session` |
| `findall` | `findall` | `--objective` (concat), `--limit`, `--schema`, `--schema-file`, `--entity-type`, `--match-conditions`, `--wait`, `--async`, `--output`, `--raw`, `--session` |

**Data modes**

| Mode | Verb | Extra fields |
| --- | --- | --- |
| `enrich` | `enrich` | `--type` (person/org), all 13 identifier fields (email, emailHash, linkedin, phone, name, firstName, lastName, middleName, company, providerId, domain, website, ticker), `--min-likelihood`, `--require`, `--fields`, `--cache`, `--refresh`, `--output`, `--raw`, `--session` |
| `lookup` | `lookup` | `--type` (person/org/email), `--q`, `--limit`, `--cursor`, plus filters: `--title`, `--seniority`, `--location`, `--domain`, `--industry`, `--employees`, `--tech`, `--email-type`, `--department`, `--company`. Plus shared `--cache`, `--refresh`, `--output`, `--raw`, `--session` |
| `verify` | `verify` | `--email`, `--cache`, `--refresh`, `--output`, `--raw`, `--session` |

As of 0.7.0 every data-verb identifier and filter is preset-able (scalar-replace). Realistic use is partial baking — bake the company in a preset, supply the person at runtime. The legacy `verify --email` flag was removed; pass email positionally or via preset.

### Naming

Slug regex: `^[a-z0-9]+([-_][a-z0-9]+)*$`. Lowercase letters/digits with single `-` or `_` separators; no leading/trailing/consecutive separators. Examples: `deep-research`, `cheap_text`, `square-1024`, `whisper_en`.

### Commands

```bash
marmot preset create deep-research \
  --mode text --provider anthropic --model claude-opus-4-7 \
  --system "Be terse and cite sources."

# 0.7.1+: bare invocation enters an interactive walkthrough that
# prompts for each preset-able field (TTY only). Same for `update`
# when no field flags are passed.
marmot preset create                          # interactive: name → mode → fields
marmot preset create my-name                  # interactive: skips the name prompt
marmot preset update deep-research            # interactive: current values shown as defaults

marmot preset list                # human table on TTY, JSON when piped (0.7.2+); add --json or --markdown to force
marmot preset show deep-research  # human key/value sections on TTY, JSON when piped (0.7.2+)
marmot preset update deep-research --model claude-sonnet-4-6
marmot preset rename deep-research deep-research-v2   # 0.6.0+; preset_id stays stable
marmot preset delete deep-research
```

`create` refuses to overwrite an existing name. `update` patches only the flags you pass; mode is immutable (delete + recreate to change). `rename` validates that the new slug is well-formed and not already taken; `preset_id` stays stable so any sessions or usage records referencing the preset keep working. `delete` returns `{removed: false}` if the name didn't exist; not an error.

### Use a preset

```bash
# Sigil routes to the matching verb automatically (0.4.7+):
marmot @deep-research "summarize this paper"                 # → run (text)
marmot @linkedin "Daniel Francis Abel Police"                # → search
marmot @research-fintech "stripe vs adyen"                   # → research
marmot @enrich-pdl --email tcook@apple.com                   # → enrich
marmot @square-1024 "a marmot in the alps"                   # → image

# Long form and explicit verbs both work:
marmot run --preset deep-research "summarize this"
marmot search --preset linkedin "..."
marmot speak @narrator "welcome"
marmot transcribe @whisper_en ./talk.mp3
```

The `@name` sigil expands to `--preset <name>` before commander parses, and (as of 0.4.7) injects the verb that matches the preset's mode when no explicit verb is present. Mode → verb is 1:1 for the 12 web/data and image/video modes; the three AI exceptions are remapped: `speech` → `speak`, `transcription` → `transcribe`, `text` → default-run (no verb token).

Mode mismatch is rejected when an explicit verb conflicts with the preset's mode: `marmot scrape @some-search-preset url` fails with `Preset "..." has mode "search", but this command requires "scrape"`. Only the first matching `@…` token is consumed, so `"@user said hi"` inside a quoted prompt is left alone.

### Resolution order

```
explicit flag > preset > defaults.<mode> > first-run auto-config (AI verbs only) > error
```

### Merge rules (preset × runtime)

When both a preset and a runtime flag set the same field, three rules dispatch by field shape:

- **Scalar** (default) — runtime replaces preset. `--provider`, `--model`, `--temperature`, booleans like `--stream`, etc.
- **List append** — preset list followed by runtime list. `--file`, `--image`, `--stop`. (Note: `--provider-option` is list-shaped but stays as scalar replace by design.)
- **Concat** — joined with `\n\n`. Prompt-like text fields: `--system`, `prompt` (text/image/video positional), `text` (speech positional), `--prompt-file` content, transcribe `--prompt` (bias hint), search/answer/research `--query` (positional), crawl/research `--instructions`, findall `--objective`.

Boolean override: a preset field set to `true` is flipped by the matching `--no-<flag>` runtime flag (e.g. `--no-stream` overrides preset `stream: true`). Negation pairs added in 0.7.0+: `text` mode — `--no-stream`, `--no-text`, `--no-json`. AI verbs — `--no-binary`, `--no-b64`, `--no-json`, `--no-text` (transcribe), `--no-play`, `--no-wait` (speech), `--preview` / `--no-preview` (image). Web verbs — `--cache` (paired with `--no-cache`), `--no-refresh`, `--no-raw` everywhere; `--no-include-content` (search), `--no-include-search` (answer), `--no-allow-external` (crawl), `--no-wait`, `--no-async` (crawl/research/findall).

**Permanent exclusions** (rejected at preset parse time): `--api-key`, `--preset`, stdin-only modifiers (`--file-mime`, `--image-mime`, `--text-stdin`).

**Path resolution** for preset path fields (`systemFile`, `promptFile`, `file`, `image`, `output`, `schemaFile`, `schemaModule`): absolute → as-is, `~` → home, relative → invocation cwd. Global presets in `~/.marmot/config.json` should prefer absolute or `~/...` paths.

**First-run auto-config (AI verbs only):** if no default is set for `text`/`image`/`speech`/`transcription`, marmot detects available API keys in the environment and picks the first ready provider in this order: `ollama` (local) → `openrouter` → `vercel` → `cloudflare` → `openai` → `anthropic`. The choice is persisted to `~/.marmot/config.json` so subsequent calls hit step 3 directly. Web/data verbs have no auto-config — they error if no default is set.

`marmot @deep-research --model claude-haiku-4-5 "..."` keeps the preset's system + provider but overrides model.

Presets store flags only, never credentials.

### Pipelines (0.9.0+) — multi-stage workflows

Where a preset configures a single verb invocation, a **pipeline** chains several invocations through stdin/stdout. Stored under a top-level `pipelines` key in `config.json`. The same `@<name>` sigil routes to a pipeline first, then falls back to a preset (collisions are rejected at create time).

```bash
marmot pipeline create news-digest \
  --step 'search ${input}' \
  --step 'run "summarize this in three paragraphs"' \
  --step '@news-podcast'

marmot @news-digest "AI safety in 2026"
# expands to: marmot search ... | marmot run ... | marmot @news-podcast
```

Step shapes (on disk):
- `{ verb, args?, prompt?, flags? }` — inline marmot verb invocation.
- `{ preset: <name>, args? }` — reference an existing preset.
- `{ pipeline: <name> }` — nested pipelines (deferred for v1; rejected at parse time).

Substitution tokens in step strings: `${input}` (all positionals joined), `${1}`, `${2}`, … (1-indexed positionals), plus `?`-suffixed optional variants (`${input?}`, `${1?}`).

Each step runs as a `marmot` subprocess; stdout chains into the next step's stdin. The first step's stdin is inherited from the parent (so `cat foo.txt | marmot @<name>` works). The final step's stdout is the user's stdout. Failed steps surface a `Pipeline "<name>" failed at step N (<verb>) with exit code <code>` error and a non-zero exit.

CRUD mirrors presets: `marmot pipeline create / update / list / show / delete / rename / run`. The `update` verb replaces the full steps array (per-step editing deferred). `list / show` follow the 0.8.0 TTY-aware human/json/markdown output pattern.

## 9. Sessions

Containers that log related calls and (in chat mode) carry message history.

### Modes

| Mode | What it adds |
| --- | --- |
| `stateless` | Per-call log lines in `log.jsonl`. No history threaded into prompts. |
| `chat` | Plus `messages.jsonl`. Each `marmot run` reads history, calls, then appends user + assistant turns. Prompt caching wired automatically for Anthropic-direct and OpenAI. |

`image`, `speak`, `transcribe`, and data verbs ignore chat history even inside a chat session, but still log to `log.jsonl`.

### Lifecycle

```bash
marmot session create market-q3 --mode chat --preset deep-research \
  [--label "..."] [--record-prompts]
marmot session use market-q3      # set global pointer
marmot session current            # print active session
marmot session end                # clear pointer
marmot session list               # human table on TTY, JSON when piped (0.7.2+); --json or --markdown to force
marmot session show market-q3     # human sections on TTY, JSON when piped; meta + token totals + window usage
marmot session delete market-q3 [--keep-log]
```

If `--mode` is omitted on `create`, defaults to `stateless`. Chat-mode sessions only accept text-mode presets.

### Binding precedence

```
--session <name> on the call > marmot session use <name> pointer > unbound (no log)
```

The pointer file is `~/.marmot/current-session` (or `$MARMOT_HOME/current-session`) and is shared across terminals.

### Inspection

```bash
marmot session log <name> [--since 2026-04-01] [--limit 50] [--json|--table]
marmot session tail <name>        # follow-mode like tail -f
marmot session stats <name>       # tokens, calls, cache_hit_rate, last_used_at
```

`session show` returns `{tokens_in_window, model, model_max_tokens, percent_used}`. Token estimate is `chars/4`.

### Chat-mode helpers

```bash
marmot session context <name> [--json]          # print full message history
marmot session reset <name>                     # clear messages, keep meta + log
marmot session fork <src> <dest>                # branch from current state
marmot session export <name> --format md|jsonl
marmot session mark <name> "label"              # protect everything after this point
marmot session compact <name> [--target-tokens 8000] [--keep-last 4]
```

`compact` calls the session's resolved provider/model with a summarization system prompt, rewrites `messages.jsonl` to `[summary, ...keep_last]`, and rotates the prior file to `messages.<ts>.jsonl`. Anything after the most recent `mark` stays verbatim. `--auto-compact` is recorded but not yet enforced; invoke manually.

### Storage

```
$MARMOT_HOME/ai/sessions/<name>/
  meta.json          # mode, preset, label, totals, timestamps
  log.jsonl          # one call per line, append-only
  messages.jsonl     # chat-mode only, append-only
```

All files mode `0o600`. API keys are never logged; only the source name (env var or `flag-override`). Prompt bodies are not logged unless `--record-prompts` is set on the session at create time. (There is no per-call override yet.)

## 10. `marmot setup`

Interactive wizard for first-run and reconfiguration. Agents usually prefer `config set` for headless tweaks; reach for `setup` only when walking a human through provider/model defaults, provider toggles, or cache settings. The hub drills into AI defaults (one step per modality), context defaults (web + data verbs), per-provider settings (enable/disable, cache, custom env vars), the global response cache, and the agent skill install. "Exit setup" is reachable from any submenu.

## 11. Resolution order recap

For a verb call:

```
explicit CLI flag > preset (if --preset/@name) > config defaults > first-run auto-config (AI verbs only) > error
```

For credential lookup, per provider:

```
--api-key flag > providers.<slug>.apiKeyEnvVar (custom env var) > built-in default env var > error
```

Same shape for the secondary credential, where applicable: env var → `providers.<slug>.apiSecretEnvVar` → built-in default. (There is no `--api-secret` per-call flag; secondary credentials are always sourced from env, named via the optional `apiSecretEnvVar` config setting.)

If `providers.<slug>.enabled` is `false`, the call fails fast with an actionable error before credential resolution.
