import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { renderImageBinaryOutput } from '../src/output/image-binary.js';
import {
  renderImageB64EnvelopeJson,
  renderImageB64Output,
} from '../src/output/image-b64.js';
import {
  renderImageFileEnvelopeJson,
  renderImageFileOutput,
} from '../src/output/image-file.js';
import type { ProviderImageGenerateResult } from '../src/types.js';

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function makeResult(n: number, mimeType = 'image/png'): ProviderImageGenerateResult {
  return {
    provider: 'openai',
    model: 'gpt-image-1',
    images: Array.from({ length: n }, (_, i) => ({
      data: new Uint8Array([...PNG_HEADER, i & 0xff]),
      mimeType,
    })),
    usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    finishReason: 'stop',
  };
}

describe('renderImageFileOutput', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    tempDirs.length = 0;
  });

  async function fixture() {
    const tempDir = await mkdtemp(join(tmpdir(), 'marmot-img-output-'));
    tempDirs.push(tempDir);
    return tempDir;
  }

  it('writes a single image to a default timestamped filename in cwd', async () => {
    const cwd = await fixture();
    const rendered = await renderImageFileOutput({
      result: makeResult(1),
      provider: 'openai',
      cwd,
      now: () => new Date('2026-04-29T14:05:30.000Z'),
    });

    expect(rendered.images).toHaveLength(1);
    const path = rendered.images[0]!.path!;
    expect(path).toMatch(new RegExp(`${cwd}/openai-\\d{14}\\.png$`));

    const written = await readFile(path);
    expect(written.equals(Buffer.from([...PNG_HEADER, 0]))).toBe(true);
  });

  it('uses {i} template for n>1', async () => {
    const cwd = await fixture();
    const rendered = await renderImageFileOutput({
      result: makeResult(3),
      provider: 'openai',
      outputPath: './out-{i}.png',
      cwd,
      now: () => new Date(),
    });

    const paths = rendered.images.map((img) => img.path!);
    expect(paths).toEqual([
      `${cwd}/out-1.png`,
      `${cwd}/out-2.png`,
      `${cwd}/out-3.png`,
    ]);
    for (const p of paths) {
      const buf = await readFile(p);
      expect(buf.length).toBeGreaterThan(0);
    }
  });

  it('rejects --n > 1 without {i} placeholder', async () => {
    const cwd = await fixture();
    await expect(
      renderImageFileOutput({
        result: makeResult(2),
        provider: 'openai',
        outputPath: './single.png',
        cwd,
        now: () => new Date(),
      }),
    ).rejects.toThrowError(/must include the \{i\} placeholder/);
  });

  it('honors a literal output path for n=1 (no {i} required)', async () => {
    const cwd = await fixture();
    const rendered = await renderImageFileOutput({
      result: makeResult(1),
      provider: 'openai',
      outputPath: './my-image.png',
      cwd,
      now: () => new Date(),
    });
    expect(rendered.images[0]!.path).toBe(`${cwd}/my-image.png`);
  });

  it('serializes the envelope as JSON with paths and bytes', async () => {
    const cwd = await fixture();
    const rendered = await renderImageFileOutput({
      result: makeResult(1),
      provider: 'openai',
      cwd,
      now: () => new Date('2026-04-29T14:05:30.000Z'),
      requestedSize: '1024x1024',
    });

    const parsed = JSON.parse(renderImageFileEnvelopeJson(rendered));
    expect(parsed.ok).toBe(true);
    expect(parsed.provider).toBe('openai');
    expect(parsed.images[0].format).toBe('png');
    expect(parsed.images[0].size).toBe('1024x1024');
    expect(parsed.images[0].bytes).toBe(PNG_HEADER.length + 1);
    expect(parsed.images[0].path).toMatch(/openai-\d{14}\.png$/);
  });

  it('uses jpg extension for image/jpeg responses', async () => {
    const cwd = await fixture();
    const rendered = await renderImageFileOutput({
      result: makeResult(1, 'image/jpeg'),
      provider: 'openai',
      cwd,
      now: () => new Date(),
    });
    expect(rendered.images[0]!.path).toMatch(/\.jpg$/);
    expect(rendered.images[0]!.format).toBe('jpg');
  });
});

describe('renderImageBinaryOutput', () => {
  it('writes raw bytes to the supplied writer', () => {
    const captured: Uint8Array[] = [];
    renderImageBinaryOutput(makeResult(1), {
      write(chunk) {
        captured.push(chunk);
        return true;
      },
    });
    expect(captured).toHaveLength(1);
    expect(Buffer.from(captured[0]!).equals(Buffer.from([...PNG_HEADER, 0]))).toBe(
      true,
    );
  });

  it('rejects n>1 at the renderer (defense in depth)', () => {
    expect(() =>
      renderImageBinaryOutput(makeResult(2), { write: () => true }),
    ).toThrowError(/--binary supports a single image/);
  });

  it('throws when there are zero images', () => {
    expect(() =>
      renderImageBinaryOutput(
        { ...makeResult(1), images: [] },
        { write: () => true },
      ),
    ).toThrowError(/no images/);
  });
});

describe('renderImageB64Output', () => {
  it('round-trips bytes through base64', () => {
    const result = makeResult(1);
    const rendered = renderImageB64Output({
      result,
      now: () => new Date(),
    });
    const decoded = Buffer.from(rendered.images[0]!.b64!, 'base64');
    expect(decoded.equals(Buffer.from(result.images[0]!.data))).toBe(true);
  });

  it('preserves format and bytes per image', () => {
    const rendered = renderImageB64Output({
      result: makeResult(2),
      requestedSize: '512x512',
      now: () => new Date(),
    });
    expect(rendered.images).toHaveLength(2);
    for (const img of rendered.images) {
      expect(img.format).toBe('png');
      expect(img.size).toBe('512x512');
      expect(img.b64).toBeTypeOf('string');
      expect(img.path).toBeUndefined();
    }
  });

  it('serializes as JSON', () => {
    const rendered = renderImageB64Output({
      result: makeResult(1),
      now: () => new Date('2026-04-29T14:05:30.000Z'),
    });
    const parsed = JSON.parse(renderImageB64EnvelopeJson(rendered));
    expect(parsed.ok).toBe(true);
    expect(parsed.images[0].b64).toBeTypeOf('string');
  });
});
