# marmot web verbs

Reference for `search`, `scrape`, `answer`, `map`, `crawl`, `research`, `findall`, `get`, `tasks`. All verbs dispatch off `WEB_PROVIDERS = [brave, exa, firecrawl, parallel, tavily]`. Sync verbs return on completion; async verbs submit a job and either poll (`--wait`, default) or return a task id (`--async`).

## Provider matrix

| Verb     | brave | exa | firecrawl | parallel | tavily |
| -------- | ----- | --- | --------- | -------- | ------ |
| search   | yes   | yes | yes       | yes      | yes    |
| scrape   | -     | yes | yes       | yes      | yes    |
| answer   | yes¹  | yes | -         | -        | yes    |
| map      | -     | -   | yes       | -        | yes    |
| crawl    | -     | -   | yes (async) | -      | yes (sync, 150s cap) |
| research | -     | yes | yes       | yes      | yes    |
| findall  | -     | yes² | -        | yes      | -      |

¹ Brave `answer` requires Pro plan. Free keys never receive a `summarizer.key` from `web/search?summary=1`, so the chained `summarizer/search` call has nothing to dereference.
² Exa `findall` uses the Websets API; requires Pro/Personal tier. Lower tiers return 401.

### Env vars and base URLs

| Provider  | API key env var       | Base URL                              |
| --------- | --------------------- | ------------------------------------- |
| brave     | `BRAVE_API_KEY`       | `https://api.search.brave.com/res/v1` |
| exa       | `EXA_API_KEY`         | `https://api.exa.ai`                  |
| firecrawl | `FIRECRAWL_API_KEY`   | `https://api.firecrawl.dev`           |
| parallel  | `PARALLEL_API_KEY`    | `https://api.parallel.ai`             |
| tavily    | `TAVILY_API_KEY`      | `https://api.tavily.com`              |

`--api-key <key>` overrides the env var for one call. `defaults.<verb>.provider` in `~/.marmot/config.json` sets the per-verb default. Per-provider toggle: `providers.<slug>.enabled`.

## Sync verbs

All sync verbs share the envelope `{ok, provider, verb, cached, data, raw, usage?, timestamp}` and the cache flags `--no-cache` / `--refresh`. Every verb (sync and async) accepts `-o, --output <path>` to write the JSON envelope to a file. With `-o` set on a TTY, stdout stays silent (0.10.0+); when piped, the envelope flows to the pipe **and** to the file. Every verb also accepts `-q, --quiet` (0.10.0+) to force full stdout silence — file output via `-o` is still written; stderr status is unaffected. Query verbs (`search`, `answer`, `research`, `findall`, `scrape`) merge piped stdin into the query input — useful for `cat queries.txt | marmot answer` or pipelines that build the query upstream.

### search

```
marmot search <query…> [flags]
```

| Flag                      | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `--provider <slug>`       | brave, exa, firecrawl, parallel, tavily              |
| `--api-key <key>`         | Override env var                                     |
| `--limit <n>`             | Max results (Brave caps at 200; others vary)         |
| `--depth <basic\|standard\|deep>` | Effort/cost tier; provider-interpreted       |
| `--freshness <day\|week\|month\|year>` | Relative time filter (Brave/Tavily native; Exa/Firecrawl/Parallel emulated) |
| `--after-date <YYYY-MM-DD>` | Absolute lower bound (Exa, Firecrawl, Parallel); ignored with stderr warn on Brave/Tavily |
| `--before-date <YYYY-MM-DD>` | Absolute upper bound (Exa, Firecrawl); ignored with stderr warn on Brave/Tavily/Parallel |
| `--include-domains <csv>` | Restrict to listed domains (Exa, Firecrawl, Parallel, Tavily); ignored with warn on Brave |
| `--exclude-domains <csv>` | Exclude listed domains (same support set as --include-domains)               |
| `--include-content`       | Inline full page content per result if supported     |
| `--raw`                   | Native body under `raw`; `data` is null              |
| `--json`                  | Envelope (already the default)                       |
| `--no-cache`              | Skip read AND write                                  |
| `--refresh`               | Skip read; write fresh response, overwrite           |

