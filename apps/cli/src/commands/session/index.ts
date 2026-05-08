import { createReadStream, watchFile, unwatchFile } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import {
  AICliError,
  DEFAULT_TEXT_TIMEOUT_MS,
  PROVIDER_DEFAULT_MODELS,
  SESSION_MODES,
  approximateTokens,
  assertProviderEnabled,
  clearChatMessages,
  clearCurrentSession,
  createSession,
  deleteSession,
  exportSession,
  forkSession,
  getCurrentSession,
  getOllamaApiBaseUrl,
  getPreset,
  getPresetById,
  getSession,
  getSessionLogPath,
  lastMarkIndex,
  listSessions,
  lookupContextWindow,
  markChatMessage,
  readChatMessages,
  readLogRecords,
  readMarmotConfig,
  resolveProviderAuth,
  resolveTextDefaults,
  rewriteChatMessages,
  runWithRetries,
  setCurrentSession,
  validateSessionName,
  writeLine,
  type ChatMessage,
  type ExportFormat,
  type LogRecord,
  type OutputWriter,
  type ProviderSlug,
  type SessionMeta,
  type SessionMode,
} from '@marmot-sh/core';
import { getProviderAdapter } from '../../providers/index.js';

export type SessionCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
};

export type SessionCreateOptions = {
  mode?: string;
  preset?: string;
  label?: string;
  recordPrompts?: boolean;
  autoCompact?: boolean;
};

function assertSessionMode(value: string | undefined): SessionMode {
  if (!value) return 'stateless';
  if (!SESSION_MODES.includes(value as SessionMode)) {
    throw new AICliError(
      'validation',
      `Unknown session mode "${value}". One of: ${SESSION_MODES.join(', ')}.`,
    );
  }
  return value as SessionMode;
}

export async function handleSessionCreate(
  name: string,
  options: SessionCreateOptions,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  validateSessionName(name);
  const mode = assertSessionMode(options.mode);

  // Validate preset exists + matches the right kind. Chat sessions can
  // only carry a text-mode preset; stateless sessions accept any preset.
  if (options.preset) {
    const preset = await getPreset(options.preset, env);
    if (mode === 'chat' && preset.mode !== 'text') {
      throw new AICliError(
        'validation',
        `Chat-mode sessions only accept text-mode presets. Preset "${options.preset}" has mode "${preset.mode}".`,
      );
    }
  }

  const meta = await createSession(
    name,
    {
      mode,
      preset: options.preset,
      label: options.label,
      recordPrompts: options.recordPrompts ?? false,
      autoCompact: options.autoCompact ?? false,
    },
    env,
  );

  writeLine(
    stdout,
    JSON.stringify({ ok: true, action: 'create', name, session: meta }, null, 2),
  );
}

export async function handleSessionUse(
  name: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  await setCurrentSession(name, env);
  writeLine(stdout, JSON.stringify({ ok: true, action: 'use', name }, null, 2));
}

export async function handleSessionEnd(
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const previous = await getCurrentSession(env);
  await clearCurrentSession(env);
  writeLine(
    stdout,
    JSON.stringify({ ok: true, action: 'end', cleared: previous }, null, 2),
  );
}

export async function handleSessionCurrent(
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const current = await getCurrentSession(env);
  writeLine(stdout, JSON.stringify({ current }, null, 2));
}

export async function handleSessionList(
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const sessions = await listSessions(env);
  // Resolve preset_id → current slug at render time. Orphan ids (preset
  // was deleted) render as the raw UUID.
  const summary = await Promise.all(
    sessions.map(async (s) => {
      let presetSlug: string | undefined;
      if (s.preset_id) {
        const found = await getPresetById(s.preset_id, env);
        presetSlug = found?.slug ?? s.preset_id;
      }
      return {
        name: s.name,
        mode: s.mode,
        preset: presetSlug,
        label: s.label,
        calls: s.totals.calls,
        last_used_at: s.last_used_at,
      };
    }),
  );
  writeLine(stdout, JSON.stringify({ sessions: summary }, null, 2));
}

export async function handleSessionShow(
  name: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const session = await getSession(name, env);
  const window = await computeWindowUsage(session, env);
  writeLine(stdout, JSON.stringify({ name, session, window }, null, 2));
}

