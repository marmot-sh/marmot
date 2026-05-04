# Contributing to marmot

Thanks for your interest in marmot. This document covers the basics for getting set up, the conventions we follow, and how to land a PR.

## Quick start

```bash
git clone https://github.com/marmot-sh/marmot.git
cd marmot
pnpm install
pnpm typecheck
pnpm test
```

The repo is a pnpm workspace. Most useful commands run at the root via `turbo`:

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | Typecheck every package and app |
| `pnpm test` | Run the test suite for every package |
| `pnpm --filter @marmot-sh/cli build` | Build the CLI bundle into `apps/cli/dist/cli.js` |
| `pnpm --filter @marmot-sh/cli dev -- --version` | Run the CLI from source via `tsx` |

## Repo layout

```
apps/
  cli/          # @marmot-sh/cli — the CLI source and bundled artifact
  marmot-sh/    # marmot-sh — unscoped npm alias that ships the same binary
  web/          # marmot.sh — landing page and docs
packages/
  core/         # shared types, retry logic, config, paths, response cache
  openrouter/   # AI provider adapter
  anthropic/
  openai/
  ollama/
  vercel/
  cloudflare/
  parallel/     # web-search adapter
  exa/
  firecrawl/
  brave/
  tavily/
  apollo/       # data-lookup adapter
  hunter/
  pdl/
  tomba/
  bouncer/
  datagma/
  zerobounce/
  kickbox/
  ui/           # shadcn primitives consumed by apps/web
  tsconfig/     # shared tsconfig presets
```

## Adding a new provider

1. Create `packages/<slug>/` with the standard package layout (see `packages/openrouter/` as a template).
2. Implement the adapter against the relevant interface in `packages/core/src/types.ts` (`ProviderAdapter` for AI, `WebProviderAdapter` for search/scrape, `DataProviderAdapter` for enrichment).
3. Register the slug in `packages/core/src/lib/constants.ts` (in `PROVIDERS`, `WEB_PROVIDERS`, or `DATA_PROVIDERS` depending on the provider type) and any default-model maps that apply.
4. Wire it into `apps/cli/src/providers/index.ts` (or `web-index.ts` / `data-index.ts`).
5. Add tests under `packages/<slug>/tests/`.
6. Update the docs under `apps/web/content/docs/command-reference/` and `apps/web/content/docs/core/providers.mdx`.

## Conventions

### Code style

- TypeScript everywhere. Strict mode is on.
- ESM only (`"type": "module"` in every package).
- Comments only when the *why* isn't obvious from the code. Don't write what the code already says.
- Prefer small, single-responsibility helpers over inline lambdas in hot paths.
- Adapter methods accept an optional `abortSignal` and forward it to `fetch()` so callers can cancel.

### Errors

- Throw `AICliError(category, message)` from `@marmot-sh/core/lib/errors.js`. Categories:
  - `validation` — bad CLI input. Exit code 2.
  - `auth` — missing/invalid API key. Exit code 3.
  - `network` — couldn't reach the provider. Exit code 4.
  - `provider` — provider returned non-2xx or malformed response. Exit code 5.
  - `io` — local filesystem error. Exit code 6.
  - `cache` — local cache read/write failed. Exit code 7.
- Don't include API keys in error messages. The retry notifier truncates messages at 80 chars but it's safer to never put secrets in the message in the first place.

### Tests

- Vitest. Each package has its own `tests/` directory.
- Mock `fetch` via the `fetchFn` dependency on every adapter — never hit real provider APIs in unit tests.
- Aim for one happy-path test, one failure-path test, and one edge-case test per public function.

### Commits and PRs

- Conventional commit prefixes are appreciated but not required: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`.
- Keep PRs focused. Big refactors and feature additions in the same PR are hard to review.
- Run `pnpm typecheck && pnpm test` before pushing. CI doesn't exist yet (v0.1) so the burden is on you.
- New CLI flags need a doc entry under `apps/web/content/docs/command-reference/`. New error categories need an exit-code mapping in `packages/core/src/lib/errors.ts`.

## Reporting bugs

[Open a GitHub issue](https://github.com/marmot-sh/marmot/issues/new) with:

- Marmot version (`marmot --version`)
- Node version
- Operating system
- The exact command you ran
- The full error output (with API keys redacted)

For security issues, see [SECURITY.md](SECURITY.md) — please do **not** open public GitHub issues for security problems.

## Code of conduct

Be respectful. Assume good intent. We don't have a formal CoC document yet but the standard "be kind, don't harass anyone" applies.

## License

By submitting a contribution, you agree to license it under the repo's [MIT license](LICENSE).
