import { describe, expect, it } from 'vitest';

import { AICliError } from '@marmot-sh/core';

import { makeRetryNotifier } from '../src/lib/retry-notifier.js';

class CapturingStream {
  chunks: string[] = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  text(): string {
    return this.chunks.join('');
  }
}

describe('makeRetryNotifier', () => {
  it('formats AICliError messages with attempt N/M, provider, verb, and delay', () => {
    const stderr = new CapturingStream();
    const notify = makeRetryNotifier(stderr, 'tavily', 'search', 3);
    notify(0, new AICliError('provider', 'HTTP 429'), 800);

    expect(stderr.text()).toBe(
      '[retry 1/3] tavily search: HTTP 429, backing off 800ms\n',
    );
  });

  it('1-indexes the attempt counter in output (callback receives 0-indexed)', () => {
    const stderr = new CapturingStream();
    const notify = makeRetryNotifier(stderr, 'parallel', 'enrich', 2);
    notify(0, new AICliError('provider', 'a'), 100);
    notify(1, new AICliError('provider', 'b'), 200);

    const lines = stderr.text().split('\n').filter(Boolean);
    expect(lines[0]).toContain('[retry 1/2]');
    expect(lines[1]).toContain('[retry 2/2]');
  });

  it('truncates long messages at 80 chars with ellipsis', () => {
    const stderr = new CapturingStream();
    const notify = makeRetryNotifier(stderr, 'p', 'v', 1);
    const long = 'x'.repeat(200);
    notify(0, new AICliError('provider', long), 50);

    const line = stderr.text();
    // 80 chars max payload, plus "..." appended
    expect(line).toContain('xxx...');
    // Bounded length: prefix + truncated + delay suffix should be reasonable
    expect(line.length).toBeLessThan(150);
  });

  it('handles non-AICliError values via String() coercion', () => {
    const stderr = new CapturingStream();
    const notify = makeRetryNotifier(stderr, 'p', 'v', 1);
    notify(0, new Error('raw error'), 10);

    expect(stderr.text()).toContain('Error: raw error');
  });
});
