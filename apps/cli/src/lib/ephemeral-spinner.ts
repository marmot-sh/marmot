// Tiny dot-spinner that erases itself on stop.
//
// Clack's `spinner()` leaves a `◇  Detection complete` line behind once
// stopped, which is right for a wizard transcript but wrong for a hub
// screen we re-render. This one writes to stderr, hides the cursor while
// spinning, and clears the line on stop so the hub render starts clean.

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export type EphemeralSpinner = {
  start(message: string): void;
  stop(): void;
};

export function createEphemeralSpinner(
  stream: NodeJS.WriteStream = process.stderr,
): EphemeralSpinner {
  let interval: NodeJS.Timeout | null = null;
  let frame = 0;
  let message = '';
  const tty = stream.isTTY === true;

  const render = (): void => {
    stream.write(`\r${FRAMES[frame]} ${message}\x1b[K`);
    frame = (frame + 1) % FRAMES.length;
  };

  return {
    start(msg) {
      message = msg;
      if (!tty) {
        stream.write(`${msg}…\n`);
        return;
      }
      stream.write('\x1b[?25l');
      render();
      interval = setInterval(render, 80);
    },
    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (tty) stream.write('\r\x1b[K\x1b[?25h');
    },
  };
}
