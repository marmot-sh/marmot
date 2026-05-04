import { describe, expect, it } from 'vitest';

import { AICliError } from '../src/lib/errors.js';
import {
  DEFAULT_GENERATION_TIMEOUT_MS,
  MAX_RETRIES,
  resolveRetryOptions,
} from '../src/lib/retry.js';

describe('resolveRetryOptions', () => {
  it('returns defaults when both inputs are undefined', () => {
    expect(resolveRetryOptions({})).toEqual({
      retries: 0,
      timeoutMs: DEFAULT_GENERATION_TIMEOUT_MS,
    });
  });

  it('parses string inputs from commander', () => {
    expect(resolveRetryOptions({ retries: '3', timeout: '60' })).toEqual({
      retries: 3,
      timeoutMs: 60_000,
    });
  });

  it('accepts numeric inputs (preset / programmatic path)', () => {
    expect(resolveRetryOptions({ retries: 2, timeout: 30 })).toEqual({
      retries: 2,
      timeoutMs: 30_000,
    });
  });

  it('rejects empty-string retries (would silently coerce to 0 with Number())', () => {
    expect(() => resolveRetryOptions({ retries: '' })).toThrowError(AICliError);
    expect(() => resolveRetryOptions({ retries: '   ' })).toThrowError(AICliError);
  });

  it('rejects empty-string timeout', () => {
    expect(() => resolveRetryOptions({ timeout: '' })).toThrowError(AICliError);
  });

  it('rejects non-integer retries', () => {
    expect(() => resolveRetryOptions({ retries: '1.5' })).toThrowError(AICliError);
    expect(() => resolveRetryOptions({ retries: 'abc' })).toThrowError(AICliError);
    expect(() => resolveRetryOptions({ retries: 1.5 })).toThrowError(AICliError);
  });

  it('rejects retries below 0', () => {
    expect(() => resolveRetryOptions({ retries: '-1' })).toThrowError(AICliError);
    expect(() => resolveRetryOptions({ retries: -1 })).toThrowError(AICliError);
  });

  it(`rejects retries above MAX_RETRIES (${MAX_RETRIES})`, () => {
    expect(() => resolveRetryOptions({ retries: String(MAX_RETRIES + 1) })).toThrowError(AICliError);
    expect(() => resolveRetryOptions({ retries: MAX_RETRIES + 1 })).toThrowError(AICliError);
  });

  it(`accepts the boundary values (0 and ${MAX_RETRIES})`, () => {
    expect(resolveRetryOptions({ retries: '0' }).retries).toBe(0);
    expect(resolveRetryOptions({ retries: String(MAX_RETRIES) }).retries).toBe(MAX_RETRIES);
  });

  it('rejects timeout below 1 second', () => {
    expect(() => resolveRetryOptions({ timeout: '0' })).toThrowError(AICliError);
    expect(() => resolveRetryOptions({ timeout: '-5' })).toThrowError(AICliError);
  });

  it('rejects timeout above 86400 seconds', () => {
    expect(() => resolveRetryOptions({ timeout: '86401' })).toThrowError(AICliError);
  });

  it('accepts timeout boundary values (1 and 86400)', () => {
    expect(resolveRetryOptions({ timeout: '1' }).timeoutMs).toBe(1_000);
    expect(resolveRetryOptions({ timeout: '86400' }).timeoutMs).toBe(86_400_000);
  });

  it('error messages reference the input value for debuggability', () => {
    try {
      resolveRetryOptions({ retries: 'abc' });
      expect.fail('expected throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AICliError);
      expect((error as AICliError).message).toContain('"abc"');
    }
  });
});
