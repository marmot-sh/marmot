import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  detectHarnesses,
  fetchLatestSkillSha,
  findProjectRoot,
  getCanonicalSkillDir,
  harnessFor,
  installSkill,
  linkOrCopy,
  linkPointsTo,
  listKnownHarnesses,
  readSkillState,
  readSkillVersion,
  uninstallSkill,
  writeSkillVersion,
} from '../src/lib/skill.js';

const tempDirs: string[] = [];

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'marmot-skill-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.map((d) => rm(d, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

/**
 * Build a fake "extracted skill" directory at <root>/skills/marmot/ with one
 * SKILL.md file. installSkill's extractOverride returns this path so we don't
 * touch the real network.
 */
async function buildFakeExtracted(root: string): Promise<string> {
  const skillDir = join(root, 'skills', 'marmot');
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '# marmot skill\n');
  await mkdir(join(skillDir, 'references'), { recursive: true });
  await writeFile(join(skillDir, 'references', 'ai.md'), '# ai\n');
  return skillDir;
}

describe('getCanonicalSkillDir', () => {
  it('global → ~/.agents/skills/marmot', () => {
    const path = getCanonicalSkillDir('global');
    expect(path).toMatch(/[/\\]\.agents[/\\]skills[/\\]marmot$/);
  });

  it('project → <cwd>/.agents/skills/marmot', () => {
    const cwd = '/tmp/my-project';
    expect(getCanonicalSkillDir('project', cwd)).toBe(
      '/tmp/my-project/.agents/skills/marmot',
    );
  });
});

describe('detectHarnesses', () => {
  it('detects claude-code via CLAUDE_CONFIG_DIR override pointing at an existing dir', async () => {
    const dir = await fixture();
    const claudeDir = join(dir, 'custom-claude');
    await mkdir(claudeDir, { recursive: true });
    const env = { CLAUDE_CONFIG_DIR: claudeDir } as NodeJS.ProcessEnv;
    expect(detectHarnesses(env)).toContain('claude-code');
  });

  it('does NOT detect claude-code when override points at a missing dir', async () => {
    const dir = await fixture();
    const env = { CLAUDE_CONFIG_DIR: join(dir, 'no-such') } as NodeJS.ProcessEnv;
    expect(detectHarnesses(env)).not.toContain('claude-code');
  });

  it('detects codex via CODEX_HOME override pointing at an existing dir', async () => {
    const dir = await fixture();
    const codexDir = join(dir, 'custom-codex');
    await mkdir(codexDir, { recursive: true });
    const env = { CODEX_HOME: codexDir } as NodeJS.ProcessEnv;
    expect(detectHarnesses(env)).toContain('codex');
  });
});

describe('listKnownHarnesses / harnessFor', () => {
  it('exposes claude-code, opencode, codex', () => {
    const slugs = listKnownHarnesses().map((h) => h.slug);
    expect(slugs).toEqual(expect.arrayContaining(['claude-code', 'opencode', 'codex']));
  });

  it('harnessFor throws on unknown slug', () => {
    expect(() => harnessFor('nonexistent' as never)).toThrow(/Unknown harness/);
  });
});

describe('readSkillVersion / writeSkillVersion', () => {
  it('round-trips a version string', async () => {
    const dir = await fixture();
    await writeSkillVersion(dir, 'abc123def');
    expect(await readSkillVersion(dir)).toBe('abc123def');
  });

  it('returns undefined when no version file exists', async () => {
    const dir = await fixture();
    expect(await readSkillVersion(dir)).toBeUndefined();
  });

  it('trims trailing whitespace', async () => {
    const dir = await fixture();
    await writeFile(join(dir, '.skill-version'), '  abc123  \n\n');
    expect(await readSkillVersion(dir)).toBe('abc123');
  });
});

describe('fetchLatestSkillSha', () => {
  it('returns the SHA of the first commit in the API response', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify([{ sha: 'deadbeef0123' }, { sha: 'older' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    expect(await fetchLatestSkillSha(fetchFn)).toBe('deadbeef0123');
  });

  it('throws when API returns non-2xx', async () => {
    const fetchFn = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchLatestSkillSha(fetchFn)).rejects.toThrow(/500/);
  });

  it('throws when API returns empty array', async () => {
    const fetchFn = (async () =>
      new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
    await expect(fetchLatestSkillSha(fetchFn)).rejects.toThrow(/no SHA/);
  });
});

describe('linkOrCopy', () => {
  it('creates a symlink when permissions allow', async () => {
    const root = await fixture();
    const target = join(root, 'src');
    const link = join(root, 'link');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'a.txt'), 'hi');

    const mode = await linkOrCopy(target, link);
    expect(mode).toBe('symlink');
    expect(await readFile(join(link, 'a.txt'), 'utf8')).toBe('hi');
  });

  it('replaces an existing destination', async () => {
    const root = await fixture();
    const target = join(root, 'src');
    const link = join(root, 'link');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'new.txt'), 'fresh');
    await mkdir(link, { recursive: true });
    await writeFile(join(link, 'stale.txt'), 'old');

    await linkOrCopy(target, link);
    expect(await readFile(join(link, 'new.txt'), 'utf8')).toBe('fresh');
  });
});

