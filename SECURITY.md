# Security policy

We take security in marmot seriously. This document explains what's covered, how to report a vulnerability, and what to expect in response.

## Supported versions

Marmot is at v0.1.x. During the v0.x phase, security fixes ship to the latest released minor version only. Once v1.0 is published, this policy will be updated to define a longer support window.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email **security@marmot.sh** with:

- A clear description of the issue
- A minimal reproduction (commands, config, env vars, expected vs. actual behavior)
- The version you tested (`marmot --version`)
- Your assessment of severity and impact

We aim to:

- Acknowledge receipt within **3 business days**
- Confirm or dispute the report within **7 business days**
- Ship a fix and a coordinated disclosure within **30 days** for high-severity issues, or longer with your agreement for lower-severity issues

We'll credit reporters in the release notes unless you ask us not to.

## In scope

- The `marmot` CLI binary (the `@marmot-sh/cli` and `marmot-sh` npm packages)
- The provider adapters in this repo (`@marmot-sh/openrouter`, `@marmot-sh/anthropic`, etc.)
- The marmot.sh documentation site (when published from this repo)

Examples of in-scope issues:

- Path traversal or arbitrary file read/write through CLI flags
- API key leakage to logs, cache files, error messages, or third parties
- Code execution via untrusted inputs (CLI args, piped stdin, downloaded artifacts)
- Tarball substitution / supply-chain weakness in `marmot setup` / skill installer
- Cross-site scripting or content injection on marmot.sh

## Out of scope

- **Third-party provider APIs** (OpenAI, Anthropic, OpenRouter, etc.). Report those to the providers directly.
- **`--schema-module <path>`** is documented as a trusted-code feature: it executes any local `.ts`/`.js` you point it at with full Node privileges. Do not point it at code you didn't write or audit. Issues asking us to "sandbox" it are out of scope; this is intended behavior for a trusted local tool.
- **Compromise of a user's own machine, env vars, or shell history.** Marmot reads API keys from env vars by design.
- Vulnerabilities that require a malicious npm dependency we don't ship. (We bundle our deps, so the published tarball is the audit surface.)

## What marmot does to reduce risk

- All API keys are read from env vars or the `--api-key` flag. Keys are never persisted to the on-disk config (`~/.marmot/ai/config.json` only stores env-var *names*, not values).
- The response cache (`~/.marmot/ai/cache/responses/`) only stores response bodies. Request inputs that include the API key, abort signal, or fetch function are excluded from cache keys and cached payloads.
- Cache file permissions are `0o600`; the cache directory is `0o700`.
- Provider error messages are wrapped to strip secrets before being shown.
- Retry-on-flake is opt-in (`--retries N`, default 0) so paid-API calls aren't silently double-billed.
- The skill installer pins the GitHub tarball to a specific commit SHA before download (no mutable `main` redirects).
- The CLI ships as a single bundled JS file with no install-time scripts.

## Coordinated disclosure

We follow standard coordinated disclosure. We'll work with you on a release schedule. Please do not publicly disclose the issue until a fix is available.

Thank you for helping keep marmot users safe.
