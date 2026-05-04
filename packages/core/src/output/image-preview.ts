/* Inline image preview for image-capable terminals.
 *
 * Two protocols supported:
 *   - kitty:  Kitty graphics protocol (Kitty, Ghostty, WezTerm).
 *   - iterm:  iTerm2 inline image protocol (iTerm2, WezTerm, Warp).
 *
 * Detection is conservative: env-driven, no terminal probing. If we cannot
 * positively identify the terminal, we return 'none' and the caller falls
 * back to printing the file path only.
 */

export type ImagePreviewProtocol = 'kitty' | 'iterm' | 'none';

export type ImagePreviewWriter = {
  write(chunk: Uint8Array | string): unknown;
  isTTY?: boolean;
};

export function detectImagePreviewProtocol(
  env: NodeJS.ProcessEnv = process.env,
): ImagePreviewProtocol {
  const term = env.TERM ?? '';
  const program = env.TERM_PROGRAM ?? '';

  // Kitty graphics: Kitty, Ghostty, WezTerm (also speaks Kitty).
  if (env.KITTY_WINDOW_ID) return 'kitty';
  if (term.includes('kitty')) return 'kitty';
  if (term.includes('ghostty')) return 'kitty';
  if (env.GHOSTTY_RESOURCES_DIR) return 'kitty';
  if (program === 'WezTerm') return 'kitty';

  // iTerm2 inline images: iTerm2, Warp.
  if (program === 'iTerm.app') return 'iterm';
  if (program === 'WarpTerminal') return 'iterm';
  if (env.LC_TERMINAL === 'iTerm2') return 'iterm';

  return 'none';
}

export function emitImagePreview(
  bytes: Uint8Array,
  protocol: ImagePreviewProtocol,
  stream: ImagePreviewWriter,
): void {
  if (protocol === 'none') return;
  const b64 = bufferToBase64(bytes);
  if (protocol === 'kitty') {
    writeKittyImage(b64, stream);
  } else if (protocol === 'iterm') {
    writeITermImage(b64, stream);
  }
}

const KITTY_CHUNK = 4096;

function writeKittyImage(b64: string, stream: ImagePreviewWriter): void {
  // a=T (transmit + display), f=100 (PNG; we tolerate JPEG too — Kitty
  // accepts arbitrary image formats with f=100 by sniffing). m=1 for
  // intermediate chunks, m=0 for the final chunk.
  let offset = 0;
  let first = true;
  while (offset < b64.length) {
    const end = Math.min(offset + KITTY_CHUNK, b64.length);
    const chunk = b64.slice(offset, end);
    const isLast = end >= b64.length;
    const m = isLast ? 0 : 1;
    const ctrl = first ? `f=100,a=T,m=${m}` : `m=${m}`;
    stream.write(`\x1b_G${ctrl};${chunk}\x1b\\`);
    offset = end;
    first = false;
  }
  stream.write('\n');
}

function writeITermImage(b64: string, stream: ImagePreviewWriter): void {
  stream.write(
    `\x1b]1337;File=inline=1;width=auto;height=auto;preserveAspectRatio=1:${b64}\x07\n`,
  );
}

function bufferToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
