import { describe, expect, it } from 'vitest';

import {
  mimeFromExtension,
  sniffImageMime,
  sniffPdfMime,
} from '../src/lib/mime.js';

describe('mimeFromExtension', () => {
  it('returns image mimes', () => {
    expect(mimeFromExtension('foo.png')).toBe('image/png');
    expect(mimeFromExtension('a/b/c.jpg')).toBe('image/jpeg');
    expect(mimeFromExtension('photo.jpeg')).toBe('image/jpeg');
    expect(mimeFromExtension('clip.webp')).toBe('image/webp');
  });

  it('returns pdf mime', () => {
    expect(mimeFromExtension('contract.pdf')).toBe('application/pdf');
  });

  it('returns audio mimes used by transcribe', () => {
    expect(mimeFromExtension('audio.mp3')).toBe('audio/mpeg');
    expect(mimeFromExtension('audio.wav')).toBe('audio/wav');
  });

  it('returns undefined for unknown extensions', () => {
    expect(mimeFromExtension('mystery.xyz')).toBeUndefined();
    expect(mimeFromExtension('noext')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    expect(mimeFromExtension('shouty.PNG')).toBe('image/png');
  });
});

describe('sniffImageMime', () => {
  it('detects PNG magic bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(sniffImageMime(png)).toBe('image/png');
  });

  it('detects JPEG magic bytes', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(sniffImageMime(jpeg)).toBe('image/jpeg');
  });

  it('detects GIF magic bytes', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00]);
    expect(sniffImageMime(gif)).toBe('image/gif');
  });

  it('detects WEBP magic bytes', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    expect(sniffImageMime(webp)).toBe('image/webp');
  });

  it('returns undefined for unknown bytes', () => {
    expect(sniffImageMime(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeUndefined();
  });

  it('returns undefined for too-short input', () => {
    expect(sniffImageMime(new Uint8Array([0x89]))).toBeUndefined();
  });
});

describe('sniffPdfMime', () => {
  it('detects %PDF- magic bytes', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(sniffPdfMime(pdf)).toBe('application/pdf');
  });

  it('returns undefined for non-PDF', () => {
    expect(sniffPdfMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBeUndefined();
  });
});
