/**
 * Layout of the heatmap plot: row labels on the left, column labels below (rotated when they do not fit across
 * a cell, thinned to every k-th when they do not fit at all), axis titles, and a band projection that maps a
 * column to x and a row to y. Thinning keeps the grid's order (row and column are positions in a matrix, so
 * the axes count as ordered, spec L1); every label stays in the table and in each cell's reading.
 */
import type { AxisLabelFit, DiagnosticInput, Layout, LabelRemedy, PlacedText, Rect, TextMeasurer, TextStyle, Tick, View } from '../../core/contracts';
import { baseLayoutKey, type LayoutStage } from '../../core/composition';
import { placeText, type Metrics } from '../../layout/labels';
import { bandScale } from '../../scale/band';
import { linearScale } from '../../scale/linear';
import { heatmapDiagnostic, matrixOf, type MatrixFrame } from './core';

const PAD = 6;
const TICK_GAP = 4;
const MIN_PLOT_WIDTH = 120;
const MIN_PLOT_HEIGHT = 80;
/** Labels are measured on at most this many keys per axis; the rest are assumed no wider than the widest seen. */
const MEASURED = 512;

type PlotLayout = Extract<Layout, { kind: 'plot' }>;

export interface CellGeometry {
  readonly plot: Rect;
  readonly rows: number;
  readonly cols: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** Inset on each side of a cell, so cells big enough to tell apart are separated by the background. */
  readonly inset: number;
}

/** The cell grid of a plot layout. */
export function cellGeometry(layout: Layout, m: MatrixFrame): CellGeometry | null {
  if (layout.kind !== 'plot' || m.rows === 0 || m.cols === 0) return null;
  const plot = layout.plot;
  const cellWidth = plot.width / m.cols, cellHeight = plot.height / m.rows;
  const inset = cellWidth >= 6 && cellHeight >= 6 ? 0.5 : 0;
  return { plot, rows: m.rows, cols: m.cols, cellWidth, cellHeight, inset };
}

function truncate(text: string, limit: number, metrics: Metrics): string {
  if (metrics.width(text) <= limit) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (metrics.width(text.slice(0, mid) + '…') <= limit) lo = mid; else hi = mid - 1;
  }
  return lo === 0 ? '' : text.slice(0, lo) + '…';
}

function widest(keys: readonly string[], metrics: Metrics): number {
  let w = 0;
  for (let i = 0; i < keys.length && i < MEASURED; i++) w = Math.max(w, metrics.width(keys[i]!));
  return w;
}

function fitOf(step: number, truncated: boolean): AxisLabelFit {
  const remedies: LabelRemedy[] = [];
  if (step > 1) remedies.push('thinned');
  if (truncated) remedies.push('truncated');
  return { remedies, hidden: 0 };
}

