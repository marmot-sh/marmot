import { copyFile, mkdir, readFile, readdir, rm, writeFile, appendFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { AICliError } from './errors.js';
import {
  getCurrentSessionPath,
  getSessionDir,
  getSessionLogPath,
  getSessionMessagesPath,
  getSessionMetaPath,
  getSessionsDir,
} from './paths.js';
import {
  SESSION_NAME_REGEX,
  chatMessageSchema,
  logRecordSchema,
  sessionMetaSchema,
  type ChatMessage,
  type ChatMessageRole,
  type LogRecord,
  type SessionMeta,
  type SessionMode,
} from '../schemas/session.js';
import type { ChatHistoryEntry } from '../types.js';

export function validateSessionName(name: string): void {
  if (!SESSION_NAME_REGEX.test(name)) {
    throw new AICliError(
      'validation',
      `Invalid session name "${name}". Names must be lowercase letters/digits with single - or _ separators (no leading, trailing, or consecutive separators).`,
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return null;
    throw new AICliError('io', `Failed to read "${path}".`, { cause: error });
  }
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export type CreateSessionOptions = {
  mode?: SessionMode;
  preset?: string;
  label?: string;
  recordPrompts?: boolean;
  autoCompact?: boolean;
};

export async function createSession(
  name: string,
  options: CreateSessionOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta> {
  validateSessionName(name);

  const dir = getSessionDir(name, env);
  let exists = false;
  try {
    await stat(dir);
    exists = true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw error;
  }
  if (exists) {
    throw new AICliError(
      'validation',
      `Session "${name}" already exists. Delete it first or pick a different name.`,
    );
  }

  if (options.preset !== undefined) validateSessionName(options.preset);

  const meta = sessionMetaSchema.parse({
    name,
    mode: options.mode ?? 'stateless',
    preset: options.preset,
    label: options.label,
    record_prompts: options.recordPrompts ?? false,
    auto_compact: options.autoCompact ?? false,
    created_at: nowIso(),
  });

  await writeJsonFile(getSessionMetaPath(name, env), meta);
  return meta;
}

export async function getSession(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta> {
  validateSessionName(name);
  const raw = await readJsonFile<unknown>(getSessionMetaPath(name, env));
  if (raw === null) {
    throw new AICliError(
      'validation',
      `Session "${name}" not found. Run "marmot session list" to see available sessions.`,
    );
  }
  const parsed = sessionMetaSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AICliError(
      'validation',
      `Session "${name}" metadata is corrupt or out of date. Delete it with "marmot session delete ${name}" and recreate.`,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}

export async function listSessions(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta[]> {
  const dir = getSessionsDir(env);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return [];
    throw new AICliError('io', `Failed to list sessions in "${dir}".`, { cause: error });
  }

  const metas: SessionMeta[] = [];
  for (const name of names.sort()) {
    if (!SESSION_NAME_REGEX.test(name)) continue;
    try {
      metas.push(await getSession(name, env));
    } catch {
      // Skip corrupt entries; surface them via `session show` instead.
    }
  }
  return metas;
}

export type DeleteSessionOptions = {
  /** Delete only meta.json + messages.jsonl, preserve log.jsonl for audit. */
  keepLog?: boolean;
};

export async function deleteSession(
  name: string,
  options: DeleteSessionOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  validateSessionName(name);
  const dir = getSessionDir(name, env);

  try {
    await stat(dir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return false;
    throw error;
  }

  if (options.keepLog) {
    await rm(getSessionMetaPath(name, env), { force: true });
    // messages.jsonl removal is best-effort; ignore ENOENT.
    await rm(`${dir}/messages.jsonl`, { force: true });
  } else {
    await rm(dir, { recursive: true, force: true });
  }

  // Clear pointer if it was pointing at this session.
  const pointer = await getCurrentSession(env);
  if (pointer === name) await clearCurrentSession(env);

  return true;
}

// -- Current-session pointer --------------------------------------------------

export async function getCurrentSession(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const path = getCurrentSessionPath(env);
  try {
    const raw = (await readFile(path, 'utf8')).trim();
    if (!raw) return null;
    return SESSION_NAME_REGEX.test(raw) ? raw : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return null;
    throw new AICliError('io', `Failed to read current-session pointer.`, { cause: error });
  }
}

export async function setCurrentSession(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  validateSessionName(name);
  // Confirm the session actually exists before pointing at it.
  await getSession(name, env);
  const path = getCurrentSessionPath(env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${name}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function clearCurrentSession(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = getCurrentSessionPath(env);
  await rm(path, { force: true });
}

/**
 * Resolve which session a call should be bound to.
 * Precedence: explicit flag > current-session pointer > none.
 */
export async function resolveActiveSession(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  if (explicit) {
    validateSessionName(explicit);
    return explicit;
  }
  return getCurrentSession(env);
}

// -- Log records --------------------------------------------------------------

export type AppendLogInput = Omit<LogRecord, 'session' | 'ts'> & {
  ts?: string;
};

/**
 * Append a log record to a session's log.jsonl and update meta totals.
 *
 * Redaction is enforced here based on the session's `record_prompts` flag:
 * if false (the default), `prompt` and `system` are stripped before write.
 * Callers do not need to pre-redact, but {@link redactLogRecord} is still
 * exported for callers that want to redact earlier in the pipeline.
 */
export async function appendLogRecord(
  name: string,
  input: AppendLogInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LogRecord> {
  validateSessionName(name);
  const meta = await getSession(name, env);

  const safe = redactLogRecord(input, { recordPrompts: meta.record_prompts });

  const record = logRecordSchema.parse({
    ...safe,
    session: name,
    ts: safe.ts ?? nowIso(),
  });

  const logPath = getSessionLogPath(name, env);
  await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
  await appendFile(logPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });

  // Roll up totals onto meta. Reads + writes are not atomic across processes;
  // last-writer-wins is acceptable here (totals are advisory, log.jsonl is
  // authoritative).
  const updated: SessionMeta = {
    ...meta,
    last_used_at: record.ts,
    totals: {
      calls: meta.totals.calls + 1,
      input_tokens: meta.totals.input_tokens + (record.tokens?.input ?? 0),
      output_tokens: meta.totals.output_tokens + (record.tokens?.output ?? 0),
      cache_read_tokens: meta.totals.cache_read_tokens + (record.tokens?.cache_read ?? 0),
      cache_write_tokens: meta.totals.cache_write_tokens + (record.tokens?.cache_write ?? 0),
    },
  };
  await writeJsonFile(getSessionMetaPath(name, env), updated);

  return record;
}

export type ReadLogOptions = {
  /** ISO timestamp lower bound (inclusive). */
  since?: string;
  /** Cap the number of records returned (most recent kept). */
  limit?: number;
};

export async function readLogRecords(
  name: string,
  options: ReadLogOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<LogRecord[]> {
  validateSessionName(name);
  const path = getSessionLogPath(name, env);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return [];
    throw new AICliError('io', `Failed to read log "${path}".`, { cause: error });
  }

  const records: LogRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = logRecordSchema.safeParse(payload);
    if (!parsed.success) continue;
    if (options.since && parsed.data.ts < options.since) continue;
    records.push(parsed.data);
  }

  if (options.limit !== undefined && records.length > options.limit) {
    return records.slice(-options.limit);
  }
  return records;
}

// -- Redaction ----------------------------------------------------------------

export type RedactionContext = {
  /** When false, prompt + system bodies are stripped from the record. */
  recordPrompts: boolean;
};

/**
 * Apply redaction rules to a log record before it gets appended.
 * - prompt + system bodies stripped unless recordPrompts is true
 * - never carries an api-key value (caller must not put one in input)
 */
export function redactLogRecord(
  record: AppendLogInput,
  context: RedactionContext,
): AppendLogInput {
  if (context.recordPrompts) return record;
  const { prompt: _prompt, system: _system, ...rest } = record;
  return rest;
}

/**
 * Identify where the API key for a call came from, without ever recording the
 * key itself. Returns the env var name when the key matches one in `env`,
 * or 'flag-override' if it doesn't, or undefined if no key was present.
 */
export function keySource(
  apiKey: string | undefined,
  envVarNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!apiKey) return undefined;
  for (const name of envVarNames) {
    if (env[name] && env[name] === apiKey) return name;
  }
  return 'flag-override';
}

// -- Chat messages (chat-mode sessions) ---------------------------------------

function assertChatMode(meta: SessionMeta): void {
  if (meta.mode !== 'chat') {
    throw new AICliError(
      'validation',
      `Session "${meta.name}" is mode "${meta.mode}", not "chat". Chat operations are only valid on chat-mode sessions.`,
    );
  }
}

export type AppendChatMessageInput = {
  role: ChatMessageRole;
  content: string;
  /** Override the timestamp for deterministic tests. */
  ts?: string;
  /** Optional watermark label (used by `session mark`, Phase 3). */
  mark?: string;
};

export async function appendChatMessage(
  name: string,
  input: AppendChatMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatMessage> {
  validateSessionName(name);
  const meta = await getSession(name, env);
  assertChatMode(meta);

  const message = chatMessageSchema.parse({
    role: input.role,
    content: input.content,
    ts: input.ts ?? nowIso(),
    mark: input.mark,
  });

  const path = getSessionMessagesPath(name, env);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(message)}\n`, { encoding: 'utf8', mode: 0o600 });
  return message;
}

export async function readChatMessages(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatMessage[]> {
  validateSessionName(name);
  const path = getSessionMessagesPath(name, env);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === 'ENOENT') return [];
    throw new AICliError('io', `Failed to read messages "${path}".`, { cause: error });
  }

  const messages: ChatMessage[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = chatMessageSchema.safeParse(payload);
    if (parsed.success) messages.push(parsed.data);
  }
  return messages;
}

/**
 * Convert stored chat messages into the history shape the provider adapter
 * accepts. Drops 'summary' rows down to 'assistant' (a summary message is
 * still useful prior context even if it didn't come from the model directly)
 * and skips watermark sentinels (mark is metadata, not conversation).
 */
export function chatMessagesToHistory(
  messages: readonly ChatMessage[],
): ChatHistoryEntry[] {
  const history: ChatHistoryEntry[] = [];
  for (const m of messages) {
    if (m.mark) continue;
    history.push({
      role: m.role === 'summary' ? 'assistant' : m.role,
      content: m.content,
    });
  }
  return history;
}

export async function clearChatMessages(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  validateSessionName(name);
  await rm(getSessionMessagesPath(name, env), { force: true });
}

/**
 * Copy a session's meta + log + messages into a new session. The new session
 * starts with totals carried over (so cumulative cost reporting stays sane)
 * and a fresh created_at. Refuses if dest already exists.
 */
export async function forkSession(
  src: string,
  dest: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SessionMeta> {
  validateSessionName(src);
  validateSessionName(dest);

  const srcMeta = await getSession(src, env);

  const destDir = getSessionDir(dest, env);
  try {
    await stat(destDir);
    throw new AICliError(
      'validation',
      `Cannot fork into "${dest}": session already exists.`,
    );
  } catch (error) {
    if (error instanceof AICliError) throw error;
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw error;
  }

  await mkdir(destDir, { recursive: true, mode: 0o700 });

  // Write fresh meta with new name + timestamps but inherited mode/preset/etc.
  const destMeta = sessionMetaSchema.parse({
    ...srcMeta,
    name: dest,
    created_at: nowIso(),
    last_used_at: undefined,
  });
  await writeJsonFile(getSessionMetaPath(dest, env), destMeta);

  // Best-effort copy of log + messages. Either may not exist.
  for (const filename of ['log.jsonl', 'messages.jsonl']) {
    const from = `${getSessionDir(src, env)}/${filename}`;
    const to = `${destDir}/${filename}`;
    try {
      await copyFile(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (code !== 'ENOENT') throw error;
    }
  }

  return destMeta;
}

/**
 * Append a watermark sentinel to messages.jsonl. Compaction never crosses
 * a mark — anything after the most recent mark stays verbatim.
 */
export async function markChatMessage(
  name: string,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatMessage> {
  if (!label.trim()) {
    throw new AICliError('validation', 'Mark label cannot be empty.');
  }
  return appendChatMessage(name, { role: 'user', content: '', mark: label }, env);
}

/**
 * Find the index of the most recent mark in a messages array. Returns -1 if
 * none. Compaction must preserve everything from this index onwards.
 */
export function lastMarkIndex(messages: readonly ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.mark) return i;
  }
  return -1;
}

/**
 * Replace messages.jsonl with a new ordered list, rotating the previous file
 * to messages.<ts>.jsonl for recovery. Used by compaction.
 */
export async function rewriteChatMessages(
  name: string,
  messages: readonly ChatMessage[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ rotatedTo: string | null }> {
  validateSessionName(name);
  const path = getSessionMessagesPath(name, env);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  let rotatedTo: string | null = null;
  try {
    await stat(path);
    const ts = nowIso().replace(/[:.]/g, '-');
    rotatedTo = `${dir}/messages.${ts}.jsonl`;
    await writeFile(rotatedTo, await readFile(path, 'utf8'), { encoding: 'utf8', mode: 0o600 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw error;
  }

  const body = messages.map((m) => JSON.stringify(m)).join('\n');
  await writeFile(path, body ? `${body}\n` : '', { encoding: 'utf8', mode: 0o600 });
  return { rotatedTo };
}

export type ExportFormat = 'jsonl' | 'md';

/**
 * Render a session's chat history for portability. `jsonl` is the raw
 * messages.jsonl content. `md` is a human-readable markdown transcript.
 */
export async function exportSession(
  name: string,
  format: ExportFormat,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const meta = await getSession(name, env);
  const messages = await readChatMessages(name, env);

  if (format === 'jsonl') {
    return messages.map((m) => JSON.stringify(m)).join('\n');
  }

  const lines: string[] = [
    `# Session: ${meta.name}`,
    '',
    `_Mode: ${meta.mode}${meta.preset ? `  ·  Preset: ${meta.preset}` : ''}_`,
    '',
  ];
  for (const m of messages) {
    if (m.mark) {
      lines.push(`---`, ``, `**[mark]** ${m.mark}  _(${m.ts})_`, ``, `---`, ``);
      continue;
    }
    const heading = m.role === 'user'
      ? '## User'
      : m.role === 'summary'
        ? '## Summary'
        : '## Assistant';
    lines.push(heading, '', m.content, '');
  }
  return lines.join('\n');
}
