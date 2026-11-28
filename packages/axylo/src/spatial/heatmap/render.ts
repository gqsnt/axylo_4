/**
 * Scene, SVG drawing, exact lookup and overlay of the heatmap.
 *
 * Scene: the cells are quantized into the scale's bins and every cell of one bin goes into one rectangle mark,
 * so the SVG holds one <path> per non-empty bin plus one for missing cells (single diagonal hatch) and one for
 * invalid cells (crossed), whatever the number of cells: a 250 × 200 matrix is at most bins + 2 paths. Where
 * cells are too small to separate (no inset), horizontal runs of one bin in a row merge into one rectangle.
 *
 * Lookup: O(1) arithmetic from a pixel to (row, column) and back; every reading comes from the frame's exact
 * values, never from a bin. Keyboard: a non-wrapping 2D grid (left/right along a row, up/down along a column).
 */
import {
  SLOT_INVALID, SLOT_NULL, SLOT_VALUE,
  type AlignedView, type DatumRef, type DatumText, type Formatters, type Layout, type Lookup, type Mark, type PaintBindings,
  type PickTarget, type Rect, type RectMark, type RuleMark, type Scene, type SlotState, type StepDirection, type TooltipModel, type View,
} from '../../core/contracts';
import type { OverlayInput } from '../../core/focus';
import type { Messages } from '../../public';
import { svgRule, svgRects, type SvgMark, type SvgMarks } from '../../render/svg';
import { binColor } from '../color-scale';
import { cellGeometry, type CellGeometry } from './layout';
import { invalidText, matrixOf, NO_BIN, type MatrixFrame } from './core';

/** Rows moved by Page Up and Page Down. */
export const PAGE_ROWS = 8;
export const INVALID_TEXT = 'Invalid value';
export const DUPLICATE_TEXT = 'duplicate rows not drawn';

/** The paints of missing and invalid cells: the muted token, or the system text color in forced colors. */
export const MISSING_PAINT = 'var(--axylo-forced-series, var(--axylo-muted, var(--axylo-default-muted)))';
export const INVALID_PAINT = 'var(--axylo-forced-series, var(--axylo-text, currentColor))';

