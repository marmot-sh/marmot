import { AICliError } from '@marmot-sh/core';
import { getMarmotConfigPath } from '@marmot-sh/core';
import {
  configFileExists,
  readMarmotConfig,
  writeMarmotConfig,
} from '@marmot-sh/core';
import {
  DATA_PROVIDERS,
  PROVIDERS,
  WEB_PROVIDERS,
  formatStaleDefaultsBanner,
  getReadyProviders,
  marmotConfigSchema,
  statsAll,
  warnText,
  type CacheStats,
  type MarmotConfig,
} from '@marmot-sh/core';
import { writeLine, type OutputWriter } from '@marmot-sh/core';

import { readStaleDefaults } from '../lib/stale-defaults.js';
import { MARMOT_VERSION } from '../lib/version.js';

export type ConfigCommandDependencies = {
  env?: NodeJS.ProcessEnv;
  stdout?: OutputWriter;
  stderr?: OutputWriter;
};

const AI_VERB_KEYS = [
  'text.provider',
  'text.model',
  'image.provider',
  'image.model',
  'speech.provider',
  'speech.model',
  'speech.voice',
  'transcription.provider',
  'transcription.model',
] as const;

const WEB_VERB_KEYS = [
  'search.provider',
  'scrape.provider',
  'answer.provider',
  'map.provider',
  'crawl.provider',
  'research.provider',
  'findall.provider',
] as const;

const DATA_VERB_KEYS = [
  'enrich.provider',
  'lookup.provider',
  'verify.provider',
] as const;

const ALL_PROVIDER_SLUGS = new Set<string>([
  ...PROVIDERS,
  ...WEB_PROVIDERS,
  ...DATA_PROVIDERS,
]);

const PROVIDER_SETTINGS_SUFFIXES = [
  'enabled',
  'apiKeyEnvVar',
  'apiSecretEnvVar',
  'cache.enabled',
  'cache.ttlDays',
] as const;

const PRICING_FIELDS = ['prompt', 'completion', 'request', 'image'] as const;

const LOGGING_KEYS = ['logging.enabled', 'logging.recordSensitive'] as const;

type ParsedKey =
  | { kind: 'verb-default'; segments: string[] }
  | { kind: 'provider-setting'; segments: string[] }
  | { kind: 'logging'; segments: string[] }
  | {
      kind: 'provider-pricing';
      slug: string;
      modelId: string;
      field: (typeof PRICING_FIELDS)[number];
      segments: string[];
    };

/**
 * Parse + validate a dotted-path config key. Four shapes accepted:
 *   - AI verb defaults: text.provider, image.model, speech.voice, ...
 *   - Web/data verb defaults: search.provider, enrich.provider, ...
 *   - Per-provider settings: providers.<slug>.{enabled,apiKeyEnvVar,
 *     apiSecretEnvVar,cache.enabled,cache.ttlDays}
 *   - Per-model pricing override: providers.<slug>.pricing.<modelId>.<field>
 *     where <field> is prompt|completion|request|image. Model id may contain
 *     dots (e.g. "gpt-4.1"); the parser treats everything between
 *     `pricing.` and the final `.<field>` as the model id.
 */