/**
 * Estimate how much of the model's context window the chat history would use
 * on the next call. Stateless sessions get null. Unknown models also get null
 * (model_max_tokens unknown, can't compute pct). Cheap char-based estimate.
 */
async function computeWindowUsage(
  session: SessionMeta,
  env: NodeJS.ProcessEnv,
): Promise<{
  tokens_in_window: number;
  model: string | null;
  model_max_tokens: number | null;
  percent_used: number | null;
} | null> {
  if (session.mode !== 'chat') return null;
  const messages = await readChatMessages(session.name, env);
  const tokens = messages.reduce(
    (sum, m) => sum + approximateTokens(m.content) + 4, // role overhead
    0,
  );
  const { model } = await resolveSessionModel(session, env);
  const max = model ? lookupContextWindow(model) : null;
  return {
    tokens_in_window: tokens,
    model: model ?? null,
    model_max_tokens: max,
    percent_used: max ? Number(((tokens / max) * 100).toFixed(1)) : null,
  };
}

export type SessionDeleteOptions = {
  keepLog?: boolean;
};

export async function handleSessionDelete(
  name: string,
  options: SessionDeleteOptions,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const removed = await deleteSession(
    name,
    { keepLog: options.keepLog ?? false },
    env,
  );
  writeLine(
    stdout,
    JSON.stringify(
      { ok: true, action: 'delete', name, removed, kept_log: options.keepLog ?? false },
      null,
      2,
    ),
  );
}

export type SessionLogOptions = {
  since?: string;
  limit?: string | number;
  json?: boolean;
  table?: boolean;
};

function parseLimit(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new AICliError('validation', `--limit must be a non-negative integer.`);
  }
  return n;
}

function formatLogTable(records: LogRecord[]): string {
  if (records.length === 0) return '(no records)';
  const lines = ['ts                            verb        provider     model                          tokens(in/out/cache)  exit'];
  for (const r of records) {
    const tok = `${r.tokens?.input ?? '-'}/${r.tokens?.output ?? '-'}/${r.tokens?.cache_read ?? '-'}`;
    lines.push(
      [
        r.ts.padEnd(28),
        r.verb.padEnd(10),
        r.provider.padEnd(12),
        (r.model ?? '-').padEnd(30),
        tok.padEnd(20),
        r.exit,
      ].join('  '),
    );
  }
  return lines.join('\n');
}

export async function handleSessionLog(
  name: string,
  options: SessionLogOptions,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const limit = parseLimit(options.limit);
  const records = await readLogRecords(
    name,
    { since: options.since, limit },
    env,
  );

  if (options.table) {
    writeLine(stdout, formatLogTable(records));
    return;
  }
  writeLine(stdout, JSON.stringify({ name, records }, null, 2));
}

export async function handleSessionTail(
  name: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  // Confirm the session exists before tailing.
  await getSession(name, env);

  const path = getSessionLogPath(name, env);

  let position = 0;
  try {
    const s = await stat(path);
    position = s.size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code !== 'ENOENT') throw error;
  }

  const readNew = async (): Promise<void> => {
    let size: number;
    try {
      const s = await stat(path);
      size = s.size;
    } catch {
      return;
    }
    if (size <= position) return;
    const stream = createReadStream(path, { start: position, end: size - 1, encoding: 'utf8' });
    const rl = createInterface({ input: stream });
    for await (const line of rl) {
      if (line.trim()) writeLine(stdout, line);
    }
    position = size;
  };

  await readNew();
  watchFile(path, { interval: 250 }, () => {
    void readNew();
  });

  // Block until the user kills the process. Tests can short-circuit by
  // calling unwatchFile + clearing handlers; the CLI just runs forever.
  await new Promise<void>(() => {
    process.on('SIGINT', () => {
      unwatchFile(path);
      process.exit(0);
    });
  });
}

