import { describe, expect, it } from 'vitest';

import { checkNodeVersion } from '../src/lib/node-version-check.js';

describe('checkNodeVersion', () => {
  it('passes on Node 20', () => {
    expect(
      checkNodeVersion({ versionString: '20.0.0', execPath: '/usr/bin/node' }),
    ).toEqual({ ok: true });
  });

  it('passes on Node 22', () => {
    expect(
      checkNodeVersion({ versionString: '22.10.0', execPath: '/usr/bin/node' }),
    ).toEqual({ ok: true });
  });

  it('passes on Node 25 (future)', () => {
    expect(
      checkNodeVersion({ versionString: '25.9.0', execPath: '/n/n' }),
    ).toEqual({ ok: true });
  });

  it('rejects Node 18 with the running version and exec path in the message', () => {
    const result = checkNodeVersion({
      versionString: '18.16.0',
      execPath: '/usr/local/bin/node',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('marmot requires Node >=20');
    expect(result.message).toContain('18.16.0');
    expect(result.message).toContain('/usr/local/bin/node');
    expect(result.message).toContain('PATH');
  });

  it('rejects Node 16', () => {
    const result = checkNodeVersion({
      versionString: '16.20.0',
      execPath: '/n',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects Node 14', () => {
    const result = checkNodeVersion({
      versionString: '14.21.3',
      execPath: '/n',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects an empty version string (parseInt NaN)', () => {
    const result = checkNodeVersion({
      versionString: '',
      execPath: '/n',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects garbage version strings', () => {
    const result = checkNodeVersion({
      versionString: 'not-a-version',
      execPath: '/n',
    });
    expect(result.ok).toBe(false);
  });

  it('handles pre-release suffixes like 20.0.0-rc1', () => {
    expect(
      checkNodeVersion({ versionString: '20.0.0-rc1', execPath: '/n' }),
    ).toEqual({ ok: true });
  });
});
