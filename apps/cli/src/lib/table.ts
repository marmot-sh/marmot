// Tiny ASCII-table helper for setup walks.
//
// Computes column widths from the actual data so values never collide with
// neighboring columns (the "People Data Labsoff" problem). Pass headers as
// the first row; pass `divider: true` to render a `─` rule under it.

export type FormatTableOptions = {
  /** Spaces between columns. Default 2. */
  gap?: number;
  /** Render an `─` divider after the first row (treats it as the header). */
  divider?: boolean;
};

export function formatTable(
  rows: readonly (readonly string[])[],
  opts: FormatTableOptions = {},
): string {
  if (rows.length === 0) return '';
  const gap = opts.gap ?? 2;
  const colCount = Math.max(...rows.map((r) => r.length));
  const widths = new Array<number>(colCount).fill(0);
  for (const row of rows) {
    for (let i = 0; i < colCount; i += 1) {
      widths[i] = Math.max(widths[i] ?? 0, (row[i] ?? '').length);
    }
  }

  const renderRow = (row: readonly string[]): string => {
    const parts: string[] = [];
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? '';
      // Last column doesn't need trailing pad.
      if (i === colCount - 1) {
        parts.push(cell);
      } else {
        parts.push(cell.padEnd(widths[i]! + gap));
      }
    }
    return parts.join('').trimEnd();
  };

  const lines: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    lines.push(renderRow(rows[i]!));
    if (opts.divider && i === 0) {
      const totalWidth =
        widths.reduce((sum, w) => sum + w, 0) + gap * (colCount - 1);
      lines.push('─'.repeat(totalWidth));
    }
  }
  return lines.join('\n');
}