export function computeHeatmapLayout(
  view: View, size: { readonly width: number; readonly height: number },
  text: { readonly measurer: TextMeasurer; readonly style: TextStyle },
): Layout {
  const { width, height } = size;
  const m = view.kind === 'donut' || view.kind === 'scatter' ? undefined : matrixOf(view.frame);
  if (!m || m.rows === 0 || m.cols === 0) return { kind: 'too-small', width, height };
  const metrics: Metrics = { lineHeight: text.style.lineHeight, width: t => text.measurer.width(t, text.style) };
  const lh = metrics.lineHeight;
  const texts: PlacedText[] = [];

  const rowLimit = Math.max(24, Math.min(160, width * 0.28));
  const rowWidth = Math.min(rowLimit, widest(m.yKeys, metrics));
  const left = PAD + lh + PAD + rowWidth + TICK_GAP;
  const right = PAD;
  const plotWidth = width - left - right;
  if (plotWidth < MIN_PLOT_WIDTH) return { kind: 'too-small', width, height };
  const cellWidth = plotWidth / m.cols;

  const colWidest = widest(m.xKeys, metrics);
  // Across when every label fits its cell; else rotated (read bottom to top) and thinned to the line height.
  const across = colWidest + 2 <= cellWidth;
  const colLimit = Math.min(120, Math.max(24, height * 0.3));
  const colSpan = across ? lh : Math.min(colLimit, colWidest);
  const colStep = across ? 1 : Math.max(1, Math.ceil(lh / cellWidth));
  const top = PAD;
  const bottom = TICK_GAP + colSpan + PAD + lh + PAD;
  const plotHeight = height - top - bottom;
  if (plotHeight < MIN_PLOT_HEIGHT) return { kind: 'too-small', width, height };
  const cellHeight = plotHeight / m.rows;
  const rowStep = Math.max(1, Math.ceil(lh / cellHeight));
  const plot: Rect = { x: left, y: top, width: plotWidth, height: plotHeight };

  const xTicks: Tick[] = [];
  let colTruncated = false;
  for (let c = 0; c < m.cols; c += colStep) {
    const full = m.xKeys[c]!;
    const shown = across ? full : truncate(full, colSpan, metrics);
    if (shown !== full) colTruncated = true;
    xTicks.push({ value: c, label: full });
    if (!shown) continue;
    const cx = left + (c + 0.5) * cellWidth, ty = top + plotHeight + TICK_GAP;
    texts.push(across
      ? placeText([shown], full, cx, ty, 'middle', 'top', 0, 'tick-x', metrics)
      : placeText([shown], full, cx, ty, 'end', 'middle', -90, 'tick-x', metrics));
  }
  const yTicks: Tick[] = [];
  let rowTruncated = false;
  for (let r = 0; r < m.rows; r += rowStep) {
    const full = m.yKeys[r]!;
    const shown = truncate(full, rowWidth, metrics);
    if (shown !== full) rowTruncated = true;
    yTicks.push({ value: r, label: full });
    if (!shown) continue;
    texts.push(placeText([shown], full, left - TICK_GAP, top + (r + 0.5) * cellHeight, 'end', 'middle', 0, 'tick-y', metrics));
  }
  const xTitle = truncate(m.meta.xLabel, plotWidth, metrics);
  if (xTitle) texts.push(placeText([xTitle], m.meta.xLabel, left + plotWidth / 2, height - PAD, 'middle', 'bottom', 0, 'title-x', metrics));
  const yTitle = truncate(m.meta.yLabel, plotHeight, metrics);
  if (yTitle) texts.push(placeText([yTitle], m.meta.yLabel, PAD + lh / 2, top + plotHeight / 2, 'middle', 'middle', -90, 'title-y', metrics));

  const layout: PlotLayout = {
    kind: 'plot', width, height, plot,
    projection: {
      kind: 'xy',
      x: bandScale(m.cols, [left, left + plotWidth], 0),
      y: linearScale([0, m.rows], [top, top + plotHeight]),
    },
    xTicks, yTicks, texts,
    fit: { x: fitOf(colStep, colTruncated), y: fitOf(rowStep, rowTruncated) },
  };
  return layout;
}

/** AX185, found when drawing: cells below one CSS px. Presentation origin: reported, never thrown. */
export function heatmapLayoutDiagnostics(view: View, layout: Layout): readonly DiagnosticInput[] {
  if (layout.kind !== 'plot' || view.kind === 'donut' || view.kind === 'scatter') return [];
  const m = matrixOf(view.frame);
  if (!m) return [];
  const g = cellGeometry(layout, m);
  if (!g || (g.cellWidth >= 1 && g.cellHeight >= 1)) return [];
  const w = Math.round(g.cellWidth * 100) / 100, h = Math.round(g.cellHeight * 100) / 100;
  return [heatmapDiagnostic('AX185', 'none', {
    count: m.rows * m.cols,
    detail: `Heatmap cells are ${w} × ${h} CSS px (${m.cols} columns by ${m.rows} rows in a ${Math.round(g.plot.width)} × ${Math.round(g.plot.height)} px plot), `
      + 'below 1 px, so neighbouring cells merge on screen. Exact values stay in the readings and the table; a larger chart or aggregated data shows every cell.',
  }, 'presentation')];
}

export const heatmapLayout: LayoutStage = {
  layoutKey: (view, size, style, fontEpoch, ctx) => [...baseLayoutKey(view, size, style, fontEpoch, ctx),
    view.kind === 'donut' || view.kind === 'scatter' ? null : view.frame],
  compute: (view, size, text) => computeHeatmapLayout(view, size, text),
  layoutDiagnostics: (view, _ctx, layout) => heatmapLayoutDiagnostics(view, layout),
};