```bash
marmot search "marmot population dynamics" --provider tavily --depth deep --freshness month --limit 20
marmot search "claude code release notes" --provider brave --include-domains anthropic.com,docs.anthropic.com
```

### scrape

```
marmot scrape <url…> [flags]
```

| Flag                      | Description                                          |
| ------------------------- | ---------------------------------------------------- |
| `--provider <slug>`       | exa, firecrawl, parallel, tavily                     |
| `--api-key <key>`         | Override env var                                     |
| `--format <markdown\|text\|html>` | Default `markdown`. Provider may return subset |
| `--query <text>`          | Intent for chunk reranking (Tavily)                  |
| `--raw`, `--json`, `--no-cache`, `--refresh` | (see search)                      |

Multiple URLs in one call are batched per provider where supported.

```bash
marmot scrape https://docs.firecrawl.dev/introduction --provider firecrawl --format markdown
marmot scrape https://example.com/a https://example.com/b --provider tavily --query "pricing tiers"
```

### answer

```
marmot answer <query…> [flags]
```

| Flag                  | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `--provider <slug>`   | brave, exa, tavily                                       |
| `--api-key <key>`     | Override env var                                         |
| `--max-citations <n>` | Cap citations included (default 8)                       |
| `--include-search`    | Also return underlying search results                    |
| `--raw`, `--json`, `--no-cache`, `--refresh` | (see search)                      |

Per-provider mechanics:
- Brave: chained `web/search?summary=1` → `summarizer/search`. Pro plan only.
- Exa: single `/answer` call.
- Tavily: inline via `/search` with `include_answer=advanced`.

```bash
marmot answer "what changed in firecrawl v2 crawl API" --provider tavily --include-search
marmot answer "EU AI Act enforcement timeline" --provider exa --max-citations 4
```

### map

```
marmot map <url> [flags]
```

| Flag                | Description                                                |
| ------------------- | ---------------------------------------------------------- |
| `--provider <slug>` | firecrawl, tavily                                          |
| `--api-key <key>`   | Override env var                                           |
| `--search <query>`  | Relevance ordering (Firecrawl). Tavily ignores             |
| `--limit <n>`       | Max URLs returned                                          |
| `--raw`, `--json`, `--no-cache`, `--refresh` | (see search)                      |

Firecrawl returns URL + optional title/description; Tavily returns URLs only.

```bash
marmot map https://stripe.com --provider firecrawl --search "checkout" --limit 50
```

## Async verbs

All async verbs accept `--wait` (default: block and poll until terminal status) or `--async` (return task id immediately, exit). They are not cached. The CLI appends a record to the local task index (`~/.marmot/tasks.json`) on submit and updates status on every poll.

Async envelope shape on terminal completion:
```
{ok, provider, verb, taskId, status, data, raw, error, timestamp}
```

`--async` envelope shape:
```
{ok, provider, verb, taskId, status: "queued", createdAt, next: "marmot get <id> --provider <slug>"}
```

### crawl

```
marmot crawl <url> [flags]
```

Firecrawl is async, Tavily is sync (server-capped at 150s; do not pass `--async` for Tavily — it has no submit/poll).

| Flag                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `--provider <slug>`   | firecrawl, tavily                                 |
| `--api-key <key>`     | Override env var                                  |
| `--max-pages <n>`     | Cap pages crawled                                 |
| `--max-depth <n>`     | Discovery depth                                   |
| `--instructions <text>` | Natural-language guidance (Tavily; doubles cost) |
| `--include-paths <csv>` | Regex patterns of paths to include              |
| `--exclude-paths <csv>` | Regex patterns of paths to exclude              |
| `--allow-external`    | Follow off-domain links                           |
| `--wait`              | Block until done (default for Firecrawl)          |
| `--async`             | Return task id immediately (Firecrawl only)      |
| `--raw`, `--json`     | (see search)                                      |

