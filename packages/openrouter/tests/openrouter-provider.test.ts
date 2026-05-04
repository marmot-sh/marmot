import { describe, expect, it } from 'vitest';

import { openRouterAdapter } from '../src/index.js';

describe('openRouterAdapter.refreshModels', () => {
  it('accepts current nullable fields from the models endpoint', async () => {
    const payload = {
      data: [
        {
          id: 'openai/gpt-oss-120b',
          canonical_slug: 'openai/gpt-oss-120b',
          name: 'OpenAI: GPT OSS 120B',
          created: 1776797528,
          description: 'Example model.',
          context_length: 272000,
          architecture: {
            modality: 'text->text',
            input_modalities: ['text'],
            output_modalities: ['text'],
            tokenizer: 'GPT',
            instruct_type: null,
          },
          pricing: {
            prompt: '0.000008',
            completion: '0.000015',
            input_cache_read: '0.000002',
          },
          top_provider: {
            context_length: null,
            max_completion_tokens: null,
            is_moderated: true,
          },
          per_request_limits: null,
          supported_parameters: ['max_tokens'],
          default_parameters: {},
          knowledge_cutoff: null,
          expiration_date: null,
          links: {
            details: '/api/v1/models/openai/gpt-oss-120b/endpoints',
          },
        },
      ],
    };

    const result = await openRouterAdapter.refreshModels({
      fetchFn: async () => new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      }),
      now: () => new Date('2026-04-22T17:10:00.000Z'),
    });

    expect(result.defaultModel).toBe('openai/gpt-oss-120b');
    expect(result.models[0]).toMatchObject({
      id: 'openai/gpt-oss-120b',
      name: 'OpenAI: GPT OSS 120B',
      contextLength: 272000,
      inputModalities: ['text'],
      outputModalities: ['text'],
    });
  });
});
