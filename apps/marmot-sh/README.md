# marmot-sh

Unscoped install alias for **marmot** — the unified CLI for AI generation, web search, and enrichment data, built for agents and scripts.

## Install

```bash
npm install -g marmot-sh
```

The installed binary is `marmot`.

## Usage

```bash
marmot 'tell me a joke'
marmot search 'news about apple' | marmot 'give me 5 bullet highlights'
gh pr diff | marmot 'write a commit message under 60 chars'
```

See [marmot.sh](https://marmot.sh) for full docs, the verb reference, and provider catalog.

## What this package is

This is a thin install alias for the canonical [`@marmot-sh/cli`](https://www.npmjs.com/package/@marmot-sh/cli) package. The bundled binary is bit-identical — only the package name differs. The unscoped name exists for two reasons:

1. **Shorter install command** — `npm i -g marmot-sh` vs `npm i -g @marmot-sh/cli`.
2. **Discoverability** — appears in plain `npm search marmot` results.

If you're already comfortable with scoped packages, install `@marmot-sh/cli` directly. Both produce the same `marmot` binary.

## License

MIT — see `LICENSE`.
