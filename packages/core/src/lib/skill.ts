// Agent-skill install/update logic.
//
// Marmot's agent skill (the SKILL.md and references the agent reads) lives
// at `skills/marmot/` in this repo. This module fetches that subtree from
// GitHub, writes it to the canonical `.agents/skills/marmot/` directory, and
// creates per-harness symlinks (with copy fallback) so each agent harness
// (Claude Code, OpenCode, Codex, etc.) sees the skill where it expects.
//
// Two install scopes:
//   - global  : ~/.agents/skills/marmot/   (per-user, all projects share)
//   - project : <cwd>/.agents/skills/marmot/  (committed to repo for team-shared)
//
// Per-harness symlinks land at <home-or-cwd>/.<harness>/skills/marmot.
// On Windows or on permission failure the symlink falls back to a copy.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { AICliError, toAICliError } from './errors.js';

export const SKILL_NAME = 'marmot';
export const SKILL_REPO_OWNER = 'marmot-sh';
export const SKILL_REPO_NAME = 'marmot';
export const SKILL_REPO_PATH = 'skills/marmot';
export const SKILL_VERSION_FILE = '.skill-version';

/** Build the tarball URL for a specific git SHA. Pinning to a SHA (rather
 *  than `heads/main`) makes installs reproducible: the bytes downloaded are
 *  the same as the SHA stamped into `.skill-version`, and a malicious
 *  push to main between two install steps can't slip in. */
function tarballUrlForSha(sha: string): string {
  return `https://github.com/${SKILL_REPO_OWNER}/${SKILL_REPO_NAME}/archive/${encodeURIComponent(sha)}.tar.gz`;
}
/** GitHub commits API for fetching the latest commit that touched the skill subtree. */
const COMMITS_API_URL = `https://api.github.com/repos/${SKILL_REPO_OWNER}/${SKILL_REPO_NAME}/commits?path=${SKILL_REPO_PATH}&per_page=1`;

/* -- types ------------------------------------------------------------------ */

export type InstallScope = 'global' | 'project';

export type HarnessSlug = 'claude-code' | 'opencode' | 'codex';

export type HarnessInfo = {
  slug: HarnessSlug;
  displayName: string;
  /** Returns true when this harness is installed (its config dir exists). */
  detect: (env: NodeJS.ProcessEnv) => boolean;
  /** Returns the path the symlink should land at, given the install scope. */
  symlinkPath: (scope: InstallScope, env: NodeJS.ProcessEnv, cwd: string) => string;
};

export type SkillState = {
  installed: boolean;
  /** Where the canonical install lives (only set when installed). */
  canonicalPath?: string;
  /** Local commit SHA recorded at install time. */
  localVersion?: string;
  /** Remote commit SHA from GitHub. Only set when a network check ran. */
  remoteVersion?: string;
  /** True when localVersion !== remoteVersion (and remote is known). */
  outdated?: boolean;
  /** Harnesses that currently have a symlink/copy pointing at the skill. */
  linkedHarnesses: HarnessSlug[];
  /** Harnesses that are installed on the machine but not yet linked. */
  detectedHarnesses: HarnessSlug[];
};

/* -- constants -------------------------------------------------------------- */

