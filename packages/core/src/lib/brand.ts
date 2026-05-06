// Brand color — single source of truth.
//
// Two representations because we render in two contexts:
//   - CSS (web app, MDX): use `oklch` for perceptually-uniform output.
//   - Terminal (clack/chalk banners, text accents): use `hex` since most
//     terminal libs need a hex/rgb input. The hex is the closest sRGB
//     equivalent of the OKLCH value; it's not pixel-perfect (OKLCH and sRGB
//     have different gamuts) but lands in the same orange-terracotta family
//     that the brand reads as.
//
// Change the values here once and every consumer updates.

export const BRAND_COLOR = {
  /** Use in CSS: inline styles, tailwind arbitrary values, MDX, etc. */
  oklch: 'oklch(64.6% 0.222 41.116)',
  /** Use in terminal contexts (truecolor 24-bit). */
  hex: '#D96437',
} as const;

export type BrandColor = typeof BRAND_COLOR;

function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace(/^#/, '');
  return [
    parseInt(cleaned.slice(0, 2), 16),
    parseInt(cleaned.slice(2, 4), 16),
    parseInt(cleaned.slice(4, 6), 16),
  ];
}

/**
 * Returns true when the terminal is known to handle 24-bit color. Errs on
 * the side of "yes" for the common dev-machine terminals; everything else
 * falls back to ANSI 256.
 */
function supportsTruecolor(env: NodeJS.ProcessEnv = process.env): boolean {
  const colorterm = env.COLORTERM ?? '';
  if (colorterm === 'truecolor' || colorterm === '24bit') return true;
  const term = env.TERM ?? '';
  if (term.includes('truecolor') || term.includes('24bit')) return true;
  const program = env.TERM_PROGRAM ?? '';
  if (program === 'iTerm.app') return true;
  if (program === 'WezTerm') return true;
  if (program === 'ghostty') return true;
  if (program === 'vscode') return true;
  if (env.KITTY_WINDOW_ID) return true;
  return false;
}

/**
 * Wrap text in a brand-colored ANSI escape. Truecolor on supported
 * terminals, ANSI-256 orange (`38;5;208`) elsewhere. Optional `bold` flag
 * adds the SGR bold wrapper. Pass `env` for testability.
 */
export function brandText(
  text: string,
  opts?: { bold?: boolean; env?: NodeJS.ProcessEnv },
): string {
  const env = opts?.env ?? process.env;
  const bold = opts?.bold ? '\x1b[1m' : '';
  const reset = '\x1b[0m';
  if (supportsTruecolor(env)) {
    const [r, g, b] = hexToRgb(BRAND_COLOR.hex);
    return `${bold}\x1b[38;2;${r};${g};${b}m${text}${reset}`;
  }
  return `${bold}\x1b[38;5;208m${text}${reset}`;
}

/**
 * Wrap text in a warning-yellow ANSI escape. Used to highlight states like
 * "no default" or "not set" that the user might want to change. Standard
 * ANSI yellow (`33`) — works on every terminal, no truecolor needed.
 */
export function warnText(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

/**
 * Wrap text in a success-green ANSI escape. Used to flag positive states
 * like "installed" / "ready" in setup status output. Standard ANSI green
 * (`32`) — works on every terminal, no truecolor needed.
 */
export function successText(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}
