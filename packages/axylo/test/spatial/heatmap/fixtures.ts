/**
 * Heatmap fixtures and stage helpers for the Node tests. Data are written out here (not derived from the
 * implementation): `grid` makes a rows × cols matrix in long form with the value a function of (row, col).
 */
import type { AlignedView, Formatters, Layout, Lookup, Scene } from '../../../src/core/contracts';
import { createFormatters } from '../../../src/format';
import { defaultMessages } from '../../../src/messages';
import { resolveOptions } from '../../../src/data/options';
import { DiagnosticCollector } from '../../../src/diagnostics/collector';
import { buildHeatmapView, matrixOf, normalizeHeatmap, parseHeatmapInput, type MatrixFrame } from '../../../src/spatial/heatmap/core';
import { computeHeatmapLayout } from '../../../src/spatial/heatmap/layout';
import { buildHeatmapScene, createHeatmapLookup } from '../../../src/spatial/heatmap/render';

export type GridValue = number | null | undefined | string;

/** Long-form columns for a rows × cols grid: r = `r<i>`, c = `c<j>`, v = value(i, j). */
export function grid(rows: number, cols: number, value: (r: number, c: number) => GridValue): Record<string, unknown> {
  const n = rows * cols;
  const r = new Array<string>(n), c = new Array<string>(n), v = new Array<GridValue>(n);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const k = i * cols + j;
    r[k] = `r${i}`; c[k] = `c${j}`; v[k] = value(i, j);
  }
  return { columns: { r, c, v } };
}

/** The same grid with a typed value column (the dense fixture). */
export function typedGrid(rows: number, cols: number, value: (r: number, c: number) => number): Record<string, unknown> {
  const n = rows * cols;
  const r = new Array<string>(n), c = new Array<string>(n), v = new Float64Array(n);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const k = i * cols + j;
    r[k] = `r${i}`; c[k] = `c${j}`; v[k] = value(i, j);
  }
  return { columns: { r, c, v } };
}

export interface Staged {
  readonly m: MatrixFrame;
  readonly view: AlignedView;
  readonly layout: Layout;
  readonly scene: Scene;
  readonly lookup: Lookup;
  readonly formatters: Formatters;
}

export function formattersFor(format: unknown = null): Formatters {
  return createFormatters({
    series: [{ field: 'v', unit: null, scale: null, format }],
    x: { field: 'c', kind: 'number', unit: null, scale: null, format: null, timeZone: null, dateUnit: null, categories: null },
    locale: 'en-US', messages: { noData: 'No data', noObservation: 'No observation' },
  } as never, { locale: 'en-US', timeZone: 'UTC' });
}

/** Runs the pure stages as the controller does: resolve, normalize, view, layout, scene, lookup. */
export function stage(options: Record<string, unknown>, size = { width: 720, height: 420 }): Staged {
  const parsed = parseHeatmapInput({ title: 't', x: 'c', y: 'r', value: 'v', ...options });
  const sink = new DiagnosticCollector();
  const resolved = resolveOptions('line', parsed.translated, sink);
  const frame = normalizeHeatmap(parsed.meta, resolved, sink, { epoch: 1, revision: 1 });
  const view = buildHeatmapView(frame, null);
  const layout = computeHeatmapLayout(view, size, {
    measurer: { width: t => t.length * 7 }, style: { font: '12px sans-serif', letterSpacing: 0, wordSpacing: 0, lineHeight: 15 },
  });
  const formatters = formattersFor();
  return {
    m: matrixOf(frame)!, view, layout, scene: buildHeatmapScene(view, layout, 1),
    lookup: createHeatmapLookup(view, layout, formatters, defaultMessages), formatters,
  };
}
