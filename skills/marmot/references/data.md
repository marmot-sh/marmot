# marmot data verbs

Three verbs over a people/company/email graph: `enrich` (identifier in, full record out), `lookup` (filters in, list out), `verify` (email deliverability). Eight providers in a single namespace. Every verb returns a JSON envelope with `ok`, `provider`, `verb`, `type`, `cached`, `data`, `raw`, `usage`, `timestamp`. No implicit fallback. Invalid `--type` x `--provider` errors at parse time before any network call.

## Capability matrix (verb x type x provider)

| Cell | apollo | hunter | pdl | tomba | bouncer | datagma | zerobounce | kickbox |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `enrich --type person` | yes 1 | yes 2 | yes | yes 2 | | yes 3 | | |
| `enrich --type org` | yes | yes | yes | yes | | | | |
| `lookup --type person` | yes 1 | | yes | | | | | |
| `lookup --type org` | yes 1 | | yes | yes | | | | |
| `lookup --type email` | | yes | | yes | | | | |
| `verify --type email` | | yes | | yes | yes | yes | yes | yes |

1. Apollo `lookup` and `enrich --type person` need a master/paid key. Free keys 403 with `error_code: API_INACCESSIBLE`.
2. Hunter and Tomba person-enrich accept `--email` (combined-find route) or `--first-name + --last-name + --domain` (email-finder route, synthesizes most likely email).
3. Datagma is person-only. Adapter pins `phoneFull=true` so mobile numbers come back (10 credits/call vs 1).

## Provider env vars

| Provider | Required | Extra |
| --- | --- | --- |
| apollo | `APOLLO_API_KEY` | |
| hunter | `HUNTER_API_KEY` | |
| pdl | `PDL_API_KEY` | |
| tomba | `TOMBA_API_KEY` | `TOMBA_SECRET_KEY` (mandatory; dual-header auth) |
| bouncer | `BOUNCER_API_KEY` | |
| datagma | `DATAGMA_API_KEY` | (sent as `?apiId=` query param, not header) |
| zerobounce | `ZEROBOUNCE_API_KEY` | (sent as `?api_key=` query param) |
| kickbox | `KICKBOX_API_KEY` | (sent as `Authorization: <key>`, no `Bearer`) |

`--api-key <key>` on any verb overrides the env var for one call. Tomba's secret cannot be overridden per-call; set `TOMBA_SECRET_KEY` in env (or point marmot at a different env-var name with `marmot config set providers.tomba.apiSecretEnvVar <ENV_VAR_NAME>`).

## `enrich`

```
marmot enrich --type <person|org> [identifier flags] [--provider <slug>]
```

One identifier (or a few) in, one record out. No fan-out. Provider routes off whichever identifiers you pass.

### Identifier flags

| Flag | person | org | Notes |
| --- | :-: | :-: | --- |
| `--email <addr>` | yes | | Apollo, Hunter, PDL, Tomba accept. |
| `--email-hash <hex>` | yes | | MD5 or SHA-256. Apollo and PDL only. |
| `--linkedin <url>` | yes | yes | Apollo person via `linkedin_url`; PDL via `profile`. |
| `--phone <number>` | yes | | PDL only. |
| `--name <full>` | yes | yes | Org name fallback when `--domain` unknown. |
| `--first-name <first>` | yes | | Pair with `--last-name` (and `--domain` for Hunter/Tomba). |
| `--last-name <last>` | yes | | Pair with `--first-name`. |
| `--middle-name <middle>` | yes | | PDL only. |
| `--domain <domain>` | sharpens | yes | Required for Apollo/Hunter/Tomba org-enrich. |
| `--company <ref>` | sharpens | | Employer name, domain, or social URL (PDL). |
| `--website <url>` | | yes | PDL preferred for org-enrich (high precision). |
| `--ticker <symbol>` | | yes | PDL only. |
| `--provider-id <id>` | yes | yes | Apollo `id` / PDL `pdl_id` for re-fetch. |

At least one identifier is required per type. The CLI rejects empty calls before dialing out.

### Match controls

| Flag | Description |
| --- | --- |
| `--min-likelihood <n>` | Reject below this provider score (PDL: 1-10). Positive integer. |
| `--require <fields>` | Comma-separated; result must populate these fields. |
| `--fields <list>` | Comma-separated; restrict response payload (no cost reduction). |

### Common flags

| Flag | Description |
| --- | --- |
| `--provider <slug>` | One of `apollo`, `hunter`, `pdl`, `tomba`, `datagma`. Falls back to `defaults.enrich.provider`. |
| `--api-key <key>` | Override env var for this call. |
| `--raw` | Replace `data` with `null`, put native provider body under `raw`. |
| `--no-cache` | Skip cache read and write. |
| `--refresh` | Skip cache read but write fresh response (overwrites cached entry). |