function parseKey(key: string): ParsedKey {
  if ((AI_VERB_KEYS as readonly string[]).includes(key)) {
    return { kind: 'verb-default', segments: ['defaults', ...key.split('.')] };
  }
  if ((WEB_VERB_KEYS as readonly string[]).includes(key)) {
    return { kind: 'verb-default', segments: ['defaults', ...key.split('.')] };
  }
  if ((DATA_VERB_KEYS as readonly string[]).includes(key)) {
    return { kind: 'verb-default', segments: ['defaults', ...key.split('.')] };
  }

  if ((LOGGING_KEYS as readonly string[]).includes(key)) {
    return { kind: 'logging', segments: key.split('.') };
  }

  if (key.startsWith('providers.')) {
    const rest = key.slice('providers.'.length);
    const firstDot = rest.indexOf('.');
    if (firstDot < 0) {
      throw new AICliError(
        'validation',
        `Provider key "${key}" must be of the form "providers.<slug>.<field>".`,
      );
    }
    const slug = rest.slice(0, firstDot);
    const suffix = rest.slice(firstDot + 1);

    if (!ALL_PROVIDER_SLUGS.has(slug)) {
      throw new AICliError(
        'validation',
        `Unknown provider slug "${slug}". Valid slugs: ${Array.from(ALL_PROVIDER_SLUGS).join(', ')}.`,
      );
    }

    if (suffix.startsWith('pricing.')) {
      const inner = suffix.slice('pricing.'.length);
      const lastDot = inner.lastIndexOf('.');
      if (lastDot < 0) {
        throw new AICliError(
          'validation',
          `Pricing key "${key}" must end in one of ${PRICING_FIELDS.join('|')} (e.g. providers.openai.pricing.gpt-4o.prompt).`,
        );
      }
      const modelId = inner.slice(0, lastDot);
      const field = inner.slice(lastDot + 1);
      if (!modelId) {
        throw new AICliError(
          'validation',
          `Pricing key "${key}" is missing a model id between "pricing." and ".${field}".`,
        );
      }
      if (!(PRICING_FIELDS as readonly string[]).includes(field)) {
        throw new AICliError(
          'validation',
          `Pricing field "${field}" is invalid. Valid: ${PRICING_FIELDS.join(', ')}.`,
        );
      }
      return {
        kind: 'provider-pricing',
        slug,
        modelId,
        field: field as (typeof PRICING_FIELDS)[number],
        segments: ['providers', slug, 'pricing', modelId, field],
      };
    }

    if (!(PROVIDER_SETTINGS_SUFFIXES as readonly string[]).includes(suffix)) {
      throw new AICliError(
        'validation',
        `Unknown provider setting "${suffix}". Valid suffixes: ${PROVIDER_SETTINGS_SUFFIXES.join(', ')}, or pricing.<modelId>.<${PRICING_FIELDS.join('|')}>.`,
      );
    }
    return { kind: 'provider-setting', segments: ['providers', slug, ...suffix.split('.')] };
  }

  throw new AICliError(
    'validation',
    `Unknown config key "${key}". Valid shapes: <verb>.<field> (e.g. text.model, search.provider), providers.<slug>.<setting> (e.g. providers.tavily.cache.enabled), providers.<slug>.pricing.<modelId>.<${PRICING_FIELDS.join('|')}>, or one of: ${LOGGING_KEYS.join(', ')}.`,
  );
}


/**
 * Coerce a raw string CLI value into the right type for the given path.
 * Booleans for `enabled` flags, integers for `ttlDays`, strings otherwise.
 */
function coerceValue(key: string, value: string): unknown {
  if (key.endsWith('.enabled') || key === 'logging.recordSensitive') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new AICliError(
      'validation',
      `${key} must be true or false (got "${value}").`,
    );
  }
  if (key.endsWith('.ttlDays')) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) {
      throw new AICliError(
        'validation',
        `${key} must be a positive integer (got "${value}").`,
      );
    }
    return n;
  }
  return value;
}

/**
 * Set a value at a path inside an object, creating intermediate
 * objects as needed.
 */
function setBySegments(
  root: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]!;
    if (typeof cursor[seg] !== 'object' || cursor[seg] === null) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]!] = value;
}

/**
 * Remove the leaf at a path. Walks up and removes empty parent
 * objects so the resulting config doesn't carry dead branches.
 */
function unsetBySegments(
  root: Record<string, unknown>,
  segments: readonly string[],
): boolean {
  const stack: Array<{ obj: Record<string, unknown>; key: string }> = [];
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]!;
    const next = cursor[seg];
    if (typeof next !== 'object' || next === null) return false;
    stack.push({ obj: cursor, key: seg });
    cursor = next as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1]!;
  if (!(leaf in cursor)) return false;
  delete cursor[leaf];
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    const { obj, key } = stack[i]!;
    const child = obj[key];
    if (
      typeof child === 'object'
      && child !== null
      && Object.keys(child as Record<string, unknown>).length === 0
    ) {
      delete obj[key];
    } else break;
  }
  return true;
}

type Row = { verb: string; provider: string; extras: string };

