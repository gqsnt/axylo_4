/**
 * The heatmap's text: the generated summary and the table (spec A4). The table is lazy (a row's cells are made
 * when the row is asked for) and unpaginated in the model; the DOM table pages it.
 *
 * Up to 24 columns the table is the matrix itself: one header per column (scope="col"), one row per heatmap
 * row, the row name as its header (scope="row"). Above 24 columns a screen-reader user would have to hold too
 * many column headers in mind, so the table switches to the long layout: one row per cell, (row, column, value).
 */
import type { Formatters, TableModel, View, XValue } from '../../core/contracts';
import type { ReaderParts } from '../../reader';
import { matrixOf, type MatrixFrame } from './core';
import { cellValueText } from './render';

/** Matrix layout up to this many columns; long (row, column, value) layout above. */
export const MATRIX_COLUMNS = 24;
export const TABLE_PAGE = 50;

export type TableLayout = 'matrix' | 'long';

export function tableLayoutOf(m: MatrixFrame): TableLayout {
  return m.cols <= MATRIX_COLUMNS ? 'matrix' : 'long';
}

const matrixOfView = (view: View): MatrixFrame | undefined =>
  view.kind === 'donut' || view.kind === 'scatter' ? undefined : matrixOf(view.frame);

function keyOf(x: XValue): string {
  return x instanceof Date ? x.toISOString() : String(x);
}

export function heatmapTable(m: MatrixFrame, caption: string, formatters: Formatters): TableModel {
  const layout = tableLayoutOf(m);
  const { rows, cols, xKeys, yKeys, meta } = m;
  const rowIndex = (key: string) => yKeys.indexOf(key);
  if (layout === 'matrix') {
    return {
      caption, headers: [meta.yLabel, ...xKeys], rowCount: rows, pageSize: TABLE_PAGE,
      row(ordinal) {
        if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= rows) return null;
        const out: string[] = [yKeys[ordinal]!];
        for (let c = 0, cell = ordinal * cols; c < cols; c++, cell++) out.push(cellValueText(m, cell, formatters));
        return out;
      },
      pageForX(x) {
        const r = rowIndex(keyOf(x));
        return r < 0 ? null : Math.floor(r / TABLE_PAGE);
      },
    };
  }
  const total = rows * cols;
  return {
    caption, headers: [meta.yLabel, meta.xLabel, meta.valueLabel], rowCount: total, pageSize: TABLE_PAGE,
    row(ordinal) {
      if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= total) return null;
      const r = Math.floor(ordinal / cols), c = ordinal - r * cols;
      return [yKeys[r]!, xKeys[c]!, cellValueText(m, ordinal, formatters)];
    },
    pageForX(x) {
      const r = rowIndex(keyOf(x));
      return r < 0 ? null : Math.floor((r * cols) / TABLE_PAGE);
    },
  };
}

const EMPTY_TABLE = (caption: string): TableModel =>
  ({ caption, headers: [], rowCount: 0, pageSize: TABLE_PAGE, row: () => null, pageForX: () => null });

/**
 * The summary sentences after the chart's name. Nothing here names a hue or a lightness: the anchors are custom
 * properties a page may restyle, so only what holds for any palette is said. What the reader can do is said only
 * when the chart offers it: focus readings need the interactive (not compact) chart, the table needs `table`.
 */
export function heatmapSummary(m: MatrixFrame, formatters: Formatters, table: boolean, interactive = true): string[] {
  const { meta, rows, cols } = m;
  const count = formatters.count;
  const out = [
    `Heatmap of ${meta.valueLabel} by ${meta.yLabel} (${count(rows)} ${rows === 1 ? 'row' : 'rows'}) and ${meta.xLabel} `
      + `(${count(cols)} ${cols === 1 ? 'column' : 'columns'}), ${count(rows * cols)} cells.`,
  ];
  if (m.valueCount > 0) {
    out.push(`${meta.valueLabel} from ${formatters.value(0, m.min)} to ${formatters.value(0, m.max)}.`);
  } else {
    out.push('No cell has a value.');
  }
  if (m.missingCount > 0) out.push(`${count(m.missingCount)} ${m.missingCount === 1 ? 'cell has' : 'cells have'} no data (hatched).`);
  if (m.invalidCount > 0) out.push(`${count(m.invalidCount)} ${m.invalidCount === 1 ? 'cell has an invalid value' : 'cells have invalid values'} (crossed out).`);
  const d = m.domain;
  if (d) {
    out.push(d.scheme === 'diverging'
      ? `Colors diverge from ${formatters.value(0, d.mid)}, one color toward ${formatters.value(0, d.lo)} and another toward ${formatters.value(0, d.hi)}, in ${d.bins} steps.`
      : `Colors run in ${d.bins} steps from ${formatters.value(0, d.lo)} to ${formatters.value(0, d.hi)}.`);
  }
  // Color never carries a value alone (spec A5); in forced colors it carries none at all.
  const where = [interactive ? 'each cell\'s exact value is read when it is focused' : '', table ? 'every value is in the table' : '']
    .filter(Boolean).join(', and ');
  out.push(where ? `Color shows an approximate range only: ${where}.` : 'Color shows an approximate range only.');
  return out;
}

/** The heatmap's reader: stateless, so the table it builds is reachable only through the committed reader. */
export const heatmapReader: ReaderParts = {
  table(view, caption, formatters) {
    const m = matrixOfView(view);
    return m ? heatmapTable(m, caption, formatters) : EMPTY_TABLE(caption);
  },
  text(input, _type, _xLabel, _yLabel, table) {
    const m = matrixOfView(input.view);
    return m ? heatmapSummary(m, input.formatters, table, input.compact !== true && !(input.view.kind !== 'donut' && input.view.compact)) : [];
  },
};
