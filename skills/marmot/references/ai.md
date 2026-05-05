# marmot AI verbs

Four verbs cover text, image, audio out, and audio in: `run`, `image`, `speak`, `transcribe`. Plain text on stdout by default. Status on stderr. AI verbs do **not** use the response cache (caching applies to web/data verbs only).

**First-run auto-config:** if no default is set for an AI verb, marmot detects available API keys in the env and auto-configures one in this order: `ollama` (local, no key) → `openrouter` → `vercel` → `cloudflare` → `openai` → `anthropic` (image/speech/transcription skip ollama and anthropic). The choice is persisted to `~/.marmot/config.json` so subsequent calls are fast. Override with `marmot setup`, `marmot config set`, or `--provider`.

## Provider matrix

| Provider | `run` | `image` | `speak` | `transcribe` | API key env | Extra env | Default text model | Default image | Default speech | Default STT |
| --- | :-: | :-: | :-: | :-: | --- | --- | --- | --- | --- | --- |
| openrouter | yes | yes | yes | yes | `OPENROUTER_API_KEY` | — | `openai/gpt-oss-120b` | `google/gemini-2.5-flash-image` | `openai/gpt-4o-mini-tts-2025-12-15` | `openai/gpt-4o-transcribe` |
| anthropic | yes | — | — | — | `ANTHROPIC_API_KEY` | — | `claude-sonnet-4-6` | — | — | — |
| openai | yes | yes | yes | yes | `OPENAI_API_KEY` | — | `gpt-4o-mini` | `gpt-image-1` | `tts-1` | `whisper-1` |
| vercel | yes | yes | yes | yes | `AI_GATEWAY_API_KEY` | — | `anthropic/claude-sonnet-4.6` | `openai/dall-e-3` | `openai/tts-1` | `openai/whisper-1` |
| cloudflare | yes | yes | yes | yes | `CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_ACCOUNT_ID` | `@cf/meta/llama-3.1-8b-instruct` | `@cf/black-forest-labs/flux-1-schnell` | `@cf/myshell-ai/melotts` | `@cf/openai/whisper-large-v3-turbo` |
| ollama | yes | — | — | — | (none) | `OLLAMA_HOST` | `qwen3:4b` | — | — | — |

First-run auto-config picks the first ready provider from the env: `ollama` (local, no key) → `openrouter` → `vercel` → `cloudflare` → `openai` → `anthropic` for `text`; image/speech/transcription skip `ollama` and `anthropic`. OpenRouter is the first cloud option (and the most common default). Override with `marmot setup`, `marmot config set`, or `--provider`.

## `run` (text)

Default verb. `marmot "..."` is sugar for `marmot run "..."`. Plain text on stdout.

### Prompt sources

Concatenated, joined by blank lines, in this order: positional args, `--prompt-file`, piped stdin (when not a TTY). Stdin can instead carry image bytes (`--image -`) or file bytes (`--file -`) — only one binary stdin role at a time.

### Flags

| Flag | Purpose |
| --- | --- |
| `--provider <slug>` | Override default provider. |
| `--model <id>` | Model id. Validated against the cached model list. |
| `--api-key <key>` | Override env-var key. |
| `--system <text>` | Inline system prompt. |
| `--system-file <path>` | System prompt from file. |
| `-p, --prompt-file <path>` | User prompt from file. |
| `--image <path>` | Image input. Repeatable. `-` reads stdin bytes. |
| `--image-mime <mime>` | Override sniffed mime for `--image -`. |
| `--file <path>` | Document/PDF input. Repeatable. `-` reads stdin bytes. |
| `--file-mime <mime>` | Override sniffed mime for `--file -`. |
| `--schema <json>` | Inline JSON Schema. Switches to object mode. |
| `--schema-file <path>` | JSON Schema from file. |
| `--schema-module <path>` | Local module exporting a Zod schema (default export or `schema`). **Trusted-code only:** the module is executed with full Node privileges — do not point it at code you didn't write or audit. |
| `--stream` | Stream tokens to stdout. Forces text mode. |
| `--json` | Emit structured envelope instead of plain text. |
| `--text` | Plain text. Kept for back-compat (now the default). |
| `-o, --output <path>` | Mirror rendered output to file. |
| `--retries <n>` | Retry attempts on retryable provider errors. |
| `--timeout <seconds>` | Per-attempt timeout. |
| `--session <name>` | Bind call to a session for logging/chat history. |

### Behavior

- Default output: plain text on stdout, no envelope.
- `--stream` implies text and writes incrementally; envelope flags ignored.
- `--schema*` switches to object mode. Result envelope contains `output` (parsed) instead of `text`. Object mode rejects `--stream` and `--text`.
- Multimodal (`--image`, `--file`) is best-effort: non-vision/non-document models return a provider error.
- Model id is validated against a 24h cache; refresh with `marmot ai cache refresh <provider>`.

