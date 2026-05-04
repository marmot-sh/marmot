import { describe, expect, it } from 'vitest';

import { anthropicAdapter } from '@marmot-sh/anthropic';
import { cloudflareAdapter } from '@marmot-sh/cloudflare';
import { ollamaAdapter } from '@marmot-sh/ollama';
import { openAIAdapter } from '@marmot-sh/openai';
import { openRouterAdapter } from '@marmot-sh/openrouter';
import { vercelAdapter } from '@marmot-sh/vercel';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// We only care that the outgoing request body contains image content. We
// don't need to satisfy the upstream response schema, so we capture the body
// in fetchFn, return a stub response, and let the provider's response parsing
// throw — then assert on the captured body. This isolates the test from each
// provider's response wire format.
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

describe('image input is sent on the wire', () => {
  it('OpenAI: includes image_url part in user message', async () => {
    const stub = captureRequest();
    await openAIAdapter
      .generate({
        apiKey: 'k',
        model: 'gpt-4o-mini',
        prompt: 'what is this?',
        images: [{ data: PNG_BYTES, mimeType: 'image/png' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    expect(stub.get()).not.toBeNull();
    const parts = userMessageContent(stub.get()!.body);
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);
  });

  it('OpenRouter: includes image_url part in user message', async () => {
    const stub = captureRequest();
    await openRouterAdapter
      .generate({
        apiKey: 'k',
        model: 'openai/gpt-4o-mini',
        prompt: 'what is this?',
        images: [{ data: PNG_BYTES, mimeType: 'image/png' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    expect(stub.get()).not.toBeNull();
    const parts = userMessageContent(stub.get()!.body);
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);
  });

  it('Vercel AI Gateway: includes file part with image media type', async () => {
    const stub = captureRequest();
    await vercelAdapter
      .generate({
        apiKey: 'k',
        model: 'openai/gpt-4o-mini',
        prompt: 'what is this?',
        images: [{ data: PNG_BYTES, mimeType: 'image/png' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    // Gateway uses its own envelope: { prompt: [{ role, content: [...] }] }
    // with image as type: "file" and mediaType: "image/png".
    const body = stub.get()!.body as { prompt?: Array<{ content: unknown[] }> };
    const parts = (body.prompt?.[0]?.content ?? []) as Array<
      Record<string, unknown>
    >;
    expect(
      parts.some(
        (p) => p.type === 'file' && String(p.mediaType ?? '').startsWith('image/'),
      ),
    ).toBe(true);
  });

  it('Cloudflare Workers AI: includes input_image part in input array', async () => {
    const stub = captureRequest();
    await cloudflareAdapter
      .generate({
        apiKey: 'k',
        cloudflareAccountId: 'acct',
        model: '@cf/meta/llama-3.2-11b-vision-instruct',
        prompt: 'what is this?',
        images: [{ data: PNG_BYTES, mimeType: 'image/png' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    // Cloudflare's OpenAI-compat /responses endpoint uses `input` (not
    // `messages`) and image parts are typed `input_image` with `image_url`.
    const body = stub.get()!.body as { input?: Array<{ content: unknown[] }> };
    const parts = (body.input?.[0]?.content ?? []) as Array<
      Record<string, unknown>
    >;
    expect(parts.some((p) => p.type === 'input_image')).toBe(true);
  });

  it('Ollama: includes images array on the user message', async () => {
    const stub = captureRequest();
    await ollamaAdapter
      .generate({
        model: 'llava',
        prompt: 'what is this?',
        images: [{ data: PNG_BYTES, mimeType: 'image/png' }],
        ollamaBaseUrl: 'http://localhost:11434/v1',
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    // Ollama uses its native shape: messages[].images is an array of byte
    // buffers attached to the message itself (not as a content part).
    const body = stub.get()!.body as {
      messages?: Array<{ role: string; images?: unknown[] }>;
    };
    const userMsg = body.messages?.find((m) => m.role === 'user');
    expect(Array.isArray(userMsg?.images)).toBe(true);
    expect((userMsg?.images ?? []).length).toBeGreaterThan(0);
  });

  it('Anthropic: includes image content block in user message', async () => {
    const stub = captureRequest();
    await anthropicAdapter
      .generate({
        apiKey: 'k',
        model: 'claude-3-5-sonnet-latest',
        prompt: 'what is this?',
        images: [{ data: PNG_BYTES, mimeType: 'image/png' }],
        fetchFn: stub.fetchFn,
      })
      .catch(() => {});
    expect(stub.get()).not.toBeNull();
    const parts = userMessageContent(stub.get()!.body);
    expect(parts.some((p) => p.type === 'image')).toBe(true);
  });
});