describe('linkPointsTo', () => {
  it('returns true when a symlink points to the expected target', async () => {
    const root = await fixture();
    const target = join(root, 'src');
    const link = join(root, 'link');
    await mkdir(target, { recursive: true });
    await linkOrCopy(target, link);
    expect(await linkPointsTo(link, target)).toBe(true);
  });

  it('returns false when the link does not exist', async () => {
    const root = await fixture();
    expect(await linkPointsTo(join(root, 'nope'), join(root, 'src'))).toBe(false);
  });

  it('returns false when a symlink points elsewhere', async () => {
    const root = await fixture();
    const target = join(root, 'real');
    const decoy = join(root, 'decoy');
    const link = join(root, 'link');
    await mkdir(target, { recursive: true });
    await mkdir(decoy, { recursive: true });
    await linkOrCopy(decoy, link);
    expect(await linkPointsTo(link, target)).toBe(false);
  });

  it('treats a copy with matching version as a link', async () => {
    const root = await fixture();
    const target = join(root, 'canonical');
    const copy = join(root, 'copy');
    await mkdir(target, { recursive: true });
    await mkdir(copy, { recursive: true });
    await writeSkillVersion(target, 'v1');
    await writeSkillVersion(copy, 'v1');
    expect(await linkPointsTo(copy, target)).toBe(true);
  });
});

describe('installSkill', () => {
  it('installs to the project canonical dir and stamps version', async () => {
    const cwd = await fixture();
    const extractRoot = await fixture();
    const fakeSkillDir = await buildFakeExtracted(extractRoot);

    const fetchFn = (async () =>
      new Response(JSON.stringify([{ sha: 'commit-sha-1' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const result = await installSkill('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
      harnesses: [],
      extractOverride: async () => fakeSkillDir,
    });

    const canonical = join(cwd, '.agents', 'skills', 'marmot');
    expect(result.canonicalPath).toBe(canonical);
    expect(result.version).toBe('commit-sha-1');
    expect(await readFile(join(canonical, 'SKILL.md'), 'utf8')).toMatch(/marmot skill/);
    expect(await readSkillVersion(canonical)).toBe('commit-sha-1');
  });

  it('creates harness symlinks for explicitly specified harnesses', async () => {
    const cwd = await fixture();
    const extractRoot = await fixture();
    const fakeSkillDir = await buildFakeExtracted(extractRoot);

    const fetchFn = (async () =>
      new Response(JSON.stringify([{ sha: 's1' }]), { status: 200 })) as unknown as typeof fetch;

    const result = await installSkill('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
      harnesses: ['claude-code'],
      extractOverride: async () => fakeSkillDir,
    });

    expect(result.symlinks).toHaveLength(1);
    expect(result.symlinks[0]!.harness).toBe('claude-code');
    expect(result.symlinks[0]!.path).toBe(
      join(cwd, '.claude', 'skills', 'marmot'),
    );
    expect(['symlink', 'copy']).toContain(result.symlinks[0]!.mode);
  });

  it('overwrites an existing canonical install', async () => {
    const cwd = await fixture();
    const extractRoot = await fixture();
    const fakeSkillDir = await buildFakeExtracted(extractRoot);
    const canonical = join(cwd, '.agents', 'skills', 'marmot');
    await mkdir(canonical, { recursive: true });
    await writeFile(join(canonical, 'OLD.md'), 'old content');

    const fetchFn = (async () =>
      new Response(JSON.stringify([{ sha: 'new-sha' }]), { status: 200 })) as unknown as typeof fetch;

    await installSkill('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
      harnesses: [],
      extractOverride: async () => fakeSkillDir,
    });

    // Old file should be gone; new one in place.
    await expect(readFile(join(canonical, 'OLD.md'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(canonical, 'SKILL.md'), 'utf8')).toMatch(/marmot skill/);
  });
});

describe('readSkillState', () => {
  it('reports not-installed when canonical dir is absent', async () => {
    const cwd = await fixture();
    const state = await readSkillState('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      skipRemote: true,
    });
    expect(state.installed).toBe(false);
    expect(state.canonicalPath).toBeUndefined();
  });

  it('reports installed + version after a fresh install', async () => {
    const cwd = await fixture();
    const extractRoot = await fixture();
    const fakeSkillDir = await buildFakeExtracted(extractRoot);
    const fetchFn = (async () =>
      new Response(JSON.stringify([{ sha: 'sha-1' }]), { status: 200 })) as unknown as typeof fetch;

    await installSkill('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
      harnesses: [],
      extractOverride: async () => fakeSkillDir,
    });

    const state = await readSkillState('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      skipRemote: true,
    });
    expect(state.installed).toBe(true);
    expect(state.localVersion).toBe('sha-1');
  });

  it('flags outdated when local and remote SHAs differ', async () => {
    const cwd = await fixture();
    const extractRoot = await fixture();
    const fakeSkillDir = await buildFakeExtracted(extractRoot);
    let fetchCalls = 0;
    const fetchFn = (async () => {
      fetchCalls += 1;
      // First call is the install version, second is the state check.
      const sha = fetchCalls === 1 ? 'old-sha' : 'new-sha';
      return new Response(JSON.stringify([{ sha }]), { status: 200 });
    }) as unknown as typeof fetch;

    await installSkill('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
      harnesses: [],
      extractOverride: async () => fakeSkillDir,
    });

    const state = await readSkillState('project', {
      env: {} as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
    });
    expect(state.installed).toBe(true);
    expect(state.localVersion).toBe('old-sha');
    expect(state.remoteVersion).toBe('new-sha');
    expect(state.outdated).toBe(true);
  });
});