Cache flags are no-ops unless caching is enabled per-provider via `providers.<slug>.cache.enabled`.

### Person envelope (`DataNormalizedPerson`)

```json
{
  "ok": true,
  "provider": "hunter",
  "verb": "enrich",
  "type": "person",
  "cached": false,
  "data": {
    "person": {
      "fullName": "Tim Cook",
      "firstName": "Tim",
      "lastName": "Cook",
      "email": "tcook@apple.com",
      "emails": ["tcook@apple.com"],
      "phone": null,
      "linkedin": "linkedin.com/in/tcook",
      "twitter": null,
      "github": null,
      "title": "CEO",
      "seniority": "executive",
      "department": null,
      "providerId": "abc123",
      "confidence": 97,
      "location": "Cupertino, CA",
      "org": {
        "name": "Apple",
        "domain": "apple.com",
        "industry": "Consumer Electronics",
        "headcount": 164000,
        "headcountRange": "10000+",
        "foundedYear": 1976,
        "location": "Cupertino, CA",
        "linkedin": "linkedin.com/company/apple",
        "providerId": "..."
      }
    }
  },
  "raw": null,
  "usage": null,
  "timestamp": "2026-05-03T00:00:00.000Z"
}
```

`data.person` is `null` when the provider has no match. That is not an error.

### Org envelope (`DataNormalizedOrg`)

```json
{
  "ok": true,
  "provider": "pdl",
  "verb": "enrich",
  "type": "org",
  "cached": false,
  "data": {
    "org": {
      "name": "Stripe",
      "domain": "stripe.com",
      "description": "Payments infrastructure",
      "industry": "Financial Services",
      "headcount": 8000,
      "headcountRange": "5001-10000",
      "foundedYear": 2010,
      "location": "South San Francisco, CA",
      "linkedin": "linkedin.com/company/stripe",
      "twitter": "stripe",
      "providerId": "..."
    }
  },
  "raw": null,
  "usage": null,
  "timestamp": "2026-05-03T00:00:00.000Z"
}
```

### Examples

```bash
marmot enrich --type person --email tcook@apple.com --provider hunter
marmot enrich --type person --first-name Tim --last-name Cook --domain apple.com --provider pdl
marmot enrich --type person --linkedin linkedin.com/in/tcook --provider apollo
marmot enrich --type person --phone +14155551212 --provider pdl
marmot enrich --type org --domain stripe.com --provider pdl
marmot enrich --type org --domain stripe.com --provider apollo --raw
```

### Presets (enrich mode)

All 13 identifier fields are preset-able as of 0.7.0 (scalar replace): `email`, `emailHash`, `linkedin`, `phone`, `name`, `firstName`, `lastName`, `middleName`, `company`, `providerId`, `domain`, `website`, `ticker`. Plus `type`, `minLikelihood`, `require`, `fields`, `cache`, `refresh`, `output`, `raw`, `retries`, `timeout`, `session`. Realistic pattern is partial baking — preset bakes the persistent context (company, domain, type), runtime supplies the per-call identifier.

```bash
marmot preset create acme-people --mode enrich --provider pdl --type person --company acme.com
marmot @acme-people --first-name Jane
```

## `lookup`

```
marmot lookup --type <person|org|email> [filter flags] [--provider <slug>]
```

Structured filters in, paginated list out. Opposite shape from `enrich`.

### Filter flags

| Flag | person | org | email | Notes |
| --- | :-: | :-: | :-: | --- |
| `--q <text>` | yes | yes | | Free-form keyword query. |
| `--title <text>` | yes | | | Apollo `person_titles`, PDL `job_title`. |
| `--seniority <enum>` | yes | | yes | `junior`, `senior`, `executive` (Hunter/Tomba); Apollo enum values. |
| `--location <text>` | yes | yes | | Geographic filter. |
| `--domain <csv>` | yes | yes | yes | Comma-separated for person/org; single for email. |
| `--employees <min,max>` | yes | yes | | Range, e.g. `100,500`. Both ints, both >= 0. |
| `--industry <text>` | | yes | | Org industry. |
| `--tech <csv>` | | yes | | Apollo `currently_using_any_of_technology_uids`, Tomba `technologies`. |
| `--department <text>` | | | yes | Hunter / Tomba. |
| `--email-type <kind>` | | | yes | `personal` or `generic`. |
| `--company <name>` | | | yes | Alternative to `--domain` for Hunter/Tomba. |
| `--limit <n>` | yes | yes | yes | Positive int. Capped at 100 per page on most providers. |
| `--cursor <token>` | yes | yes | yes | Opaque pagination cursor from prior `nextCursor`. |

