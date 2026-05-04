# Releasing marmot

Manual release process for v0.x. We do not have CI/CD release automation yet (intentional for v0.1 — keeping things simple). This document is the canonical checklist.

## What gets published

Two npm packages, both MIT licensed:

| Package | Bin | Notes |
| --- | --- | --- |
| `@marmot-sh/cli` | `marmot` | The canonical scoped package. Bundled single file under `dist/cli.js`. |
| `marmot-sh` | `marmot` | Unscoped alias. Ships the same `dist/cli.js`, copied at publish time from `@marmot-sh/cli`. |

Both stay in version lockstep manually. When you bump one, bump the other.

## Pre-release checklist

Before you publish:

- [ ] `git status` clean. Untracked files don't get bundled, but commit anything you intend to ship.
- [ ] `pnpm install --frozen-lockfile` — confirms the lockfile is current.
- [ ] `pnpm typecheck` — every package passes (44 tasks).
- [ ] `pnpm test` — core (~405 tests) and CLI (~261 tests) green.
- [ ] `pnpm --filter @marmot-sh/cli build` — produces `apps/cli/dist/cli.js` (~2.5 MB ESM bundle with shebang).
- [ ] Smoke test from the built artifact:
  ```bash
  node apps/cli/dist/cli.js --version    # should print the new version
  node apps/cli/dist/cli.js --help       # groups render with orange titles
  node apps/cli/dist/cli.js about        # banner + version + marmot.sh
  ```
- [ ] Bump versions in **both** package.json files:
  - `apps/cli/package.json` `version`
  - `apps/marmot-sh/package.json` `version`
- [ ] Add a new entry to `CHANGELOG.md` describing what changed (Breaking / Added / Changed / Fixed sections, plus a Migration note when the version is breaking). The CHANGELOG entry should be in the same commit as the version bump so the tag points at code whose CHANGELOG already documents the release.

## Publishing

```bash
# Publish the canonical scoped package first.
cd apps/cli
pnpm publish --access public

# Then the unscoped alias. Its prepublishOnly script runs
# `pnpm --filter @marmot-sh/cli build && pnpm run build`
# which rebuilds the CLI and copies dist/cli.js into apps/marmot-sh/dist/.
cd ../marmot-sh
pnpm publish --access public
```

After both publish, tag the release:

```bash
cd ../..
git tag v$(node -p "require('./apps/cli/package.json').version")
git push origin --tags
```

Create a GitHub Release pointing at the tag, with a brief summary of changes. Link the two npm packages.

## Post-release verification

- [ ] `npm view @marmot-sh/cli version` shows the new version.
- [ ] `npm view marmot-sh version` shows the new version (same as above).
- [ ] On a clean machine (or in a Docker container): `npm install -g marmot-sh && marmot --version` prints the expected version.
- [ ] Visit `https://www.npmjs.com/package/@marmot-sh/cli` and `https://www.npmjs.com/package/marmot-sh`; both pages show the new version, the README, and the bin entry.

## Provenance and supply chain

Today, marmot is published from a maintainer's laptop, manually. There is **no** npm provenance attestation (`--provenance`), no signed commits requirement, and no automated build-from-source.

We will move to npm provenance via a GitHub Actions workflow before v1.0. Until then:

- Maintainer publish credentials are scoped npm tokens with publish-only permission, stored in 1Password.
- Publishes happen from a clean working tree (`git status` clean before `pnpm publish`).
- The bundled artifact is reproducible: anyone can `git checkout v0.x.y && pnpm install && pnpm --filter @marmot-sh/cli build` and compare `apps/cli/dist/cli.js` against the published tarball.

## Skill bundle

The agent skill at `skills/marmot/` is **not** published to npm. The CLI fetches it on demand from this repo on GitHub, pinned to a specific commit SHA (see `packages/core/src/lib/skill.ts`). When you push changes to `skills/marmot/` on `main`, the next `marmot setup` run that selects the skill install option will pick them up.

If the skill schema changes in a way that breaks compatibility with older CLI versions, bump the CLI minor version and update the relevant `marmot setup` flow to refuse outdated skill versions.

## Hotfix process

For an urgent fix:

1. Branch from the last release tag: `git checkout -b hotfix/v0.x.y v0.x.(y-1)`.
2. Cherry-pick or apply the fix.
3. Bump the patch version in both `package.json`s.
4. Run the full pre-release checklist.
5. Publish and tag as above.

## Future

When the project moves out of v0.x:

- Replace the hand-edited `CHANGELOG.md` with `.changeset/` automation
- Set up GitHub Actions for CI (typecheck + test on PR)
- Add a release workflow with npm provenance (`--provenance`)
- Submit `marmot` to homebrew-core (after stability + adoption thresholds)
- Define a stable LTS support window in `SECURITY.md`