const HARNESSES: readonly HarnessInfo[] = [
  {
    slug: 'claude-code',
    displayName: 'Claude Code',
    detect: (env) => existsSync(env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude')),
    symlinkPath: (scope, env, cwd) => {
      if (scope === 'project') return join(cwd, '.claude', 'skills', SKILL_NAME);
      const dir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
      return join(dir, 'skills', SKILL_NAME);
    },
  },
  {
    slug: 'opencode',
    displayName: 'OpenCode',
    detect: (_env) => existsSync(join(homedir(), '.opencode')),
    symlinkPath: (scope, _env, cwd) =>
      scope === 'project'
        ? join(cwd, '.opencode', 'skills', SKILL_NAME)
        : join(homedir(), '.opencode', 'skills', SKILL_NAME),
  },
  {
    slug: 'codex',
    displayName: 'Codex',
    detect: (env) => existsSync(env.CODEX_HOME?.trim() || join(homedir(), '.codex')),
    symlinkPath: (scope, env, cwd) => {
      if (scope === 'project') return join(cwd, '.codex', 'skills', SKILL_NAME);
      const dir = env.CODEX_HOME?.trim() || join(homedir(), '.codex');
      return join(dir, 'skills', SKILL_NAME);
    },
  },
];

/* -- canonical path resolution --------------------------------------------- */

/**
 * Resolve the canonical install directory for the marmot skill.
 * Global → `~/.agents/skills/marmot`. Project → `<cwd>/.agents/skills/marmot`.
 */
export function getCanonicalSkillDir(
  scope: InstallScope,
  cwd: string = process.cwd(),
): string {
  const base = scope === 'global' ? homedir() : cwd;
  return join(base, '.agents', 'skills', SKILL_NAME);
}

/* -- harness detection ----------------------------------------------------- */

export function detectHarnesses(
  env: NodeJS.ProcessEnv = process.env,
): HarnessSlug[] {
  return HARNESSES.filter((h) => h.detect(env)).map((h) => h.slug);
}

export function listKnownHarnesses(): readonly HarnessInfo[] {
  return HARNESSES;
}

export function harnessFor(slug: HarnessSlug): HarnessInfo {
  const found = HARNESSES.find((h) => h.slug === slug);
  if (!found) throw new AICliError('validation', `Unknown harness "${slug}".`);
  return found;
}

/* -- state inspection ------------------------------------------------------ */

export async function readSkillState(
  scope: InstallScope,
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    fetchFn?: typeof fetch;
    /** When true, skip the network call to fetch remote version. */
    skipRemote?: boolean;
  } = {},
): Promise<SkillState> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const canonicalPath = getCanonicalSkillDir(scope, cwd);
  const installed = existsSync(canonicalPath);

  const localVersion = installed
    ? await readSkillVersion(canonicalPath).catch(() => undefined)
    : undefined;

  let remoteVersion: string | undefined;
  if (!options.skipRemote) {
    remoteVersion = await fetchLatestSkillSha(options.fetchFn).catch(() => undefined);
  }

  const detectedHarnesses = detectHarnesses(env);
  const linkedHarnesses: HarnessSlug[] = [];
  if (installed) {
    for (const slug of detectedHarnesses) {
      const linkPath = harnessFor(slug).symlinkPath(scope, env, cwd);
      if (await linkPointsTo(linkPath, canonicalPath)) {
        linkedHarnesses.push(slug);
      }
    }
  }

  return {
    installed,
    canonicalPath: installed ? canonicalPath : undefined,
    localVersion,
    remoteVersion,
    outdated:
      installed && localVersion && remoteVersion ? localVersion !== remoteVersion : undefined,
    linkedHarnesses,
    detectedHarnesses,
  };
}

/* -- version helpers ------------------------------------------------------- */