export type CellTag =
  | { readonly kind: 'bin'; readonly bin: number; readonly color: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid' };

let tags: WeakMap<Mark, CellTag> | undefined;

/** What a heatmap mark is: a color bin, the missing cells or the invalid cells. */
export function cellTagOf(mark: Mark): CellTag | undefined {
  return tags?.get(mark);
}

function tagged(mark: RectMark, tag: CellTag): RectMark {
  (tags ??= new WeakMap()).set(mark, tag);
  return mark;
}

function rects(xywh: Float32Array): RectMark {
  // Variant 'missing' gives each mark a single <path> slot in the SVG renderer (a 'bar' is a group of rects).
  return { type: 'rects', series: 0, xywh, fill: { kind: 'series', index: 0 }, variant: 'missing' };
}

const matrixOfView = (view: View): MatrixFrame | undefined =>
  view.kind === 'donut' || view.kind === 'scatter' ? undefined : matrixOf(view.frame);

function emptyScene(layout: Layout): Scene {
  const { width, height } = layout;
  return { width, height, clip: { x: 0, y: 0, width, height }, marks: [] };
}

export function buildHeatmapScene(view: View, layout: Layout, _dpr: number): Scene {
  const m = matrixOfView(view);
  const g = m ? cellGeometry(layout, m) : null;
  if (!m || !g || m.domain === null && m.missingCount === 0 && m.invalidCount === 0) return emptyScene(layout);
  const { rows, cols, bin, state } = m;
  const bins = m.domain?.bins ?? 0;
  const merge = g.inset === 0;
  // Pass 1: rectangles per bin (runs when merging), and missing / invalid counts.
  const counts = new Uint32Array(bins);
  let missing = 0, invalid = 0;
  for (let r = 0; r < rows; r++) {
    let previous = NO_BIN;
    for (let c = 0, cell = r * cols; c < cols; c++, cell++) {
      const b = bin[cell]!;
      if (b !== NO_BIN) {
        if (!merge || b !== previous) counts[b]!++;
      } else if (state[cell] === SLOT_INVALID) invalid++;
      else missing++;
      previous = b;
    }
  }
  const buffers: Float32Array[] = [];
  for (let b = 0; b < bins; b++) buffers.push(new Float32Array(counts[b]! * 4));
  const fill = new Uint32Array(bins);
  const missingBox = new Float32Array(missing * 4), invalidBox = new Float32Array(invalid * 4);
  let mi = 0, ii = 0;
  const { plot, cellWidth: cw, cellHeight: ch, inset } = g;
  for (let r = 0; r < rows; r++) {
    const y = plot.y + r * ch + inset, h = ch - 2 * inset;
    let previous = NO_BIN, runAt = 0;
    for (let c = 0, cell = r * cols; c < cols; c++, cell++) {
      const b = bin[cell]!;
      const x = plot.x + c * cw + inset, w = cw - 2 * inset;
      if (b !== NO_BIN) {
        if (merge && b === previous) {
          // Extend the run to the right edge of this cell.
          const buf = buffers[b]!;
          buf[runAt + 2] = x + w - buf[runAt]!;
        } else {
          const buf = buffers[b]!, at = fill[b]!;
          buf[at] = x; buf[at + 1] = y; buf[at + 2] = w; buf[at + 3] = h;
          runAt = at;
          fill[b] = at + 4;
        }
      } else if (state[cell] === SLOT_INVALID) {
        invalidBox[ii++] = x; invalidBox[ii++] = y; invalidBox[ii++] = w; invalidBox[ii++] = h;
      } else {
        missingBox[mi++] = x; missingBox[mi++] = y; missingBox[mi++] = w; missingBox[mi++] = h;
      }
      previous = b;
    }
  }
  const marks: Mark[] = [];
  const scheme = m.meta.scheme;
  for (let b = 0; b < bins; b++) {
    if (counts[b]! > 0) marks.push(tagged(rects(buffers[b]!), { kind: 'bin', bin: b, color: binColor(scheme, b, bins) }));
  }
  if (missing) marks.push(tagged(rects(missingBox), { kind: 'missing' }));
  if (invalid) marks.push(tagged(rects(invalidBox), { kind: 'invalid' }));
  return { width: layout.width, height: layout.height, clip: plot, marks };
}

// ───────────────────────────── SVG ─────────────────────────────

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** One closed rectangle per quadruple: `M x y h w v h h -w z`. */
export function cellPath(xywh: Float32Array): string {
  let d = '';
  for (let i = 0; i < xywh.length; i += 4) {
    const w = num(xywh[i + 2]!);
    d += `M${num(xywh[i]!)} ${num(xywh[i + 1]!)}h${w}v${num(xywh[i + 3]!)}h-${w}z`;
  }
  return d;
}

/** Outline plus one diagonal per cell (missing), or both diagonals (invalid): strokes only, never a fill. */
export function hatchPath(xywh: Float32Array, crossed: boolean): string {
  let d = '';
  for (let i = 0; i < xywh.length; i += 4) {
    const x = num(xywh[i]!), y = xywh[i + 1]!, w = num(xywh[i + 2]!), h = xywh[i + 3]!;
    const ys = num(y), hs = num(h), bottom = num(y + h);
    d += `M${x} ${ys}h${w}v${hs}h-${w}zM${x} ${bottom}l${w} -${hs}`;
    if (crossed) d += `M${x} ${ys}l${w} ${hs}`;
  }
  return d;
}

function setStyle(el: SVGElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

/**
 * Draws a heatmap mark into its <path>: the bins filled through `color` (a live CSS expression), missing and
 * invalid cells stroked. Path data is rebuilt only for a new geometry array (scene arrays are never mutated).
 * Anything else (a mark not made by the heatmap scene) falls back to the shared handler.
 */
export const heatmapRects: SvgMark<RectMark> = (c, n, mark, bindings, dpr, clip) => {
  const tag = cellTagOf(mark);
  if (!tag) { svgRects(c, n, mark, bindings, dpr, clip); return; }
  const el = n.el;
  const source = n.source ??= [];
  if (source[0] !== mark.xywh || source[1] !== tag.kind) {
    el.setAttribute('d', tag.kind === 'bin' ? cellPath(mark.xywh) : hatchPath(mark.xywh, tag.kind === 'invalid'));
    source[0] = mark.xywh;
    source[1] = tag.kind;
  }
  const cls = tag.kind === 'bin' ? `axylo-heatmap-bin axylo-heatmap-bin-${tag.bin}` : `axylo-heatmap-${tag.kind}`;
  if (el.getAttribute('class') !== cls) el.setAttribute('class', cls);
  if (tag.kind === 'bin') {
    setStyle(el, 'color', tag.color);
    setStyle(el, 'fill', 'currentColor');
    setStyle(el, 'stroke', 'none');
  } else {
    setStyle(el, 'color', tag.kind === 'missing' ? MISSING_PAINT : INVALID_PAINT);
    setStyle(el, 'fill', 'none');
    setStyle(el, 'stroke', 'currentColor');
    if (el.getAttribute('stroke-width') !== '1') el.setAttribute('stroke-width', '1');
  }
};

export const heatmapSvgMarks: SvgMarks = { rects: heatmapRects, rule: svgRule };

// ───────────────────────────── lookup ─────────────────────────────

/** The reference of a cell. The x of a point ref is the cell index (row-major); `row` its source row or -1. */
export function cellRef(view: AlignedView, m: MatrixFrame, cell: number): DatumRef {
  return { kind: 'point', seriesKey: view.frame.series[0]!.key, row: m.source[cell]!, x: cell };
}

export function cellOf(m: MatrixFrame, ref: DatumRef | null): number {
  if (!ref || ref.kind !== 'point') return -1;
  const cell = ref.x;
  return Number.isInteger(cell) && cell >= 0 && cell < m.rows * m.cols && m.source[cell] === ref.row ? cell : -1;
}

/**
 * The exact text of a cell's value: its value with full precision, "No data", or "Invalid value (raw)"; a
 * duplicate cell (AX182) also names the rows that were not drawn, so tooltip, keyboard and table all show them.
 */
export function cellValueText(m: MatrixFrame, cell: number, formatters: Formatters): string {
  const s = m.state[cell]!;
  const text = s === SLOT_VALUE ? formatters.value(0, m.values[cell]!)
    : s === SLOT_INVALID ? `${INVALID_TEXT} (${m.invalidText.get(cell) ?? '?'})`
    : formatters.missing(SLOT_NULL);
  const dup = m.duplicates.get(cell);
  if (!dup) return text;
  const shown = dup.values.map(v => (typeof v === 'number' && Number.isFinite(v) ? formatters.value(0, v)
    : v === null || v === undefined || v === '' ? formatters.missing(SLOT_NULL) : invalidText(v)));
  const more = dup.count > shown.length ? `, +${formatters.count(dup.count - shown.length)}` : '';
  return `${text} (${DUPLICATE_TEXT}: ${shown.join(', ')}${more})`;
}

export function cellBox(g: CellGeometry, cell: number): Rect {
  const r = Math.floor(cell / g.cols), c = cell - r * g.cols;
  return { x: g.plot.x + c * g.cellWidth, y: g.plot.y + r * g.cellHeight, width: g.cellWidth, height: g.cellHeight };
}

/** The cell `direction` leads to from `cell`, or null at the edge (the grid does not wrap). */
export function stepCell(rows: number, cols: number, cell: number, direction: StepDirection): number | null {
  const r = Math.floor(cell / cols), c = cell - r * cols;
  let nr = r, nc = c;
  switch (direction) {
    case 'next': nc = c + 1; break;
    case 'previous': nc = c - 1; break;
    case 'series-next': nr = r + 1; break;
    case 'series-previous': nr = r - 1; break;
    case 'first': nc = 0; break;
    case 'last': nc = cols - 1; break;
    // Page Up (page-next) moves up a page of rows and Page Down down, as in a grid (WAI-ARIA grid pattern).
    case 'page-next': nr = Math.max(0, r - PAGE_ROWS); break;
    case 'page-previous': nr = Math.min(rows - 1, r + PAGE_ROWS); break;
  }
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return null;
  const to = nr * cols + nc;
  return to === cell ? null : to;
}

export function createHeatmapLookup(
  view: View, layout: Layout, formatters: Formatters, messages: Messages,
): Lookup {
  const m = matrixOfView(view);
  const aligned = view as AlignedView;
  const g = m ? cellGeometry(layout, m) : null;
  const total = m ? m.rows * m.cols : 0;
  const ref = (cell: number): DatumRef => cellRef(aligned, m!, cell);
  const position = (cell: number) => {
    const r = Math.floor(cell / m!.cols);
    return { r, c: cell - r * m!.cols };
  };
  const text = (cell: number, withPosition: boolean): DatumText => {
    const { r, c } = position(cell);
    const rowKey = m!.yKeys[r]!, colKey = m!.xKeys[c]!;
    const seriesLabel = withPosition ? `${m!.meta.yLabel} ${rowKey} (row ${formatters.count(r + 1)} of ${formatters.count(m!.rows)})` : m!.meta.valueLabel;
    const x = withPosition ? `${m!.meta.xLabel} ${colKey} (column ${formatters.count(c + 1)} of ${formatters.count(m!.cols)})` : `${rowKey}, ${colKey}`;
    return {
      ref: ref(cell), seriesIndex: 0, seriesLabel, x, value: cellValueText(m!, cell, formatters),
      state: m!.state[cell] as SlotState, percent: null, row: m!.source[cell]!,
    };
  };
  const pick = (px: number, py: number): PickTarget | null => {
    if (!g || total === 0) return null;
    const { plot } = g;
    // Up to 1 CSS px outside the plot picks the nearest edge cell (contract: pointer positions are whole pixels).
    if (px < plot.x - 1 || px > plot.x + plot.width + 1 || py < plot.y - 1 || py > plot.y + plot.height + 1) return null;
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor((px - plot.x) / g.cellWidth)));
    const r = Math.min(g.rows - 1, Math.max(0, Math.floor((py - plot.y) / g.cellHeight)));
    return { kind: 'point', refs: [ref(r * g.cols + c)], count: 1 };
  };
  const targetCell = (target: PickTarget): number => {
    if (!m) return -1;
    if (target.kind === 'point') return cellOf(m, target.refs[0] ?? null);
    if (target.kind === 'x') return Number.isInteger(target.x) && target.x >= 0 && target.x < total ? target.x : -1;
    return -1;
  };
  const emptyTooltip: TooltipModel = { title: '', rows: [], count: 0, total: null };
  void messages;
  return {
    pick,
    members(target, from, count) {
      const cell = targetCell(target);
      return cell >= 0 && from <= 0 && count > 0 ? [ref(cell)] : [];
    },
    has(target, r) {
      const cell = targetCell(target);
      return cell >= 0 && m !== undefined && cellOf(m, r) === cell;
    },
    slot: r => (m ? cellOf(m, r) : -1),
    tooltip(target) {
      const cell = targetCell(target);
      if (cell < 0) return emptyTooltip;
      const row = text(cell, false);
      return { title: row.x, rows: [row], count: 1, total: null };
    },
    primary(target) {
      const cell = targetCell(target);
      return cell >= 0 ? ref(cell) : null;
    },
    datum(r) {
      const cell = m ? cellOf(m, r) : -1;
      return cell >= 0 ? text(cell, true) : null;
    },
    anchor(r) {
      const cell = m ? cellOf(m, r) : -1;
      return cell >= 0 && g ? cellBox(g, cell) : null;
    },
    count: total,
    ordinal: r => (m ? cellOf(m, r) : -1),
    step(from, direction) {
      if (!m || total === 0) return null;
      if (from === null) return ref(direction === 'last' ? total - 1 : 0);
      const cell = cellOf(m, from);
      if (cell < 0) return ref(0);
      const to = stepCell(m.rows, m.cols, cell, direction);
      return to === null ? null : ref(to);
    },
    resolve(r) {
      if (!m || r.kind !== 'point') return null;
      const cell = r.x;
      return Number.isInteger(cell) && cell >= 0 && cell < total ? ref(cell) : null;
    },
  };
}

