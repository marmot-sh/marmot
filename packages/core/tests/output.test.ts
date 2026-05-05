import { describe, expect, it } from 'vitest';

import { renderJsonOutput } from '../src/output/json.js';
import { renderTextOutput } from '../src/output/text.js';
import type { NormalizedRunResult } from '../src/types.js';

const sampleResult: NormalizedRunResult = {
  ok: true,
  provider: 'ollama',
  model: 'qwen3:4b',
  text: 'hello from gemma',
  usage: {
    inputTokens: 12,
    outputTokens: 34,
    totalTokens: 46,
  },
  finishReason: 'stop',
  cachedModelValidated: true,
  outputFile: null,
  timestamp: '2026-04-22T12:30:00.000Z',
};

describe('output renderers', () => {
  it('renders normalized JSON', () => {
    const parsed = JSON.parse(renderJsonOutput(sampleResult)) as NormalizedRunResult;
    expect(parsed).toEqual(sampleResult);
  });

  it('renders text mode as raw text', () => {
    expect(renderTextOutput('plain text')).toBe('plain text');
  });
});
