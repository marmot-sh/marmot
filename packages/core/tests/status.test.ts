import { describe, expect, it } from 'vitest';

import {
  fail,
  info,
  succeed,
  withSpinner,
  writeStatus,
  type StatusStream,
} from '../src/lib/status.js';

const cleanEnv: NodeJS.ProcessEnv = {};

describe('writeStatus', () => {
  it('writes when stream isTTY=true', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    writeStatus('hello', { stream, env: cleanEnv });
    expect(buffer.join('')).toBe('hello\n');
  });

  it('is a no-op when stream isTTY=false', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: false,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    writeStatus('hello', { stream, env: cleanEnv });
    expect(buffer.join('')).toBe('');
  });

  it('is a no-op when CI is set', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    writeStatus('hello', { stream, env: { CI: 'true' } });
    expect(buffer.join('')).toBe('');
  });

  it('is a no-op when NO_COLOR is set', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    writeStatus('hello', { stream, env: { NO_COLOR: '1' } });
    expect(buffer.join('')).toBe('');
  });
});

describe('info / succeed / fail', () => {
  it('prefix info messages with ℹ', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    info('hi', { stream, env: cleanEnv });
    expect(buffer.join('')).toBe('ℹ hi\n');
  });

  it('prefixes succeed with ✓', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    succeed('done', { stream, env: cleanEnv });
    expect(buffer.join('')).toBe('✓ done\n');
  });

  it('prefixes fail with ✗', () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    fail('boom', { stream, env: cleanEnv });
    expect(buffer.join('')).toBe('✗ boom\n');
  });
});

describe('withSpinner', () => {
  it('returns the inner value', async () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: false, // disabled — no spinner output, but fn still runs
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    const result = await withSpinner(
      'working',
      async () => 42,
      { stream, env: cleanEnv },
    );
    expect(result).toBe(42);
  });

  it('does not write to the stream when isTTY=false', async () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: false,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    await withSpinner('working', async () => 'ok', { stream, env: cleanEnv });
    expect(buffer.join('')).toBe('');
  });

  it('does not write to the stream when CI is set', async () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: true,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    await withSpinner('working', async () => 'ok', {
      stream,
      env: { CI: 'true' },
    });
    expect(buffer.join('')).toBe('');
  });

  it('propagates errors from the inner fn', async () => {
    const buffer: string[] = [];
    const stream = {
      isTTY: false,
      write(chunk: string | Buffer) {
        buffer.push(String(chunk));
        return true;
      },
    } as unknown as StatusStream;

    await expect(
      withSpinner(
        'working',
        async () => {
          throw new Error('inner failure');
        },
        { stream, env: cleanEnv },
      ),
    ).rejects.toThrow('inner failure');
  });

  it('runs fn even when output is suppressed', async () => {
    let ran = false;
    const stream = {
      isTTY: false,
      write() {
        return true;
      },
    } as unknown as StatusStream;

    await withSpinner(
      'x',
      async () => {
        ran = true;
        return null;
      },
      { stream, env: { CI: 'true' } },
    );

    expect(ran).toBe(true);
  });
});
