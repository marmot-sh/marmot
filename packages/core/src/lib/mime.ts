import { extname } from 'node:path';

const EXT_TO_MIME: Record<string, string> = {
  // images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  // documents
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  // audio (used by transcribe)
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
};

export function mimeFromExtension(path: string): string | undefined {
  const ext = extname(path).slice(1).toLowerCase();
  return EXT_TO_MIME[ext];
}

/**
 * Sniff the first few bytes for common image magic markers. Returns undefined
 * if no match — callers can fall back to extension detection or a default.
 */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 4) return undefined;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF87a / GIF89a: 47 49 46 38
  if (
    bytes[0] === 0x47
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x38
  ) {
    return 'image/gif';
  }

  // WEBP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return undefined;
}

/**
 * Sniff PDF magic: "%PDF-".
 */
export function sniffPdfMime(bytes: Uint8Array): string | undefined {
  if (bytes.length < 5) return undefined;
  if (
    bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  return undefined;
}