export async function handleSessionStats(
  name: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const session = await getSession(name, env);
  const totalInput = session.totals.input_tokens;
  const cacheRead = session.totals.cache_read_tokens;
  const cacheHitRate = totalInput > 0 ? cacheRead / totalInput : 0;

  writeLine(
    stdout,
    JSON.stringify(
      {
        name,
        mode: session.mode,
        calls: session.totals.calls,
        tokens: {
          input: totalInput,
          output: session.totals.output_tokens,
          cache_read: cacheRead,
          cache_write: session.totals.cache_write_tokens,
        },
        cache_hit_rate: Number(cacheHitRate.toFixed(3)),
        last_used_at: session.last_used_at,
      },
      null,
      2,
    ),
  );
}

// -- Chat-mode commands -------------------------------------------------------

function assertChatMode(meta: SessionMeta): void {
  if (meta.mode !== 'chat') {
    throw new AICliError(
      'validation',
      `Session "${meta.name}" is mode "${meta.mode}", not "chat". Chat operations are only valid on chat-mode sessions.`,
    );
  }
}

export async function handleSessionContext(
  name: string,
  options: { json?: boolean } = {},
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const meta = await getSession(name, env);
  assertChatMode(meta);
  const messages = await readChatMessages(name, env);

  if (options.json) {
    writeLine(stdout, JSON.stringify({ name, messages }, null, 2));
    return;
  }

  const lines: string[] = [];
  for (const m of messages) {
    if (m.mark) {
      lines.push(`--- mark: ${m.mark} (${m.ts}) ---`);
      continue;
    }
    lines.push(`[${m.role}] ${m.content}`, '');
  }
  writeLine(stdout, lines.join('\n').trimEnd());
}

export async function handleSessionReset(
  name: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const meta = await getSession(name, env);
  assertChatMode(meta);
  await clearChatMessages(name, env);
  writeLine(
    stdout,
    JSON.stringify({ ok: true, action: 'reset', name }, null, 2),
  );
}

export async function handleSessionFork(
  src: string,
  dest: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const meta = await forkSession(src, dest, env);
  writeLine(
    stdout,
    JSON.stringify({ ok: true, action: 'fork', src, dest, session: meta }, null, 2),
  );
}

export type SessionExportOptions = {
  format?: string;
};

export async function handleSessionExport(
  name: string,
  options: SessionExportOptions,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const format = (options.format ?? 'jsonl') as ExportFormat;
  if (format !== 'jsonl' && format !== 'md') {
    throw new AICliError(
      'validation',
      `Unknown --format "${format}". One of: jsonl, md.`,
    );
  }
  const out = await exportSession(name, format, env);
  writeLine(stdout, out);
}

// -- Phase 3: marks + compaction ----------------------------------------------

/**
 * Resolve the (provider, model) the session should use for compaction or for
 * window estimation. Order: session preset > config defaults > built-in.
 */
async function resolveSessionModel(
  session: SessionMeta,
  env: NodeJS.ProcessEnv,
): Promise<{ provider: ProviderSlug; model: string }> {
  if (session.preset_id) {
    const found = await getPresetById(session.preset_id, env);
    if (found && found.preset.mode === 'text' && found.preset.provider && found.preset.model) {
      return { provider: found.preset.provider, model: found.preset.model };
    }
  }
  const config = await readMarmotConfig(env);
  const defaults = resolveTextDefaults(config);
  const model = defaults.model ?? PROVIDER_DEFAULT_MODELS[defaults.provider];
  return { provider: defaults.provider, model };
}

export async function handleSessionMark(
  name: string,
  label: string,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const meta = await getSession(name, env);
  assertChatMode(meta);
  const message = await markChatMessage(name, label, env);
  writeLine(
    stdout,
    JSON.stringify({ ok: true, action: 'mark', name, mark: message }, null, 2),
  );
}

export type SessionCompactOptions = {
  targetTokens?: string | number;
  keepLast?: string | number;
};

const COMPACT_SYSTEM_PROMPT =
  'You are summarizing a conversation so it can be compacted to free up context window space. '
  + 'Produce a concise summary that preserves: facts established, decisions made, open questions, '
  + 'specific names/numbers/identifiers mentioned, and any constraints or commitments. '
  + 'Write in third-person past tense. Do not address the user. Output the summary only — no preamble.';

function parseIntFieldLocal(name: string, value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new AICliError('validation', `--${name} must be a non-negative integer.`);
  }
  return n;
}