### Examples

```bash
marmot 'haiku about caching'
git diff | marmot --stream 'commit message under 60 chars' | pbcopy
marmot --provider anthropic --file ./paper.pdf 'summarize'
marmot --provider openai --model gpt-4o --image ./before.png --image ./after.png 'what changed?'
marmot --schema-file ./entities.json 'extract entities' < article.txt | jq .output
```

## `image`

```bash
marmot image <prompt> [flags…]
```

Providers: `openai`, `openrouter`, `vercel`, `cloudflare`.

### Flags

| Flag | Purpose |
| --- | --- |
| `--provider <slug>` | Image-capable provider. |
| `--model <id>` | Image model. Defaults per provider. |
| `--api-key <key>` | Override env key. |
| `-o, --output <path>` | Output path. `{i}` template expands per image (e.g. `./out-{i}.png`). |
| `-p, --prompt-file <path>` | Prompt from file. |
| `--n <count>` | Image count, 1–10. Default 1. |
| `--size <WxH>` | Provider-specific. |
| `--quality <level>` | Provider-specific (`hd`, `low`/`medium`/`high`, etc). |
| `--style <style>` | Provider-specific (`vivid`/`natural`, etc). |
| `--seed <n>` | Reproducibility seed. Cloudflare and some Vercel models. |
| `--negative <prompt>` | Negative prompt. Cloudflare. |
| `--binary` | Force raw bytes to stdout. Requires `--n 1`. |
| `--b64` | JSON envelope with inline base64. No file written. |
| `--json` | JSON envelope on stdout (still writes the file). |
| `--retries <n>` | Retry attempts. |
| `--timeout <seconds>` | Per-attempt timeout. |
| `--session <name>` | Session binding. |

### TTY-aware default

| Invocation | Output |
| --- | --- |
| `marmot image '...'` (TTY) | Auto-named file in CWD; prints path on stdout. |
| `marmot image '...' > f.png` | Raw bytes to stdout. Auto, only when `--n 1`. |
| `marmot image '...' \| imgcat` | Raw bytes to stdout. |
| `marmot image '...' -o cat.png` | Writes `cat.png`; prints path. |
| `marmot image '...' --n 4 -o './out-{i}.png'` | Writes 4 files; prints one path per line. |
| `marmot image '...' --binary` | Forces raw bytes (n=1 only). |
| `marmot image '...' --b64` | Envelope with inline base64. |
| `marmot image '...' --json` | Writes file, emits envelope. |

### Examples

```bash
marmot image 'a marmot in space' > marmot.png
marmot image 'a marmot in space' -o ./out.png
marmot image 'a marmot in space' --n 4 -o './out-{i}.png'
marmot image 'fox at dusk' --provider cloudflare --seed 42 --negative 'blurry'
marmot image 'a marmot in space' | imgcat
```

## `speak`

```bash
marmot speak <text> [flags…]
```

Providers: `openai`, `openrouter`, `vercel`, `cloudflare`.

### Flags

| Flag | Purpose |
| --- | --- |
| `--provider <slug>` | Speech-capable provider. |
| `--model <id>` | TTS model. |
| `--api-key <key>` | Override env key. |
| `--voice <name>` | Voice id, provider-specific. |
| `--format <fmt>` | `mp3` (default), `wav`, `flac`, `aac`, `opus`. |
| `--speed <n>` | Playback speed 0.25–4.0. OpenAI only. |
| `--instructions <text>` | Steering for steerable voices (e.g. `gpt-4o-mini-tts`). |
| `-o, --output <path>` | Output path. |
| `-p, --prompt-file <path>` | Read text from file. |
| `--play` | Play through speakers. When piped, also emits bytes downstream. |
| `--wait` | With `--play`, block until playback ends. |
| `--binary` | Force raw audio bytes to stdout. |
| `--b64` | Envelope with inline base64. |
| `--json` | Envelope on stdout (instead of just the path). |
| `--retries <n>` | Retry attempts. |
| `--timeout <seconds>` | Per-attempt timeout. |
| `--session <name>` | Session binding. |

### TTY-aware default

| Invocation | Output |
| --- | --- |
| `marmot speak '...'` (TTY) | Plays in foreground from a temp file, deletes after. |
| `marmot speak '...' > out.mp3` | Raw bytes to stdout. |
| `marmot speak '...' \| mpv -` | Raw bytes to stdout. |
| `marmot speak '...' -o hi.mp3` | Writes `hi.mp3`; prints path. |
| `marmot speak '...' --play` | Plays. When piped, also emits bytes downstream. |
| `marmot speak '...' --binary` | Raw bytes regardless of TTY. |
| `marmot speak '...' --b64` | Envelope with base64. |
| `marmot speak '...' --json` | Writes file, emits envelope. |

