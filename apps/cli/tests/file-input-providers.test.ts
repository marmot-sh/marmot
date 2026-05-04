import { describe, expect, it } from 'vitest';

import { anthropicAdapter } from '@marmot-sh/anthropic';
import { openAIAdapter } from '@marmot-sh/openai';
import { openRouterAdapter } from '@marmot-sh/openrouter';
import { vercelAdapter } from '@marmot-sh/vercel';

const PDF_BYTES = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37,
]);

function captureRequest() {
  let captured: { url: string; body: unknown } | null = null;
  const fetchFn: typeof fetch = async (url, init) => {
    let body: unknown = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}'));
    } catch {
      body = init?.body;
    }
    captured = { url: String(url), body };
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchFn, get: () => captured };
}

function userMessageContent(body: unknown): Array<Record<string, unknown>> {
  const messages = (body as { messages?: Array<{ role: string; content: unknown }> })
    .messages ?? [];
  const userMsg = messages.find((m) => m.role === 'user');
  return (userMsg?.content as Array<Record<string, unknown>>) ?? [];
}

describe('file (PDF) input is sent on the wire', () => {
  it('OpenAI: includes file part with file_data data-url', async () => {
    const stub = captureRequest();
    await openAIAdapter
      .generate({
        apiKey: 'k',
        model: 'gpt-4o-mini',
        prompt: 'summarize',
        files: [{ data: PDF_BYTES, mimeType: 'application/pdf' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    const parts = userMessageContent(stub.get()!.body);
    const filePart = parts.find((p) => p.type === 'file');
    expect(filePart).toBeDefined();
    const file = filePart!.file as { file_data?: string };
    expect(file.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('OpenRouter: includes file part with file_data data-url', async () => {
    const stub = captureRequest();
    await openRouterAdapter
      .generate({
        apiKey: 'k',
        model: 'openai/gpt-4o-mini',
        prompt: 'summarize',
        files: [{ data: PDF_BYTES, mimeType: 'application/pdf' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    const parts = userMessageContent(stub.get()!.body);
    const filePart = parts.find((p) => p.type === 'file');
    expect(filePart).toBeDefined();
    const file = filePart!.file as { file_data?: string };
    expect(file.file_data).toMatch(/^data:application\/pdf;base64,/);
  });

  it('Anthropic: includes document content block', async () => {
    const stub = captureRequest();
    await anthropicAdapter
      .generate({
        apiKey: 'k',
        model: 'claude-3-5-sonnet-latest',
        prompt: 'summarize',
        files: [{ data: PDF_BYTES, mimeType: 'application/pdf' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    const parts = userMessageContent(stub.get()!.body);
    const doc = parts.find((p) => p.type === 'document');
    expect(doc).toBeDefined();
    expect((doc!.source as { media_type: string }).media_type).toBe(
      'application/pdf',
    );
  });

  it('Vercel AI Gateway: includes file part with application/pdf media type', async () => {
    const stub = captureRequest();
    await vercelAdapter
      .generate({
        apiKey: 'k',
        model: 'openai/gpt-4o-mini',
        prompt: 'summarize',
        files: [{ data: PDF_BYTES, mimeType: 'application/pdf' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    // Gateway envelope: { prompt: [{ role, content: [...] }] }
    const body = stub.get()!.body as { prompt?: Array<{ content: unknown[] }> };
    const parts = (body.prompt?.[0]?.content ?? []) as Array<
      Record<string, unknown>
    >;
    const filePart = parts.find((p) => p.type === 'file');
    expect(filePart).toBeDefined();
    expect(filePart!.mediaType).toBe('application/pdf');
  });
});
