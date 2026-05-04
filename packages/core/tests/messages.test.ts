import { describe, expect, it } from 'vitest';

import { buildUserMessages } from '../src/lib/messages.js';

describe('buildUserMessages', () => {
  it('returns undefined when there are no images', () => {
    expect(buildUserMessages({ prompt: 'hi' })).toBeUndefined();
    expect(buildUserMessages({ prompt: 'hi', images: [] })).toBeUndefined();
  });

  it('builds a single user message with the prompt followed by image parts', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    const result = buildUserMessages({
      prompt: 'describe these',
      images: [
        { data: png, mimeType: 'image/png' },
        { data: jpg, mimeType: 'image/jpeg' },
      ],
    });

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe these' },
          { type: 'image', image: png, mediaType: 'image/png' },
          { type: 'image', image: jpg, mediaType: 'image/jpeg' },
        ],
      },
    ]);
  });

  it('preserves image bytes by reference (no copies)', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const result = buildUserMessages({
      prompt: 'p',
      images: [{ data, mimeType: 'image/png' }],
    });
    const part = result![0]!.content[1] as { type: 'image'; image: Uint8Array };
    expect(part.image).toBe(data);
  });
});
