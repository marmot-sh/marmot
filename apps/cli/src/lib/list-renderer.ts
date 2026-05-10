/**
 * Shared rendering for list/show commands. Three output modes:
 *
 *   - human    → column-aligned text with dimmed headers (TTY default).
 *   - json     → today's structured envelope. Preserved exactly so any
 *                downstream tooling consuming the JSON keeps working.
 *   - markdown → standard pipe-table syntax for embedding in docs.
 *
 * Used by preset list/show, session list/show, providers list,
 * tasks list/show. Adopting this module is the substantive UX change in
 * 0.7.2 — every supported command goes through one renderer so the
 * experience is consistent.
 */
import ansis from 'ansis';

export type RenderMode = 'human' | 'json' | 'markdown';

export type Column<T> = {
  /** Field key used for default extraction (`row[key]`) and as the JSON column name. */
  key: string;
  /** Header label rendered in human/markdown table. */
  header: string;
  /** Custom formatter for the cell value. Defaults to `String(row[key] ?? '—')`. */
  format?: (row: T) => string;
  /** Column alignment in human/markdown output. */
  align?: 'left' | 'right';
};

export type RenderListOptions<T> = {
  rows: readonly T[];
  columns: readonly Column<T>[];
  mode: RenderMode;
  /**
   * Top-level key for the JSON envelope (e.g. 'presets', 'sessions',
   * 'tasks'). Output: `{ [envelopeKey]: rows, ...meta }`.
   */
  envelopeKey: string;
  /** Optional extra fields to merge into the JSON envelope (totals, pagination). */
  meta?: Record<string, unknown>;
  /** Shown in human/markdown when rows is empty. JSON returns the empty array. */
  emptyMessage?: string;
  /** Optional footer line rendered after the table in human mode (pagination hints). */
  footer?: string;
};

export type Section<T> = {
  title: string;
  /** Keys from the record displayed in this section. */
  keys: readonly (keyof T & string)[];
  /** Optional per-key formatter override. Defaults to JSON.stringify for non-strings. */
  format?: (key: string, value: unknown) => string;
};

export type RenderRecordOptions<T extends Record<string, unknown>> = {
  record: T;
  mode: RenderMode;
  /** Top-level key for the JSON envelope. */
  envelopeKey: string;
  /** Section grouping for human/markdown rendering. Ignored in JSON. */
  sections?: readonly Section<T>[];
  /** Title shown above the human/markdown rendering. */
  title?: string;
};

/* -------------------------------------------------------------------- */
/* renderList                                                           */
/* -------------------------------------------------------------------- */

export function renderList<T>(opts: RenderListOptions<T>): string {
  switch (opts.mode) {
    case 'json':
      return renderListJson(opts);
    case 'markdown':
      return renderListMarkdown(opts);
    case 'human':
    default:
      return renderListHuman(opts);
  }
}

function renderListJson<T>(opts: RenderListOptions<T>): string {
  const envelope: Record<string, unknown> = {
    [opts.envelopeKey]: opts.rows,
    ...(opts.meta ?? {}),
  };
  return JSON.stringify(envelope, null, 2);
}

function defaultCell<T>(col: Column<T>, row: T): string {
  if (col.format) return col.format(row);
  const value = (row as unknown as Record<string, unknown>)[col.key];
  if (value === undefined || value === null) return '—';
  return String(value);
}

function renderListHuman<T>(opts: RenderListOptions<T>): string {
  const { rows, columns, emptyMessage, footer } = opts;
  if (rows.length === 0) {
    return emptyMessage ?? 'No entries.';
  }

  const cells: string[][] = rows.map((row) => columns.map((c) => defaultCell(c, row)));
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...cells.map((row) => stripAnsi(row[i] ?? '').length)),
  );

  const headerLine = columns
    .map((c, i) => ansis.dim(pad(c.header, widths[i] ?? 0, c.align)))
    .join('  ');
  const bodyLines = cells.map((row) =>
    columns.map((c, i) => pad(row[i] ?? '', widths[i] ?? 0, c.align)).join('  '),
  );

  const lines = [headerLine, ...bodyLines];
  if (footer) lines.push('', ansis.dim(footer));
  return lines.join('\n');
}

function renderListMarkdown<T>(opts: RenderListOptions<T>): string {
  const { rows, columns, emptyMessage } = opts;
  if (rows.length === 0) {
    return emptyMessage ?? '_No entries._';
  }

  const escape = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const headerRow = `| ${columns.map((c) => escape(c.header)).join(' | ')} |`;
  const sepRow = `| ${columns.map((c) => (c.align === 'right' ? '---:' : '---')).join(' | ')} |`;
  const dataRows = rows.map((row) =>
    `| ${columns.map((c) => escape(stripAnsi(defaultCell(c, row)))).join(' | ')} |`,
  );
  return [headerRow, sepRow, ...dataRows].join('\n');
}

