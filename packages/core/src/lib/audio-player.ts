import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import { AICliError } from './errors.js';

type PlayerCandidate = {
  command: string;
  args: (audioPath: string) => string[];
};

const MAC_PLAYERS: PlayerCandidate[] = [
  { command: 'afplay', args: (p) => [p] },
];

const LINUX_PLAYERS: PlayerCandidate[] = [
  { command: 'ffplay', args: (p) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', p] },
  { command: 'mpg123', args: (p) => ['-q', p] },
  { command: 'mpv', args: (p) => ['--no-video', '--really-quiet', p] },
  { command: 'paplay', args: (p) => [p] },
];

const WINDOWS_PLAYERS: PlayerCandidate[] = [
  { command: 'ffplay', args: (p) => ['-nodisp', '-autoexit', '-loglevel', 'quiet', p] },
  { command: 'mpg123', args: (p) => ['-q', p] },
];

function candidatesForPlatform(): PlayerCandidate[] {
  const p = platform();
  if (p === 'darwin') return MAC_PLAYERS;
  if (p === 'win32') return WINDOWS_PLAYERS;
  return LINUX_PLAYERS;
}

async function findPlayer(): Promise<PlayerCandidate | null> {
  for (const candidate of candidatesForPlatform()) {
    const exists = await new Promise<boolean>((resolve) => {
      const child = spawn('which', [candidate.command], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
    });
    if (exists) return candidate;
  }
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export type PlayAudioOptions = {
  /** Detach from the parent process; return immediately. Default: false (await playback). */
  background?: boolean;
  /** Optional path to delete after playback finishes (only meaningful with background=true). */
  cleanupAfter?: string;
};

export async function playAudioFile(
  audioPath: string,
  options: PlayAudioOptions = {},
): Promise<void> {
  const player = await findPlayer();
  if (!player) {
    const tried = candidatesForPlatform().map((c) => c.command).join(', ');
    throw new AICliError(
      'io',
      `No audio player found. Tried: ${tried}. Install one (e.g. ffplay or mpg123) or save the file with -o.`,
    );
  }

  if (options.background) {
    // Detached: spawn through sh so we can chain `player file && rm file`
    // for ephemeral cleanup. unref() lets the parent exit while the child
    // continues running independently.
    const argString = player.args(audioPath).map(shellQuote).join(' ');
    const cleanup = options.cleanupAfter
      ? `; rm -f ${shellQuote(options.cleanupAfter)}`
      : '';
    const child = spawn('sh', ['-c', `${player.command} ${argString}${cleanup}`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  // Foreground: wait for playback to finish.
  await new Promise<void>((resolve, reject) => {
    const child = spawn(player.command, player.args(audioPath), {
      stdio: 'ignore',
    });
    child.on('error', (error) => {
      reject(
        new AICliError(
          'io',
          `Audio player "${player.command}" failed: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new AICliError('io', `${player.command} exited with code ${code ?? 'null'}.`));
    });
  });
}