`lookup --type email` requires `--domain` or `--company`; the CLI rejects without one.

### Common flags

Same as `enrich`: `--provider`, `--api-key`, `--raw`, `--no-cache`, `--refresh`. Default falls back to `defaults.lookup.provider`.

### Person/org envelope

```json
{
  "ok": true,
  "provider": "pdl",
  "verb": "lookup",
  "type": "person",
  "cached": false,
  "data": {
    "results": [{ "fullName": "...", "title": "...", "org": { "domain": "..." } }],
    "total": 42,
    "nextCursor": "scroll_..."
  },
  "raw": null,
  "usage": null,
  "timestamp": "2026-05-03T00:00:00.000Z"
}
```

Org `results` are `DataNormalizedOrg[]`. `total` and `nextCursor` may be `null` when the provider doesn't expose them.

### Email envelope (`DataEmailRecord[]` plus domain metadata)

```json
{
  "data": {
    "results": [
      {
        "email": "alice@acme.com",
        "firstName": "Alice",
        "lastName": "Doe",
        "fullName": "Alice Doe",
        "title": "Engineer",
        "seniority": "senior",
        "department": "engineering",
        "type": "personal",
        "confidence": 95,
        "verificationStatus": "valid"
      }
    ],
    "domain": "acme.com",
    "pattern": "{first}.{last}",
    "acceptAll": false,
    "total": 12,
    "nextCursor": null
  }
}
```

### Pagination

Cursors are opaque per provider (PDL `scroll_token`, Apollo page number, Hunter `offset`, Tomba page number). Pass the prior response's `data.nextCursor` back as `--cursor`. Don't construct cursors by hand. PDL charges 1 credit per record returned, so size `--limit` deliberately and use cursors instead of re-running predicates.

### Examples

```bash
marmot lookup --type person --title "VP Eng" --domain stripe.com,plaid.com --employees 100,500 --provider pdl
marmot lookup --type org --industry fintech --tech salesforce,segment --employees 50,1000 --provider apollo
marmot lookup --type email --domain acme.com --department engineering --provider hunter
marmot lookup --type email --company "Acme Corp" --email-type personal --provider tomba
```

### Presets (lookup mode)

All filter fields are preset-able as of 0.7.0: `type`, `q`, `limit`, `cursor`, `title`, `seniority`, `location`, `domain`, `industry`, `employees`, `tech`, `emailType`, `department`, `company`. Plus `cache`, `refresh`, `output`, `raw`, `retries`, `timeout`, `session`. All scalar-replace.

```bash
marmot preset create yc-engs --mode lookup --provider apollo --type person \
  --title "Engineering Manager" --seniority manager
marmot @yc-engs --location "San Francisco" --limit 50
```

## `verify`

```
marmot verify <email> [--provider <slug>]
```

The legacy `--email <addr>` flag was removed in 0.7.0. Pass the email positionally or set it on a verify-mode preset.

Email deliverability across six providers. Same normalized `{deliverable, status, score, checks{...}}` envelope so callers don't special-case the provider.

### Picking a provider

| Want | Use |
| --- | --- |
| Deepest sub-status taxonomy (30+ values) | zerobounce |
| Greylist-aware retry hints + toxicity scoring | bouncer |
| One provider for verify + person enrich + phone | datagma |
| Cheapest free tier with separate counters | hunter |
| 30-day request dedup as built-in saving | tomba |
| Sendgrid/Twilio brand trust + Sendex confidence | kickbox |

### Flags

| Flag | Description |
| --- | --- |
| `<email>` (positional) | Email to verify. Optional if `--email` is set. |
| `--email <addr>` | Alternative to positional. |
| `--provider <slug>` | One of `hunter`, `tomba`, `bouncer`, `datagma`, `zerobounce`, `kickbox`. Falls back to `defaults.verify.provider`. |
| `--api-key <key>` | Override env var for this call. |
| `--raw` | Replace `data` with `null`, put native provider body under `raw`. |
| `--no-cache` | Skip cache read and write. |
| `--refresh` | Skip cache read but write fresh response. |

### Envelope (`DataEmailVerification`)