export async function readSkillVersion(canonicalPath: string): Promise<string | undefined> {
  const path = join(canonicalPath, SKILL_VERSION_FILE);
  try {
    const raw = await readFile(path, 'utf8');
    return raw.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function writeSkillVersion(
  canonicalPath: string,
  version: string,
): Promise<void> {
  await writeFile(join(canonicalPath, SKILL_VERSION_FILE), `${version}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function fetchLatestSkillSha(
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(COMMITS_API_URL, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'marmot-cli' },
    });
  } catch (error) {
    throw toAICliError(error, 'network', 'Failed to query GitHub for skill version.');
  }
  if (!response.ok) {
    throw new AICliError(
      'provider',
      `GitHub commits API returned ${response.status}.`,
    );
  }
  const payload = (await response.json()) as Array<{ sha?: string }>;
  const sha = payload[0]?.sha;
  if (!sha) {
    throw new AICliError('provider', 'GitHub commits API returned no SHA.');
  }
  return sha;
}

/* -- install --------------------------------------------------------------- */

export type InstallResult = {
  canonicalPath: string;
  version: string;
  symlinks: Array<{ harness: HarnessSlug; path: string; mode: 'symlink' | 'copy' }>;
};

export async function installSkill(
  scope: InstallScope,
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    fetchFn?: typeof fetch;
    /** Override which harnesses receive symlinks. Defaults to all detected. */
    harnesses?: readonly HarnessSlug[];
    /**
     * Override the tarball fetch with a local extraction. Used by tests so we
     * don't actually hit GitHub. Returns the path to the extracted skill dir.
     */
    extractOverride?: () => Promise<string>;
  } = {},
): Promise<InstallResult> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const canonicalPath = getCanonicalSkillDir(scope, cwd);

  // Resolve the target SHA *first*, then download a tarball pinned to
  // that exact commit. This guarantees the bytes installed match the
  // version we stamp; pinning to `heads/main` would let a push between
  // resolve and download silently substitute different content.
  let version: string;
  try {
    version = await fetchLatestSkillSha(options.fetchFn);
  } catch (error) {
    // If we can't resolve a SHA, refuse to install. We won't know what
    // we got, and a generic "main" snapshot defeats the integrity story.
    if (options.extractOverride) {
      // Tests can still bypass via extractOverride.
      version = 'unknown';
    } else {
      throw error;
    }
  }

  const extractedSkillDir = options.extractOverride
    ? await options.extractOverride()
    : await downloadAndExtractSkill(version, options.fetchFn);

  // Replace the canonical dir atomically (best-effort: rm + mv).
  await mkdir(dirname(canonicalPath), { recursive: true, mode: 0o700 });
  await rm(canonicalPath, { recursive: true, force: true });
  await cp(extractedSkillDir, canonicalPath, { recursive: true });

  // Best-effort cleanup of the tempdir parent if extractOverride didn't manage it.
  if (!options.extractOverride) {
    const tmpRoot = dirname(dirname(extractedSkillDir));
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }

  await writeSkillVersion(canonicalPath, version);

  // Wire harness symlinks for everything detected (or the explicit override).
  const targetHarnesses = options.harnesses ?? detectHarnesses(env);
  const symlinks: InstallResult['symlinks'] = [];
  for (const slug of targetHarnesses) {
    const harness = harnessFor(slug);
    const linkPath = harness.symlinkPath(scope, env, cwd);
    const mode = await linkOrCopy(canonicalPath, linkPath);
    symlinks.push({ harness: slug, path: linkPath, mode });
  }

  return { canonicalPath, version, symlinks };
}

export async function uninstallSkill(
  scope: InstallScope,
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
  } = {},
): Promise<{ canonicalPath: string; removedSymlinks: string[] }> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const canonicalPath = getCanonicalSkillDir(scope, cwd);

  const removed: string[] = [];
  for (const harness of HARNESSES) {
    const linkPath = harness.symlinkPath(scope, env, cwd);
    if (await linkPointsTo(linkPath, canonicalPath)) {
      await rm(linkPath, { recursive: true, force: true });
      removed.push(linkPath);
    }
  }
  await rm(canonicalPath, { recursive: true, force: true });
  return { canonicalPath, removedSymlinks: removed };
}

/* -- symlink + tarball internals ------------------------------------------ */

/**
 * Download the marmot tarball, extract to a tempdir, return the path to the
 * extracted `skills/marmot/` directory inside it. Caller is responsible for
 * eventually cleaning up the tempdir parent.
 */
export async function downloadAndExtractSkill(
  sha: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchFn(tarballUrlForSha(sha), {
      headers: { accept: 'application/octet-stream', 'user-agent': 'marmot-cli' },
    });
  } catch (error) {
    // The most common cause is no network. Make the message actionable
    // rather than dumping the raw fetch failure.
    const cause =
      error instanceof Error && error.message ? `: ${error.message}` : '';
    throw new AICliError(
      'network',
      `Could not reach GitHub to fetch the marmot skill${cause}. Check your internet connection and try again.`,
      { cause: error },
    );
  }
  if (!response.ok || !response.body) {
    throw new AICliError(
      'provider',
      `GitHub tarball fetch failed with status ${response.status}. Try again later, or report at https://github.com/marmot-sh/marmot/issues.`,
    );
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), 'marmot-skill-'));
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xz', '--strip-components=1', '-C', tmpRoot], {
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    // Distinguish "tar missing" (ENOENT spawning the binary) from "tar
    // failed to run". Useful on minimal containers that might lack tar.
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(new AICliError(
          'io',
          'The "tar" command is not available on this system. Install tar (it ships with macOS, Linux, and Git Bash on Windows) and retry.',
          { cause: err },
        ));
      } else {
        reject(toAICliError(err, 'io', `Failed to invoke tar: ${err.message}`));
      }
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new AICliError(
        'provider',
        `tar exited with code ${code} while extracting the marmot skill tarball.`,
      ));
    });
    // Pump the response body into tar's stdin.
    const reader = response.body!.getReader();
    const pump = async (): Promise<void> => {
      const { done, value } = await reader.read();
      if (done) {
        child.stdin!.end();
        return;
      }
      child.stdin!.write(value);
      return pump();
    };
    pump().catch((err) => {
      child.kill();
      reject(toAICliError(err, 'network', 'Streaming the tarball into tar failed mid-flight.'));
    });
  });

  const extracted = join(tmpRoot, SKILL_REPO_PATH);
  if (!existsSync(extracted)) {
    throw new AICliError(
      'provider',
      `Tarball did not contain the expected ${SKILL_REPO_PATH} subtree. The marmot repo layout may have changed; please update the CLI or report at https://github.com/marmot-sh/marmot/issues.`,
    );
  }
  return extracted;
}