function buildRow(verb: string, value: Record<string, unknown> | undefined): Row {
  if (!value || Object.keys(value).length === 0) {
    return { verb, provider: '—', extras: '' };
  }
  const provider = (value as { provider?: string }).provider ?? '—';
  const parts: string[] = [];
  const model = (value as { model?: string }).model;
  const voice = (value as { voice?: string }).voice;
  if (model) parts.push(model);
  if (voice) parts.push(`voice ${voice}`);
  return { verb, provider, extras: parts.length ? parts.join(', ') : '' };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatCacheSummary(stats: CacheStats[]): string {
  const totalEntries = stats.reduce((acc, s) => acc + s.entries, 0);
  const totalBytes = stats.reduce((acc, s) => acc + s.bytes, 0);
  if (totalEntries === 0) {
    return '  (empty)';
  }
  const lines: string[] = [];
  lines.push(`  total: ${totalEntries} entries · ${formatBytes(totalBytes)}`);
  for (const s of stats) {
    if (s.entries === 0) continue;
    lines.push(`  ${s.provider.padEnd(12)} ${String(s.entries).padStart(4)} entries · ${formatBytes(s.bytes)}`);
  }
  return lines.join('\n');
}

function formatConfigHuman(
  config: MarmotConfig,
  configPath: string,
  cacheStats: CacheStats[],
  readyProviders: string[],
  marmotVersion: string,
): string {
  const defaults = config.defaults ?? {};
  // text, image, video, transcription, speech — matches the canonical
  // ordering used in docs and the docs nav. Adding `video` here closes
  // the 0.3.0 gap where the verb shipped but never appeared in the
  // human config-show output.
  const aiVerbs = ['text', 'image', 'video', 'transcription', 'speech'] as const;
  const webVerbs = ['search', 'scrape', 'research', 'answer', 'crawl', 'map', 'findall'] as const;
  // Data verbs (enrich/lookup/verify) are first-class everywhere else
  // in the CLI but have been invisible in `marmot config show` until
  // now. Surface them in their own section so users discover that
  // setting `defaults.enrich.provider` is even an option.
  const dataVerbs = ['enrich', 'lookup', 'verify'] as const;

  const aiRows = aiVerbs.map((v) =>
    buildRow(v, defaults[v] as Record<string, unknown> | undefined),
  );
  const webRows = webVerbs.map((v) =>
    buildRow(v, defaults[v] as Record<string, unknown> | undefined),
  );
  const dataRows = dataVerbs.map((v) =>
    buildRow(v, defaults[v] as Record<string, unknown> | undefined),
  );
  const allRows = [...aiRows, ...webRows, ...dataRows];

  // Auto-size each column to the longest entry across all sections.
  const verbW = Math.max(...allRows.map((r) => r.verb.length));
  const providerW = Math.max(...allRows.map((r) => r.provider.length));

  const renderRow = (r: Row): string => {
    const v = r.verb.padEnd(verbW);
    const p = r.provider.padEnd(providerW);
    const tail = r.extras ? `  ${r.extras}` : '';
    return `  ${v}  ${p}${tail}`;
  };

  const lines: string[] = [];
  lines.push(`marmot ${marmotVersion}`);
  lines.push(`config: ${configPath}`);
  lines.push('');
  lines.push('AI defaults:');
  for (const r of aiRows) lines.push(renderRow(r));
  lines.push('');
  lines.push('Web defaults:');
  for (const r of webRows) lines.push(renderRow(r));
  lines.push('');
  lines.push('Data defaults:');
  for (const r of dataRows) lines.push(renderRow(r));
  lines.push('');
  lines.push('Ready providers:');
  lines.push(formatReadyProviders(readyProviders));
  lines.push('');
  lines.push('Response cache:');
  lines.push(formatCacheSummary(cacheStats));
  lines.push('');
  lines.push('Tip: pass --json for the structured envelope.');
  return lines.join('\n');
}

/**
 * Render the ready provider slugs grouped by category. Reads which
 * category each slug belongs to from the canonical slug arrays
 * imported at the top of this module — same source of truth as
 * `listProviderSummaries`.
 */
function formatReadyProviders(slugs: string[]): string {
  if (slugs.length === 0) {
    return '  (none — set at least one provider key, e.g. `export OPENROUTER_API_KEY=...`)';
  }
  const aiSet = new Set<string>(PROVIDERS as readonly string[]);
  const webSet = new Set<string>(WEB_PROVIDERS as readonly string[]);
  const dataSet = new Set<string>(DATA_PROVIDERS as readonly string[]);
  const ai = slugs.filter((s) => aiSet.has(s));
  const web = slugs.filter((s) => webSet.has(s));
  const data = slugs.filter((s) => dataSet.has(s));
  const lines: string[] = [];
  if (ai.length > 0) lines.push(`  AI:    ${ai.join(', ')}`);
  if (web.length > 0) lines.push(`  Web:   ${web.join(', ')}`);
  if (data.length > 0) lines.push(`  Data:  ${data.join(', ')}`);
  return lines.join('\n');
}

export async function handleConfigShow(
  options: { json?: boolean } = {},
  dependencies: ConfigCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const config = (await readMarmotConfig(env)) ?? { version: 1 as const };
  const cacheStats = await statsAll(env);

  if (options.json) {
    const totalEntries = cacheStats.reduce((acc, s) => acc + s.entries, 0);
    const totalBytes = cacheStats.reduce((acc, s) => acc + s.bytes, 0);
    const stale = await readStaleDefaults(config, env);
    const readyProviders = getReadyProviders(config, env);
    writeLine(
      stdout,
      JSON.stringify(
        {
          marmotVersion: MARMOT_VERSION,
          ...config,
          readyProviders,
          cache: {
            totals: { entries: totalEntries, bytes: totalBytes },
            providers: cacheStats,
          },
          ...(stale.length > 0 ? { staleDefaults: stale } : {}),
        },
        null,
        2,
      ),
    );
  } else {
    // Stale-default banner goes to stderr so it doesn't pollute pipes that
    // are processing the human-formatted output, but is still seen by
    // anyone running the command interactively.
    const banner = formatStaleDefaultsBanner(await readStaleDefaults(config, env));
    if (banner) {
      stderr.write(`${warnText(banner)}\n\n`);
    }
    writeLine(
      stdout,
      formatConfigHuman(
        config,
        getMarmotConfigPath(env),
        cacheStats,
        getReadyProviders(config, env),
        MARMOT_VERSION,
      ),
    );
  }
}

export function handleConfigPath(
  dependencies: ConfigCommandDependencies = {},
): void {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;
  writeLine(stdout, getMarmotConfigPath(env));
}

export async function handleConfigInit(
  options: { force?: boolean } = {},
  dependencies: ConfigCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  // Use file-presence check (not parse) so a malformed existing file
  // still allows --force overwrite.
  const exists = await configFileExists(env);

  if (exists && !options.force) {
    writeLine(
      stdout,
      JSON.stringify(
        {
          ok: true,
          alreadyExists: true,
          path: getMarmotConfigPath(env),
          hint: 'Pass --force to overwrite, or run "marmot setup" to reconfigure interactively.',
        },
        null,
        2,
      ),
    );
    return;
  }

  const fresh: MarmotConfig = {
    version: 1,
    defaults: { text: {}, image: {} },
  };
  const path = await writeMarmotConfig(fresh, env);
  writeLine(
    stdout,
    JSON.stringify(
      { ok: true, alreadyExists: false, overwrote: exists, path },
      null,
      2,
    ),
  );
}

export async function handleConfigSet(
  key: string,
  value: string,
  dependencies: ConfigCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const parsed = parseKey(key);
  const coerced = coerceValue(key, value);
  const existing = (await readMarmotConfig(env)) ?? { version: 1 as const };

  const merged = JSON.parse(JSON.stringify(existing)) as Record<string, unknown>;
  merged.version = 1;
  setBySegments(merged, parsed.segments, coerced);

  // Validate before writing. Catches invalid slugs, value types, etc.
  const validated = marmotConfigSchema.safeParse(merged);
  if (!validated.success) {
    throw new AICliError(
      'validation',
      `Cannot set ${key}=${value}: ${validated.error.issues.map((i) => i.message).join(' ')}.`,
    );
  }

  const path = await writeMarmotConfig(validated.data, env);
  writeLine(
    stdout,
    JSON.stringify({ ok: true, key, value: coerced, path }, null, 2),
  );
}

export async function handleConfigUnset(
  key: string,
  dependencies: ConfigCommandDependencies = {},
): Promise<void> {
  const env = dependencies.env ?? process.env;
  const stdout = dependencies.stdout ?? process.stdout;

  const parsed = parseKey(key);
  const existing = await readMarmotConfig(env);
  if (!existing) {
    writeLine(stdout, JSON.stringify({ ok: true, key, removed: false }, null, 2));
    return;
  }

  const cloned = JSON.parse(JSON.stringify(existing)) as Record<string, unknown>;
  const removed = unsetBySegments(cloned, parsed.segments);

  if (!removed) {
    writeLine(stdout, JSON.stringify({ ok: true, key, removed: false }, null, 2));
    return;
  }

  const merged = marmotConfigSchema.parse(cloned);
  const path = await writeMarmotConfig(merged, env);
  writeLine(
    stdout,
    JSON.stringify({ ok: true, key, removed: true, path }, null, 2),
  );
}