### Examples

```bash
marmot speak 'hello from marmot'
marmot speak 'welcome' --voice nova -o ./hello.mp3
marmot speak 'hola mundo' --provider cloudflare --model @cf/myshell-ai/melotts
marmot speak 'welcome aboard' --model gpt-4o-mini-tts --voice ash \
  --instructions 'cheerful, slow, slightly British'
marmot speak 'hello' --play | marmot transcribe
```

## `transcribe`

```bash
marmot transcribe <audio> [flags…]
```

Providers: `openai`, `openrouter`, `vercel`, `cloudflare`. Audio source priority: positional path, `--input`, piped binary stdin. At least one is required.

### Flags

| Flag | Purpose |
| --- | --- |
| `--provider <slug>` | Transcription-capable provider. |
| `--model <id>` | STT model. |
| `--api-key <key>` | Override env key. |
| `-i, --input <path>` | Audio file path (alternative to positional). |
| `-o, --output <path>` | Write rendered output to file. |
| `--language <code>` | ISO-639-1 hint (e.g. `en`, `es`). |
| `--prompt <text>` | Bias prompt to guide transcription (names, jargon). |
| `--format <fmt>` | `text` (default), `json`, `srt`, `vtt`, `verbose-json`. |
| `--text` | Plain text. Kept for back-compat (now the default). |
| `--json` | Alias for `--format json`. |
| `--retries <n>` | Retry attempts. |
| `--timeout <seconds>` | Per-attempt timeout. |
| `--session <name>` | Session binding. |

`verbose-json` returns the envelope plus raw provider response (segments, timing). `--segments` is **not** an actual flag; segment data lives inside `verbose-json`.

### Examples

```bash
marmot transcribe ./meeting.mp3
marmot transcribe ./meeting.mp3 --json
marmot transcribe ./meeting.mp3 --format srt -o ./meeting.srt
cat ./meeting.mp3 | marmot transcribe
marmot transcribe ./call.mp3 --prompt 'technical interview, names: Ada, Linus'
marmot transcribe ./meeting.mp3 --provider cloudflare \
  --model @cf/openai/whisper-large-v3-turbo --language en
```

## Streaming, retry, timeout

- `--stream` (run only): tokens to stdout as they arrive. Mutually exclusive with `--json` and `--schema*`. Final newline appended if the stream didn't end with one.
- `--retries <n>`: attempts beyond the first on retryable provider errors (transport / 429 / 5xx). Exponential backoff. Streaming retries only fire if no chunks were emitted on the failed attempt.
- `--timeout <seconds>`: per-attempt hard timeout. Aborts via `AbortSignal`. Multiplied by retries for total wall time.

All four verbs honor `--retries` and `--timeout`. Only `run` has `--stream`.

## Stdin / stdout discipline

- Results on stdout. Spinners, info, and warnings on stderr.
- For `run`: piped stdin concatenates into the prompt unless `--image -` or `--file -` claims the binary slot.
- Canonical pipelines:
  ```bash
  git diff | marmot --stream 'commit msg' | pbcopy
  marmot image 'cat' > cat.png
  marmot speak 'hello' | mpv -
  cat call.mp3 | marmot transcribe --format srt > call.srt
  marmot speak 'roundtrip' --play | marmot transcribe
  ```

## Pitfalls and quirks

- `--json` and `--stream` don't combine. `--stream` always wins and forces text.
- `--schema*` rejects `--stream` and `--text`. Object mode is always JSON.
- `--binary` on `image` requires `--n 1`. With multiple images you must write to files.
- AI verbs bypass marmot's response cache. Caching applies only to web/data verbs.
- Cloudflare needs both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Missing either is a hard auth error.
- Ollama needs no key. Set `OLLAMA_HOST` if not at `http://localhost:11434`.
- Model id is validated against a 24h cache for `run`. If a freshly added model 404s, run `marmot ai cache refresh <provider>`. `image`, `speak`, and `transcribe` skip cache validation; the provider rejects unknown ids directly.
- Anthropic, Ollama don't support `image` / `speak` / `transcribe`. Provider check fails before the API call.
- `--speed` on `speak` is OpenAI-only. Other providers ignore it or error.
- `--instructions` only steers steerable voices like `gpt-4o-mini-tts`. Standard voices ignore it.
- `marmot speak --play` plus a pipe is the documented dual-output mode; both speakers and downstream get the bytes.
- For `transcribe`, `--json` is sugar for `--format json`. `--format` wins if both are passed.