```bash
marmot crawl https://docs.example.com --provider firecrawl --max-pages 200 --include-paths "/docs.*" --async
marmot crawl https://docs.example.com --provider tavily --max-pages 50 --instructions "focus on the API reference"
```

### research

```
marmot research <query…> [flags]
```

Always async on every provider.

| Flag                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `--provider <slug>`   | exa, firecrawl, parallel, tavily                  |
| `--api-key <key>`     | Override env var                                  |
| `--depth <basic\|standard\|deep>` | Maps to per-provider model/processor  |
| `--instructions <text>` | Optional system instructions                    |
| `--schema <json>`     | Inline JSON Schema for structured output          |
| `--schema-file <path>` | JSON Schema from a file                          |
| `--wait`              | Block and poll until terminal status (default)    |
| `--async`             | Return task id immediately                        |
| `--poll-interval <s>` | Override poll cadence in seconds (advanced)       |
| `--raw`, `--json`     | (see search)                                      |

```bash
marmot research "compare langfuse vs helicone vs braintrust pricing and features" --provider parallel --depth deep --schema-file ./vendor-compare.schema.json
marmot research "current state of WebGPU browser support" --provider exa --async
```

### findall

```
marmot findall <objective…> [flags]
```

Always async. Entity-list builder.

| Flag                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `--provider <slug>`   | exa, parallel                                     |
| `--api-key <key>`     | Override env var                                  |
| `--limit <n>`         | Max items (Parallel clamps to 5–1000)             |
| `--entity-type <name>` | Required by Parallel (e.g. `company`, `person`, `cloud_provider`); ignored by Exa |
| `--match-conditions <json>` | JSON array of `{name, description}` (Parallel). Defaults to a single condition synthesized from the objective |
| `--schema <json>` / `--schema-file <path>` | JSON Schema for items              |
| `--wait`              | Block until done (default)                        |
| `--async`             | Return task id immediately                        |
| `--raw`, `--json`     | (see search)                                      |

```bash
marmot findall "yc w24 dev tools companies" --provider parallel --entity-type company --limit 100
marmot findall "research labs publishing on diffusion models in 2025" --provider exa --async
```

## Async task management

### marmot get

Polls or fetches a single async task from the provider.

```
marmot get <task-id> --provider <slug> [--verb <verb>] [flags]
```

| Flag                | Description                                                     |
| ------------------- | --------------------------------------------------------------- |
| `--provider <slug>` | Required. The provider that issued the id                       |
| `--verb <name>`     | research, crawl, findall. Inferred from local task index when possible; required if no local record |
| `--api-key <key>`   | Override env var                                                |
| `--wait`            | Re-poll until terminal status                                   |
| `--raw`             | Native body under `raw`                                         |

`--provider` is mandatory because task ids are not globally unique across providers. `--verb` falls back to the local index lookup.

```bash
marmot get task_abc123 --provider parallel --verb research
marmot get task_abc123 --provider firecrawl --verb crawl --wait
```

There is no `--cancel` on `marmot get`. Cancellation is provider-specific and not currently exposed on the CLI; remove the local record with `marmot tasks remove <id>` (does not cancel server-side).

### marmot tasks

Operates on the local index file `~/.marmot/tasks.json`. Does NOT hit the provider.

```
marmot tasks list [--provider X] [--verb Y] [--status queued|running|done|failed|cancelled]
                  [--since 1h|24h|7d|...] [--limit N]
                  [--json | --markdown]
marmot tasks show <id> [--json | --markdown]
marmot tasks remove <id>
marmot tasks prune [--older-than <days>]
```

`tasks list` and `tasks show` are TTY-aware (0.7.2+): human-readable table / sections on TTY, JSON envelope when piped. `--json` and `--markdown` force the choice. `--limit` defaults to 20 (max 1000); when more records exist, the human-mode footer reports the total. `--since` filters to records created within the window (`1h`, `24h`, `7d`, etc.).

`prune` defaults to 30 days; only removes terminal-state records (done/failed/cancelled). `remove` drops the local record without contacting the provider.