function renderTranscript(messages: readonly ChatMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.mark) {
      lines.push(`[mark: ${m.mark}]`);
      continue;
    }
    const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'Summary';
    lines.push(`${label}: ${m.content}`);
  }
  return lines.join('\n\n');
}

export async function handleSessionCompact(
  name: string,
  options: SessionCompactOptions,
  deps: SessionCommandDependencies = {},
): Promise<void> {
  const env = deps.env ?? process.env;
  const stdout = deps.stdout ?? process.stdout;

  const meta = await getSession(name, env);
  assertChatMode(meta);

  const keepLast = parseIntFieldLocal('keep-last', options.keepLast) ?? 4;
  // target-tokens is currently advisory — surfaced in output, not enforced
  // (the model decides the summary length).
  const targetTokens = parseIntFieldLocal('target-tokens', options.targetTokens);

  const messages = await readChatMessages(name, env);
  if (messages.length === 0) {
    throw new AICliError('validation', `Session "${name}" has no messages to compact.`);
  }

  // Anything from the most recent mark onwards stays verbatim. The summary
  // covers the rest. If there's no mark, summarize everything except the
  // last `keepLast` messages.
  const markIdx = lastMarkIndex(messages);
  const verbatimStartIdx = markIdx >= 0 ? markIdx : Math.max(0, messages.length - keepLast);
  const toSummarize = messages.slice(0, verbatimStartIdx);
  const verbatim = messages.slice(verbatimStartIdx);

  if (toSummarize.length === 0) {
    throw new AICliError(
      'validation',
      `Nothing to compact: all ${messages.length} messages are protected by mark or --keep-last.`,
    );
  }

  const { provider, model } = await resolveSessionModel(meta, env);
  // Mirror the run-pipeline preamble so compact behaves identically to
  // a regular `marmot 'summarize this'` call: honor disabled providers,
  // resolve API keys via the same custom-env-var mechanism (including
  // Cloudflare account id and Ollama base URL), and retry transient
  // provider errors instead of failing the whole compaction.
  const compactConfig = await readMarmotConfig(env);
  assertProviderEnabled(provider, compactConfig);
  const adapter = getProviderAdapter(provider);
  const { apiKey, apiSecret } = resolveProviderAuth(provider, compactConfig, env, {});
  const ollamaBaseUrl = provider === 'ollama' ? getOllamaApiBaseUrl(env) : undefined;
  const cloudflareAccountId = provider === 'cloudflare' ? apiSecret : undefined;

  if (adapter.requiresApiKey && !apiKey) {
    throw new AICliError(
      'auth',
      `Compaction requires an API key for provider "${provider}". Set the corresponding env var (or configure a custom one via \`providers.${provider}.apiKeyEnvVar\`).`,
    );
  }
  if (provider === 'cloudflare' && !cloudflareAccountId) {
    throw new AICliError(
      'auth',
      'Cloudflare Workers AI requires CLOUDFLARE_ACCOUNT_ID for compaction.',
    );
  }

  const transcript = renderTranscript(toSummarize);
  const userPrompt = `Conversation to summarize:\n\n${transcript}`;

  const result = await runWithRetries(
    (abortSignal) =>
      adapter.generate({
        model,
        prompt: userPrompt,
        system: COMPACT_SYSTEM_PROMPT,
        apiKey,
        ollamaBaseUrl,
        cloudflareAccountId,
        abortSignal,
      }),
    { retries: 0, timeoutMs: DEFAULT_TEXT_TIMEOUT_MS },
  );

  const summaryMessage: ChatMessage = {
    role: 'summary',
    content: result.text,
    ts: new Date().toISOString(),
  };

  const { rotatedTo } = await rewriteChatMessages(
    name,
    [summaryMessage, ...verbatim],
    env,
  );

  writeLine(
    stdout,
    JSON.stringify(
      {
        ok: true,
        action: 'compact',
        name,
        summarized_messages: toSummarize.length,
        kept_messages: verbatim.length,
        target_tokens: targetTokens ?? null,
        rotated_to: rotatedTo,
        summary_chars: result.text.length,
      },
      null,
      2,
    ),
  );
}

export type { ChatMessage, SessionMeta };