```json
{
  "ok": true,
  "provider": "hunter",
  "verb": "verify",
  "type": "email",
  "cached": false,
  "data": {
    "email": "alice@acme.com",
    "deliverable": true,
    "status": "valid",
    "score": 99,
    "checks": {
      "regexp": true,
      "mxRecords": true,
      "smtpServer": true,
      "smtpCheck": true,
      "acceptAll": false,
      "disposable": false,
      "webmail": false,
      "gibberish": null,
      "block": false
    }
  },
  "raw": null,
  "usage": null,
  "timestamp": "2026-05-03T00:00:00.000Z"
}
```

`deliverable` is `true` when `status` is `valid` / `accept_all` / `catch-all` / `deliverable` (which one depends on provider). Each check is `true`, `false`, or `null` (provider doesn't expose that signal). Status taxonomies vary per provider; if you depend on exact strings, branch on `provider`.

### Examples

```bash
marmot verify alice@acme.com --provider hunter
marmot verify alice@acme.com --provider zerobounce
marmot verify alice@acme.com --provider bouncer
echo 'alice@acme.com' | xargs marmot verify --provider kickbox
```

### Presets (verify mode)

`email` (positional, scalar), `cache`, `refresh`, `output`, `raw`, `retries`, `timeout`, `session`. The positional email becomes optional when a preset supplies it.

```bash
marmot preset create verify-team --mode verify --provider hunter --email team@example.com
marmot @verify-team
marmot @verify-team other@example.com   # runtime overrides preset
```

## Per-provider quirks

- **Apollo** — paid plan needed for `lookup` (both types) and `enrich --type person`. Free keys 403 with `error_code: API_INACCESSIBLE`. Org-enrich works on free.
- **Hunter** — three independent counters: `searches`, `verifications`, `credits`. `enrich` consumes `credits`; `verify` consumes `verifications`. Verifier may return HTTP 202 with `status: "unknown"`; adapter polls 1s -> 2s -> 4s -> 8s -> 15s (cap 30s) until status settles.
- **PDL** — billed per `200` response; 404 (no match) doesn't consume credit. `dataset=mobile_phone` and `dataset=street_address` plan-gated; adapter passes 403s through verbatim. `lookup` charges 1 credit per record returned.
- **Tomba** — dual-key auth (`TOMBA_API_KEY` + `TOMBA_SECRET_KEY`); both required. 30-day request dedup means repeats within window are free. Counter shape mirrors Hunter (`searches`, `verifications`, `credits`).
- **Bouncer** — only verifier with `retryAfter` for greylisted addresses; envelope downgrades to `status: "unknown"`, original `retryAfter` preserved in `--raw`. Also returns toxicity (0-5) and resolved MX provider in `--raw`.
- **Datagma** — query-param auth (`?apiId=<key>`). `enrich.person` always sets `phoneFull=true` (10 credits/call vs 1) to return mobile. No org-enrich; verifier proxies ZeroBounce internally.
- **ZeroBounce** — query-param auth (`?api_key=<key>`). Deepest sub-status taxonomy of any verifier (30+ values like `mailbox_not_found`, `failed_smtp_connection`). `score` is `null` on `/validate`; AI scoring is a separate file-only endpoint not yet wired. Regional URLs (US/EU) for data residency not yet wired.
- **Kickbox** — owned by Sendgrid/Twilio. `Authorization: <key>` header (no `Bearer`). Four-value `result` (`deliverable`/`undeliverable`/`risky`/`unknown`) plus `sendex` 0.0-1.0 confidence projected to 0-100 in envelope `score`. Role-based addresses (`info@`, `sales@`) flow into `checks.block`. Free unauthenticated disposable endpoint not yet wired.

## Universal patterns

- All data verbs return a JSON envelope with `cached: bool`. `cached: true` means the response came from disk and no API call was made.
- Caching is disabled by default. Opt in per-provider with `marmot config set providers.<slug>.cache.enabled true`. `--no-cache` and `--refresh` are no-ops if caching isn't enabled for that provider.
- Disabled providers (`providers.<slug>.enabled: false`) fail fast with an actionable error before any auth or network work.
- Capability matrix is enforced at parse time. `marmot lookup --type email --provider apollo` errors before reading config.
- `--raw` swaps `data` to `null` and surfaces the provider's native body verbatim under `raw`. Use it when normalization drops a field you care about.
- Defaults are configured via `marmot setup` or `marmot config set <verb>.provider <slug>`. Stored under `defaults.{enrich,lookup,verify}.provider`.
- **Session binding (0.6.0+).** Every data verb accepts `--session <name>`. The bound name flows into the usage record so `marmot usage --session <name>` filters work on data traffic, and the call appears under `marmot session show <name>`. Pre-0.6.0 data verbs hardcoded `session: null` even when a session was active.
