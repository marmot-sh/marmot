import { describe, expect, it } from 'vitest';

import {
  detectImagePreviewProtocol,
  emitImagePreview,
} from '../src/output/image-preview.js';

describe('detectImagePreviewProtocol', () => {
  it('returns kitty when KITTY_WINDOW_ID is set', () => {
    expect(detectImagePreviewProtocol({ KITTY_WINDOW_ID: '1' })).toBe('kitty');
  });

  it('returns kitty for Ghostty', () => {
    expect(detectImagePreviewProtocol({ TERM: 'xterm-ghostty' })).toBe('kitty');
    expect(
      detectImagePreviewProtocol({ GHOSTTY_RESOURCES_DIR: '/usr/local/Ghostty.app/Contents/Resources' }),
    ).toBe('kitty');
  });

  it('returns kitty for WezTerm', () => {
    expect(detectImagePreviewProtocol({ TERM_PROGRAM: 'WezTerm' })).toBe('kitty');
  });

  it('returns iterm for iTerm2', () => {
    expect(detectImagePreviewProtocol({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm');
    expect(detectImagePreviewProtocol({ LC_TERMINAL: 'iTerm2' })).toBe('iterm');
  });

  it('returns iterm for Warp', () => {
    expect(detectImagePreviewProtocol({ TERM_PROGRAM: 'WarpTerminal' })).toBe('iterm');
  });

  it('returns none for plain xterm or ssh sessions', () => {
    expect(detectImagePreviewProtocol({ TERM: 'xterm-256color' })).toBe('none');
    expect(detectImagePreviewProtocol({})).toBe('none');
  });
});

describe('emitImagePreview', () => {
  it('no-ops when protocol is none', () => {
    const chunks: string[] = [];
    emitImagePreview(new Uint8Array([1, 2, 3]), 'none', {
      write(c) {
        chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
        return true;
      },
    });
    expect(chunks).toEqual([]);
  });

  it('writes a kitty escape sequence', () => {
    const chunks: string[] = [];
    emitImagePreview(new Uint8Array([1, 2, 3]), 'kitty', {
      write(c) {
        chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
        return true;
      },
    });
    const output = chunks.join('');
    expect(output).toContain('\x1b_G');
    expect(output).toContain('f=100');
    expect(output).toContain('a=T');
    expect(output).toMatch(/\x1b\\$/m); // ends a graphics packet with ST
  });

  it('chunks large kitty payloads with m=1 then m=0', () => {
    const big = new Uint8Array(8192).fill(0xff);
    const chunks: string[] = [];
    emitImagePreview(big, 'kitty', {
      write(c) {
        chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
        return true;
      },
    });
    const out = chunks.join('');
    expect(out).toMatch(/m=1/);
    expect(out).toMatch(/m=0/);
  });

  it('writes an iTerm2 inline image escape sequence', () => {
    const chunks: string[] = [];
    emitImagePreview(new Uint8Array([1, 2, 3]), 'iterm', {
      write(c) {
        chunks.push(typeof c === 'string' ? c : Buffer.from(c).toString('utf8'));
        return true;
      },
    });
    const output = chunks.join('');
    expect(output).toContain('\x1b]1337;File=inline=1');
    expect(output).toMatch(/\x07\n$/); // BEL terminator + trailing newline
  });
});