describe('uninstallSkill', () => {
  it('removes the canonical dir and any harness symlinks', async () => {
    const cwd = await fixture();
    const claudeDir = await fixture();
    const extractRoot = await fixture();
    const fakeSkillDir = await buildFakeExtracted(extractRoot);
    const fetchFn = (async () =>
      new Response(JSON.stringify([{ sha: 's' }]), { status: 200 })) as unknown as typeof fetch;

    await installSkill('project', {
      env: { CLAUDE_CONFIG_DIR: claudeDir } as NodeJS.ProcessEnv,
      cwd,
      fetchFn,
      harnesses: ['claude-code'],
      extractOverride: async () => fakeSkillDir,
    });

    const linkPath = join(cwd, '.claude', 'skills', 'marmot');
    const canonical = join(cwd, '.agents', 'skills', 'marmot');
    expect(await readFile(join(canonical, 'SKILL.md'), 'utf8')).toMatch(/marmot/);
    expect(await readFile(join(linkPath, 'SKILL.md'), 'utf8')).toMatch(/marmot/);

    const result = await uninstallSkill('project', {
      env: { CLAUDE_CONFIG_DIR: claudeDir } as NodeJS.ProcessEnv,
      cwd,
    });

    expect(result.removedSymlinks).toContain(linkPath);
    await expect(readFile(join(canonical, 'SKILL.md'), 'utf8')).rejects.toThrow();
  });
});

describe('findProjectRoot', () => {
  it('returns the cwd when it has a marker dir', async () => {
    const dir = await fixture();
    await mkdir(join(dir, '.agents'), { recursive: true });
    expect(findProjectRoot(dir)).toBe(dir);
  });

  it('walks upward to find a marker on a parent', async () => {
    const root = await fixture();
    await mkdir(join(root, '.claude'), { recursive: true });
    const sub = join(root, 'apps', 'web');
    await mkdir(sub, { recursive: true });
    expect(findProjectRoot(sub)).toBe(root);
  });

  it('detects each of the four marker directories', async () => {
    for (const marker of ['.agents', '.claude', '.codex', '.opencode']) {
      const dir = await fixture();
      await mkdir(join(dir, marker), { recursive: true });
      expect(findProjectRoot(dir)).toBe(dir);
    }
  });

  it('returns null when no marker is found and the walk hits the filesystem root', async () => {
    // tmpdir is outside $HOME on most systems and unlikely to contain
    // any of the marker dirs at intermediate levels.
    const dir = await fixture();
    expect(findProjectRoot(dir)).toBe(null);
  });

  it('returns the deepest marker-bearing ancestor (does not skip closer markers)', async () => {
    const outer = await fixture();
    await mkdir(join(outer, '.agents'), { recursive: true });
    const inner = join(outer, 'inner-project');
    await mkdir(join(inner, '.claude'), { recursive: true });
    const sub = join(inner, 'src');
    await mkdir(sub, { recursive: true });
    // Walk from sub finds inner first (closer ancestor with marker),
    // not outer.
    expect(findProjectRoot(sub)).toBe(inner);
  });
});