/**
 * Create a symlink from `linkPath` → `target`. On Windows or on permission
 * failure, falls back to a recursive copy. Returns which mode was used.
 */
export async function linkOrCopy(
  target: string,
  linkPath: string,
): Promise<'symlink' | 'copy'> {
  await mkdir(dirname(linkPath), { recursive: true, mode: 0o700 });

  // If the destination exists, remove it. linkPointsTo could be true only when
  // it's already pointing where we want, in which case the cleanup below is
  // technically unnecessary but harmless.
  if (existsSync(linkPath)) {
    await rm(linkPath, { recursive: true, force: true });
  }

  try {
    await symlink(target, linkPath, 'dir');
    return 'symlink';
  } catch {
    // Fallback: copy the directory tree.
    await cp(target, linkPath, { recursive: true });
    return 'copy';
  }
}

/**
 * True when `linkPath` exists AND resolves to `expectedTarget` (via symlink
 * or via copied content rooted at the same canonical dir).
 */
export async function linkPointsTo(
  linkPath: string,
  expectedTarget: string,
): Promise<boolean> {
  if (!existsSync(linkPath)) return false;
  try {
    const stats = await lstat(linkPath);
    if (stats.isSymbolicLink()) {
      const resolved = await readlink(linkPath);
      // readlink returns absolute or relative; treat both.
      return resolved === expectedTarget || join(dirname(linkPath), resolved) === expectedTarget;
    }
    // Not a symlink: treat as a copy that we own iff the version file matches.
    const localVersion = await readSkillVersion(expectedTarget).catch(() => undefined);
    const linkedVersion = await readSkillVersion(linkPath).catch(() => undefined);
    return Boolean(localVersion) && localVersion === linkedVersion;
  } catch {
    return false;
  }
}

// Re-export so tests can use copyFile etc. without re-importing.
export { copyFile };