```bash
marmot tasks list --status running --provider parallel
marmot tasks show task_abc123
marmot tasks prune --older-than 7
```

## Cache flags

Apply only to sync verbs (`search`, `scrape`, `answer`, `map`). Async verbs are not cached.

| Flag         | Read  | Write | Effect                                             |
| ------------ | ----- | ----- | -------------------------------------------------- |
| (default)    | yes   | yes   | Hit cache when entry exists; populate on miss      |
| `--no-cache` | skip  | skip  | One-shot bypass                                    |
| `--refresh`  | skip  | yes   | Force fresh fetch, overwrite existing entry        |

Caching is opt-in per provider via `providers.<slug>.cache.enabled` in config. When disabled the flags are no-ops. The envelope's `cached: true|false` reports the result.

## Presets (0.7.0+)

All seven web verbs accept presets with mode-specific fields:

- **search** / **answer** / **research**: `query` (positional, concatenates with runtime), `cache`, `refresh`, `output`, `raw`, `session`.
- **scrape**: `urls` (list — appends with runtime positional), plus the same shared fields.
- **map** / **crawl**: `url` (positional, scalar — preset can supply the required URL), plus shared fields.
- **findall**: `objective` (positional, concatenates), plus shared fields.
- **crawl** / **research**: `instructions` switches **replace → concatenate** in 0.7.0 (Breaking — preset + runtime instructions compose with `\n\n`).

Cache toggling: `--cache` is paired with `--no-cache` so a preset's `cache: false` can be flipped at runtime. Per-verb negation flags listed under each verb.

```bash
marmot preset create linkedin-people --mode search --provider parallel \
  --query "site:linkedin.com" --include-domains linkedin.com --no-cache
marmot @linkedin-people "engineering manager"
```

## Session binding (0.6.0+)

Every web verb (sync and async) accepts `--session <name>`. The bound name flows into the usage record so `marmot usage --session <name>` filters work on web traffic, and the call appears under `marmot session show <name>` alongside any AI calls in the same session. Pre-0.6.0 web verbs hardcoded `session: null` even when a session was active — fixed in 0.6.0.

```bash
marmot search "..." --session research-q2
marmot research "..." --async --session research-q2
marmot usage --since 7d --json | jq '.by_provider'   # session field on every row
```

## Output formats

Default for every verb is the structured envelope on stdout. Spinners and progress messages go to stderr; stdout is JSON-only and pipe-safe.

Sync envelope:
```json
{
  "ok": true,
  "provider": "tavily",
  "verb": "search",
  "cached": false,
  "data": { /* normalized */ },
  "raw": null,
  "usage": null,
  "timestamp": "2026-05-03T12:00:00.000Z"
}
```

`--raw`: `data` becomes `null`, `raw` carries the provider's native body. Useful for accessing fields the normalizer drops.

`--json`: explicit envelope toggle. The envelope is already the default; the flag exists for consistency with verbs that have alternate output modes elsewhere in the CLI.

## Quirks

- Brave `answer` requires Pro. Free keys silently lose the chained summarizer step.
- Exa `findall` is Websets — Pro/Personal tier. Lower tiers 401.
- Firecrawl `crawl` is async; Tavily `crawl` is sync, 150s server cap.
- `marmot get` requires `--provider` because task ids are not globally unique. `--verb` is inferred from `~/.marmot/tasks.json` when present.
- `tasks remove` and `tasks prune` are local-only. Neither cancels work on the provider.
- Async verbs ignore `--no-cache` / `--refresh` (not cached at all).
- `--wait` and `--async` are mutually exclusive; passing both errors out.
- Search filter support varies by provider. `--include-domains` / `--exclude-domains` work everywhere except Brave; `--after-date` works on Exa, Firecrawl, Parallel; `--before-date` works on Exa and Firecrawl. Unsupported flags emit a stderr warning instead of being silently dropped — your filter didn't apply.
- `crawl --instructions` doubles Tavily's cost per their docs.
