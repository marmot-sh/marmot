import type { Writable } from 'node:stream';

import yoctoSpinner, { type Spinner } from 'yocto-spinner';

import { brandText } from './brand.js';

// Default braille frames (yocto-spinner ships these). We pre-wrap each one
// in a truecolor brand-orange ANSI escape via brandText() so the frame
// renders in the marmot brand color instead of yocto-spinner's default
// cyan. yocto-spinner's outer named-color wrapper (cyan) still gets
// appended, but the inner truecolor escape overrides it character-by-
// character. ASCII fallback for non-unicode terminals retains the
// original yocto frames.
const BRAND_BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;
const BRAND_ASCII_FRAMES = ['-', '\\', '|', '/'] as const;

function buildBrandSpinnerFrames(env: NodeJS.ProcessEnv): string[] {
  const supportsUnicode =
    process.platform !== 'win32' ||
    Boolean(env.WT_SESSION) ||
    env.TERM_PROGRAM === 'vscode';
  const source = supportsUnicode ? BRAND_BRAILLE_FRAMES : BRAND_ASCII_FRAMES;
  return source.map((frame) => brandText(frame, { env }));
}

export type StatusStream = {
  isTTY?: boolean;
  write(chunk: string | Uint8Array): boolean;
  cursorTo?: NodeJS.WriteStream['cursorTo'];
  clearLine?: NodeJS.WriteStream['clearLine'];
  moveCursor?: NodeJS.WriteStream['moveCursor'];
};

type StatusOptions = {
  stream?: StatusStream;
  env?: NodeJS.ProcessEnv;
};

type WithSpinnerOptions = StatusOptions & {
  succeedText?: string;
  failText?: string;
  /** Override the elapsed-time threshold (ms). Default 1000. */
  elapsedThresholdMs?: number;
  /** Override the elapsed-time tick interval (ms). Default 1000. */
  elapsedTickMs?: number;
};

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${s.toString().padStart(2, '0')}s`;
}

function isQuiet(stream: StatusStream, env: NodeJS.ProcessEnv): boolean {
  if (env.NO_COLOR) return true;
  if (env.CI) return true;
  return !stream.isTTY;
}

function canRenderSpinner(stream: StatusStream): boolean {
  // The spinner needs cursor manipulation. Bail out for non-terminal streams.
  const candidate = stream as unknown as Record<string, unknown>;
  return typeof candidate.cursorTo === 'function'
    && typeof candidate.clearLine === 'function'
    && typeof candidate.moveCursor === 'function';
}

function writeLine(stream: StatusStream, text: string): void {
  stream.write(`${text}\n`);
}

export function writeStatus(text: string, options: StatusOptions = {}): void {
  const stream = options.stream ?? process.stderr;
  const env = options.env ?? process.env;
  if (isQuiet(stream, env)) return;
  writeLine(stream, text);
}

export function info(text: string, options: StatusOptions = {}): void {
  writeStatus(`ℹ ${text}`, options);
}

export function succeed(text: string, options: StatusOptions = {}): void {
  writeStatus(`✓ ${text}`, options);
}

export function fail(text: string, options: StatusOptions = {}): void {
  writeStatus(`✗ ${text}`, options);
}

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  options: WithSpinnerOptions = {},
): Promise<T> {
  const stream = options.stream ?? process.stderr;
  const env = options.env ?? process.env;

  if (isQuiet(stream, env) || !canRenderSpinner(stream)) {
    // Quiet or non-terminal stream — run the work but emit a single
    // status line (suppressed when isQuiet) and skip the spinner.
    if (!isQuiet(stream, env)) {
      writeLine(stream, text);
    }
    try {
      const result = await fn();
      if (options.succeedText && !isQuiet(stream, env)) {
        writeLine(stream, `✓ ${options.succeedText}`);
      }
      return result;
    } catch (error) {
      if (options.failText && !isQuiet(stream, env)) {
        writeLine(stream, `✗ ${options.failText}`);
      }
      throw error;
    }
  }

  const spinner: Spinner = yoctoSpinner({
    text,
    stream: stream as unknown as Writable,
    spinner: {
      frames: buildBrandSpinnerFrames(env),
      interval: 80,
    },
  }).start();

  // After a short grace period, append elapsed time to the spinner label and
  // tick it forward so users know long-running calls are still alive.
  const startedAt = Date.now();
  const thresholdMs = options.elapsedThresholdMs ?? 1000;
  const tickMs = options.elapsedTickMs ?? 1000;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  const startElapsed = setTimeout(() => {
    const tick = () => {
      spinner.text = `${text} ${formatElapsed(Date.now() - startedAt)}`;
    };
    tick();
    elapsedTimer = setInterval(tick, tickMs);
    if (typeof elapsedTimer.unref === 'function') elapsedTimer.unref();
  }, thresholdMs);
  if (typeof startElapsed.unref === 'function') startElapsed.unref();

  const stopElapsed = () => {
    clearTimeout(startElapsed);
    if (elapsedTimer) clearInterval(elapsedTimer);
  };

  try {
    const result = await fn();
    stopElapsed();
    if (options.succeedText) {
      spinner.success(options.succeedText);
    } else {
      spinner.stop();
    }
    return result;
  } catch (error) {
    stopElapsed();
    if (options.failText) {
      spinner.error(options.failText);
    } else {
      spinner.stop();
    }
    throw error;
  }
}