/* -------------------------------------------------------------------- */
/* renderRecord                                                         */
/* -------------------------------------------------------------------- */

export function renderRecord<T extends Record<string, unknown>>(
  opts: RenderRecordOptions<T>,
): string {
  switch (opts.mode) {
    case 'json':
      return renderRecordJson(opts);
    case 'markdown':
      return renderRecordMarkdown(opts);
    case 'human':
    default:
      return renderRecordHuman(opts);
  }
}

function renderRecordJson<T extends Record<string, unknown>>(
  opts: RenderRecordOptions<T>,
): string {
  return JSON.stringify({ [opts.envelopeKey]: opts.record }, null, 2);
}

function formatRecordValue(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function renderRecordHuman<T extends Record<string, unknown>>(
  opts: RenderRecordOptions<T>,
): string {
  const { record, sections, title } = opts;
  const lines: string[] = [];
  if (title) lines.push(ansis.bold(title), '');

  if (sections && sections.length > 0) {
    for (const section of sections) {
      lines.push(ansis.dim(section.title));
      const pairs: Array<[string, string]> = [];
      for (const key of section.keys) {
        const value = record[key];
        if (value === undefined) continue;
        const rendered = section.format ? section.format(key, value) : formatRecordValue(value);
        pairs.push([key, rendered]);
      }
      if (pairs.length === 0) {
        lines.push(`  (none)`, '');
        continue;
      }
      const labelWidth = Math.max(...pairs.map(([k]) => k.length));
      for (const [k, v] of pairs) {
        // Multi-line values indent continuation lines under the value column.
        const indent = ' '.repeat(labelWidth + 4);
        const formatted = v.split('\n').map((line, i) => (i === 0 ? line : `${indent}${line}`)).join('\n');
        lines.push(`  ${pad(k, labelWidth, 'left')}  ${formatted}`);
      }
      lines.push('');
    }
    // Drop trailing blank.
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  // Sections-less fallback: dump every key.
  const pairs = Object.entries(record).filter(([, v]) => v !== undefined);
  if (pairs.length === 0) return lines.join('\n') + '(empty)';
  const labelWidth = Math.max(...pairs.map(([k]) => k.length));
  for (const [k, v] of pairs) {
    lines.push(`  ${pad(k, labelWidth, 'left')}  ${formatRecordValue(v)}`);
  }
  return lines.join('\n');
}

function renderRecordMarkdown<T extends Record<string, unknown>>(
  opts: RenderRecordOptions<T>,
): string {
  const { record, sections, title } = opts;
  const lines: string[] = [];
  if (title) lines.push(`## ${title}`, '');

  const escape = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

  const renderTable = (pairs: Array<[string, string]>): string[] => {
    if (pairs.length === 0) return ['_(none)_'];
    return [
      `| Field | Value |`,
      `| --- | --- |`,
      ...pairs.map(([k, v]) => `| ${escape(k)} | ${escape(v)} |`),
    ];
  };

  if (sections && sections.length > 0) {
    for (const section of sections) {
      lines.push(`### ${section.title}`, '');
      const pairs: Array<[string, string]> = [];
      for (const key of section.keys) {
        const value = record[key];
        if (value === undefined) continue;
        const rendered = section.format ? section.format(key, value) : formatRecordValue(value);
        pairs.push([key, rendered]);
      }
      lines.push(...renderTable(pairs), '');
    }
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  const pairs = Object.entries(record)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, formatRecordValue(v)] as [string, string]);
  lines.push(...renderTable(pairs));
  return lines.join('\n');
}

/* -------------------------------------------------------------------- */
/* helpers                                                              */
/* -------------------------------------------------------------------- */

function pad(value: string, width: number, align: 'left' | 'right' = 'left'): string {
  const visible = stripAnsi(value).length;
  const padLen = Math.max(0, width - visible);
  return align === 'right' ? `${' '.repeat(padLen)}${value}` : `${value}${' '.repeat(padLen)}`;
}
// Strip CSI SGR sequences (ANSI color codes) so column widths reflect
// visible characters, not bytes. ESC byte is built dynamically to
// satisfy ESLint's no-control-regex rule.
const ESC = String.fromCharCode(27);
const ANSI_REGEX = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
function stripAnsi(s: string): string {
  return s.replace(ANSI_REGEX, '');
}