// ───────────────────────────── overlay ─────────────────────────────

function outline(b: Rect, name: 'text' | 'background', width: number, gap: number, out: Mark[]): void {
  const x0 = b.x - gap, y0 = b.y - gap, x1 = b.x + b.width + gap, y1 = b.y + b.height + gap, h = width / 2;
  const rule = (x1_: number, y1_: number, x2: number, y2: number): RuleMark =>
    ({ type: 'rule', x1: x1_, y1: y1_, x2, y2, stroke: { kind: 'token', name }, strokeWidth: width, dash: null, role: 'cursor' });
  out.push(rule(x0 - h, y0, x1 + h, y0), rule(x1, y0 - h, x1, y1 + h), rule(x1 + h, y1, x0 - h, y1), rule(x0, y1 + h, x0, y0 - h));
}

/** The hovered or focused cell, outlined twice (background halo, then text color) so it shows on any bin color. */
export function heatmapTargetMarks(input: OverlayInput, _plot: Rect, clipped: Mark[]): void {
  const { lookup, target, ring } = input;
  const r = target?.kind === 'point' ? target.refs[0] ?? null : ring;
  if (!r) return;
  const b = lookup.anchor(r);
  if (!b) return;
  outline(b, 'background', 3, 0, clipped);
  outline(b, 'text', 1.5, 0, clipped);
}

export type { PaintBindings };
