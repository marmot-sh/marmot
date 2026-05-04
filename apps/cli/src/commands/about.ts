import ansis from 'ansis';

import { writeLine, type OutputWriter } from '@marmot-sh/core';
import { MARMOT_VERSION } from '../lib/version.js';

const M = [
  '███╗   ███╗',
  '████╗ ████║',
  '██╔████╔██║',
  '██║╚██╔╝██║',
  '██║ ╚═╝ ██║',
  '╚═╝     ╚═╝',
];

const A = [
  ' █████╗ ',
  '██╔══██╗',
  '███████║',
  '██╔══██║',
  '██║  ██║',
  '╚═╝  ╚═╝',
];

const R = [
  '██████╗ ',
  '██╔══██╗',
  '██████╔╝',
  '██╔══██╗',
  '██║  ██║',
  '╚═╝  ╚═╝',
];

const O = [
  ' ██████╗ ',
  '██╔═══██╗',
  '██║   ██║',
  '██║   ██║',
  '╚██████╔╝',
  ' ╚═════╝ ',
];

const T = [
  '████████╗',
  '╚══██╔══╝',
  '   ██║   ',
  '   ██║   ',
  '   ██║   ',
  '   ╚═╝   ',
];

const LETTERS = [M, A, R, M, O, T];

const BANNER_LINES = Array.from({ length: 6 }, (_, row) =>
  LETTERS.map((letter) => letter[row]).join(' '),
);

// Dark orange → lighter orange, top-to-bottom.
const GRADIENT_COLORS: readonly string[] = [
  '#B23A00', // dark burnt orange
  '#CC4A00',
  '#E55A00',
  '#FF7A1F',
  '#FF9647',
  '#FFB36E', // lighter peach-orange
];

const GRADIENT_FALLBACK = '#FF7A1F';

type AboutCommandDependencies = {
  stdout?: OutputWriter;
};

export function handleAboutCommand(
  dependencies: AboutCommandDependencies = {},
): void {
  const stdout = dependencies.stdout ?? process.stdout;

  stdout.write('\n');
  for (const [index, line] of BANNER_LINES.entries()) {
    const color = GRADIENT_COLORS[index] ?? GRADIENT_FALLBACK;
    stdout.write(`  ${ansis.hex(color)(line)}\n`);
  }
  stdout.write('\n');
  writeLine(stdout, ansis.dim('  Unified CLI for AI, search, and enrichment.'));
  writeLine(stdout, ansis.dim(`  v${MARMOT_VERSION} · marmot.sh`));
  stdout.write('\n');
}
