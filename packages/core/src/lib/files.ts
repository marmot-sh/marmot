import { createWriteStream, type WriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AICliError } from './errors.js';
import { resolveUserPath } from './paths.js';

export type StdinReader = {
  isTTY: boolean;
  setEncoding(encoding: 'utf8'): void;
  on(event: 'data', listener: (chunk: string | Buffer) => void): void;
  on(event: 'end', listener: () => void): void;
  on(event: 'error', listener: (error: Error) => void): void;
};

export async function readStdin(stdin: StdinReader = process.stdin): Promise<string | null> {
  if (stdin.isTTY) {
    return null;
  }

  return new Promise((resolve, reject) => {
    let buffer = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    stdin.on('end', () => resolve(buffer));
    stdin.on('error', (error) => {
      reject(
        new AICliError('io', 'Failed to read prompt from stdin.', { cause: error }),
      );
    });
  });
}

export async function readBinaryStdin(): Promise<Uint8Array | null> {
  if (process.stdin.isTTY) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return null;
  return new Uint8Array(Buffer.concat(chunks));
}

export async function readPromptFile(inputPath: string): Promise<{
  path: string;
  content: string;
}> {
  const resolvedPath = resolveUserPath(inputPath);

  try {
    const content = await readFile(resolvedPath, 'utf8');
    return { path: resolvedPath, content };
  } catch (error) {
    throw new AICliError(
      'io',
      `Failed to read prompt file "${resolvedPath}".`,
      { cause: error },
    );
  }
}

export async function writeOutputFile(
  inputPath: string,
  contents: string,
): Promise<string> {
  const resolvedPath = resolveUserPath(inputPath);

  try {
    await mkdir(dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, contents, 'utf8');
    return resolvedPath;
  } catch (error) {
    throw new AICliError(
      'io',
      `Failed to write output file "${resolvedPath}".`,
      { cause: error },
    );
  }
}

export async function openOutputFileStream(inputPath: string): Promise<{
  path: string;
  stream: WriteStream;
  close: () => Promise<void>;
}> {
  const resolvedPath = resolveUserPath(inputPath);

  try {
    await mkdir(dirname(resolvedPath), { recursive: true });
    const stream = createWriteStream(resolvedPath, {
      encoding: 'utf8',
    });
    return {
      path: resolvedPath,
      stream,
      close: () => new Promise((resolve, reject) => {
        stream.once('error', reject);
        stream.end(() => resolve());
      }),
    };
  } catch (error) {
    throw new AICliError(
      'io',
      `Failed to open output file "${resolvedPath}" for streaming.`,
      { cause: error },
    );
  }
}
