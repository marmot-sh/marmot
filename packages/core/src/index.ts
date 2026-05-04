// Public API of @marmot-sh/core. Anything here is consumed by provider
// packages and apps/cli. Internal helpers stay reachable via subpath
// imports (e.g. "@marmot-sh/core/lib/files").

export * from './types.js';

// lib
export * from './lib/audio-player.js';
export * from './lib/brand.js';
export * from './lib/completions.js';
export * from './lib/config.js';
export * from './lib/constants.js';
export * from './lib/env.js';
export * from './lib/errors.js';
export * from './lib/files.js';
export * from './lib/messages.js';
export * from './lib/mime.js';
export * from './lib/paths.js';
export * from './lib/pricing.js';
export * from './lib/presets.js';
export * from './lib/sessions.js';
export * from './lib/skill.js';
export * from './lib/retry.js';
export * from './lib/schema.js';
export * from './lib/status.js';
export * from './lib/usage.js';
export * from './lib/web-poll.js';
export * from './lib/web-tasks.js';

// output
export * from './output/image-b64.js';
export {
  renderImageBinaryOutput,
  type BinaryWriter as ImageBinaryWriter,
} from './output/image-binary.js';
export * from './output/image-file.js';
export * from './output/image-preview.js';
export * from './output/json.js';
export * from './output/object-json.js';
export * from './output/speech-b64.js';
export {
  renderSpeechBinaryOutput,
  type BinaryWriter as SpeechBinaryWriter,
} from './output/speech-binary.js';
export * from './output/speech-file.js';
export * from './output/text.js';
export * from './output/transcribe.js';
export * from './output/write.js';

// cache
export * from './cache/store.js';
export * from './cache/responses.js';

// schemas (zod schemas + types used across the workspace)
export * from './schemas/cache.js';
export * from './schemas/cli.js';
export * from './schemas/config.js';
export * from './schemas/image.js';
export * from './schemas/output.js';
export * from './schemas/speech.js';
export * from './schemas/session.js';
export * from './schemas/transcription.js';
export * from './schemas/web-tasks.js';

// providers (adapter contract + summary)
export * from './providers.js';
