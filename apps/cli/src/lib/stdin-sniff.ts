// Detect whether stdin holds binary content (image/audio/video/PDF) or
// text, based on the first few bytes. The receiving end of a pipe needs
// to know what was sent so it can attach binary payloads to the model
// correctly instead of base64-encoding them as a multi-megabyte text
// prompt -- the failure mode the user hit when running
//
//   marmot image "boat" | marmot "what is this?" --model X
//
// without an explicit `--image -` sentinel.
//
// Magic-number based, no heuristics. False positives are essentially
// impossible: a valid UTF-8 text file will never start with the byte
// sequences below.

import { Buffer } from 'node:buffer';

import { AICliError, type StdinReader } from '@marmot-sh/core';

export type StdinKind =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; bytes: Uint8Array }
  | { kind: 'audio'; mimeType: string; bytes: Uint8Array }
  | { kind: 'video'; mimeType: string; bytes: Uint8Array }
  | { kind: 'file'; mimeType: string; bytes: Uint8Array };

/** Read all of stdin as bytes, then classify. Returns `{ kind: 'empty' }`
 *  for a TTY (no pipe) or zero-byte stream so callers can treat "no
 *  input" as a no-op rather than an error.
 *
 *  When `forceText` is true the bytes are returned as `{ kind: 'text' }`
 *  regardless of magic; this is the escape hatch for users who really
 *  do want to send binary as text. */
export async function sniffStdin(
  stdin: StdinReader,
  forceText = false,
): Promise<StdinKind> {
  if (stdin.isTTY) return { kind: 'empty' };

  const bytes = await readStdinBytes(stdin);
  if (!bytes || bytes.length === 0) return { kind: 'empty' };

  if (forceText) return { kind: 'text', text: bytes.toString('utf8') };

  const detected = detectFromMagic(bytes);
  if (detected) {
    return {
      kind: detected.kind,
      mimeType: detected.mimeType,
      bytes: new Uint8Array(bytes),
    };
  }

  return { kind: 'text', text: bytes.toString('utf8') };
}

/** Read stdin as raw bytes. The default `readStdin` decodes as UTF-8,
 *  which silently corrupts binary input (lone bytes that aren't valid
 *  UTF-8 become U+FFFD). We need the literal bytes.
 *
 *  Returns `null` for a TTY (no pipe) or zero-byte stream. Exported so
 *  the explicit-sentinel path (`--image -` / `--file -`) can read raw
 *  bytes without invoking the magic-number sniffer. */
export async function readStdinAsBytes(
  stdin: StdinReader,
): Promise<Uint8Array | null> {
  if (stdin.isTTY) return null;
  const buf = await readStdinBytes(stdin);
  return buf ? new Uint8Array(buf) : null;
}

async function readStdinBytes(stdin: StdinReader): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    // Intentionally do NOT call setEncoding -- we want raw Buffer chunks.
    stdin.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
    });
    stdin.on('end', () => {
      resolve(chunks.length === 0 ? null : Buffer.concat(chunks));
    });
    stdin.on('error', (error) => {
      reject(
        new AICliError('io', 'Failed to read input from stdin.', { cause: error }),
      );
    });
  });
}

type DetectedKind = {
  kind: 'image' | 'audio' | 'video' | 'file';
  mimeType: string;
};

/** Magic-number detection. Order matters for prefixes that overlap
 *  (RIFF wraps both WAV and WebP and AVI). */
function detectFromMagic(b: Buffer): DetectedKind | null {
  if (b.length < 4) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { kind: 'image', mimeType: 'image/png' };
  }

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { kind: 'image', mimeType: 'image/jpeg' };
  }

  // GIF: "GIF87a" or "GIF89a"
  if (b.length >= 6 && b.toString('ascii', 0, 6).match(/^GIF8[79]a$/)) {
    return { kind: 'image', mimeType: 'image/gif' };
  }

  // RIFF wrapper -- inspect the inner type at offset 8.
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF') {
    const inner = b.toString('ascii', 8, 12);
    if (inner === 'WEBP') return { kind: 'image', mimeType: 'image/webp' };
    if (inner === 'WAVE') return { kind: 'audio', mimeType: 'audio/wav' };
    if (inner === 'AVI ') return { kind: 'video', mimeType: 'video/x-msvideo' };
  }

  // PDF: "%PDF-"
  if (b.length >= 5 && b.toString('ascii', 0, 5) === '%PDF-') {
    return { kind: 'file', mimeType: 'application/pdf' };
  }

  // MP4 / M4A / MOV: "ftyp" box at offset 4.
  if (b.length >= 12 && b.toString('ascii', 4, 8) === 'ftyp') {
    const brand = b.toString('ascii', 8, 12);
    // Audio brands: M4A , M4B , M4P
    if (brand.startsWith('M4A') || brand.startsWith('M4B') || brand.startsWith('M4P')) {
      return { kind: 'audio', mimeType: 'audio/mp4' };
    }
    // QuickTime
    if (brand === 'qt  ') {
      return { kind: 'video', mimeType: 'video/quicktime' };
    }
    // Everything else under ftyp is treated as MP4 video (isom, mp42, avc1, ...)
    return { kind: 'video', mimeType: 'video/mp4' };
  }

  // MP3 frame sync: FF Fx (where x has top bits set), or ID3 tag prefix
  if (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) {
    return { kind: 'audio', mimeType: 'audio/mpeg' };
  }
  if (b.length >= 3 && b.toString('ascii', 0, 3) === 'ID3') {
    return { kind: 'audio', mimeType: 'audio/mpeg' };
  }

  // OGG: "OggS"
  if (b.toString('ascii', 0, 4) === 'OggS') {
    return { kind: 'audio', mimeType: 'audio/ogg' };
  }

  // FLAC: "fLaC"
  if (b.toString('ascii', 0, 4) === 'fLaC') {
    return { kind: 'audio', mimeType: 'audio/flac' };
  }

  return null;
}
