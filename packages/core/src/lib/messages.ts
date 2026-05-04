import type { ChatHistoryEntry, FilePart, ImagePart } from '../types.js';

type UserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: Uint8Array; mediaType?: string }
  | { type: 'file'; data: Uint8Array; mediaType: string };

type AssistantContentPart = { type: 'text'; text: string };

type Message =
  | { role: 'user'; content: UserContentPart[] }
  | { role: 'assistant'; content: AssistantContentPart[] };

/**
 * Convert our (prompt, images, files, history) inputs into AI SDK
 * message-content parts. Returns undefined when there's only a single text
 * prompt — the caller should use the simpler `prompt: string` shape then.
 *
 * History is prepended as text-only messages. Each entry becomes a single
 * message of the given role. Images/files in history are not yet supported.
 */
export function buildUserMessages(input: {
  prompt: string;
  images?: ImagePart[];
  files?: FilePart[];
  history?: readonly ChatHistoryEntry[];
}): Message[] | undefined {
  const hasImages = (input.images?.length ?? 0) > 0;
  const hasFiles = (input.files?.length ?? 0) > 0;
  const hasHistory = (input.history?.length ?? 0) > 0;
  if (!hasImages && !hasFiles && !hasHistory) {
    return undefined;
  }

  const messages: Message[] = [];
  for (const turn of input.history ?? []) {
    if (turn.role === 'user') {
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: turn.content }],
      });
    } else {
      messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: turn.content }],
      });
    }
  }

  const content: UserContentPart[] = [{ type: 'text', text: input.prompt }];
  for (const img of input.images ?? []) {
    content.push({
      type: 'image',
      image: img.data,
      mediaType: img.mimeType,
    });
  }
  for (const file of input.files ?? []) {
    content.push({
      type: 'file',
      data: file.data,
      mediaType: file.mimeType,
    });
  }
  messages.push({ role: 'user', content });
  return messages;
}
