import { describe, expect, it } from 'vitest';

import { playAudioFile } from '../src/lib/audio-player.js';

describe('playAudioFile', () => {
  it('throws a clean AICliError when no player is found', async () => {
    // Trick the platform detection by hijacking PATH so no candidates resolve.
    const original = process.env.PATH;
    process.env.PATH = '';
    try {
      await expect(
        playAudioFile('/tmp/does-not-matter.mp3'),
      ).rejects.toThrowError(/No audio player found/);
    } finally {
      if (original) process.env.PATH = original;
      else delete process.env.PATH;
    }
  });
});
