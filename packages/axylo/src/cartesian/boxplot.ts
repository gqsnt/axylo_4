/**
 * Logical marks of `axylo/cartesian`: one reader-visible series (legend, toggle, swatch, tooltip)
 * backed by borrowed carrier columns in the shared aligned frame.
 * Every top-level statement stays pure so `import 'axylo/cartesian'` bundles to 0 raw bytes.
 */
import {
  SLOT_GAP, SLOT_NO_ROW, SLOT_VALUE, type AlignedFrame, type AlignedView, type Formatters, type IndexRange, type Projection,
  type Rect, type Series, type SlotState,
} from '../core/contracts';
import { position } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { xSlotPixel } from './bar-geom';
import type { CartesianLayerMark, CartesianMeta } from './meta';

export type LogicalKind = CartesianLayerMark | 'scatter' | 'boxplot';

export type PartRole = 'y' | 'low' | 'high' | 'min' | 'q1' | 'median' | 'q3' | 'max';

export interface OutlierColumn {
  readonly field: string;
  readonly start: Uint32Array;
  readonly values: Float64Array;
}

export interface LogicalMark {
  readonly kind: LogicalKind;
  readonly label: string;
  readonly axisId: string;
  readonly axisIndex: 0 | 1;
  readonly roles: readonly PartRole[];
  readonly fields: readonly string[];
  readonly capWidth: number;
  readonly size: number;
  readonly outliers: OutlierColumn | null;
}

export interface OptionIssue {
  readonly code: 'AX150' | 'AX103' | 'AX106' | 'AX171';
  readonly field: string;
  readonly detail?: string;
  readonly count?: number;
  readonly rows?: readonly number[];
}

export interface LogicalLayout {
  readonly marks: readonly LogicalMark[];
  readonly optionIssues: readonly OptionIssue[];
  readonly byField: ReadonlyMap<string, LogicalMark>;
}

export const BOX_ROLES = ['min', 'q1', 'median', 'q3', 'max'] as const;
export const isCompoundKind = (k: LogicalKind | undefined): boolean => k === 'range' || k === 'errorBar' || k === 'boxplot';
export const axisOf = (meta: CartesianMeta, axisId?: string) => meta.axisById.get(axisId ?? meta.leftAxisId) ?? meta.axes[0];
export const isLogSeries = (meta: CartesianMeta, s: Series | undefined) => !!s?.axisId && meta.axisById.get(s.axisId)?.scale === 'log';

let layouts: WeakMap<CartesianMeta, LogicalLayout> | undefined;
let physicals: WeakMap<AlignedFrame, PhysicalView> | undefined;

export function registerLogical(meta: CartesianMeta, marks: readonly LogicalMark[], optionIssues: readonly OptionIssue[]): LogicalLayout {
  const layout = { marks, optionIssues, byField: new Map(marks.map(m => [m.fields[0]!, m])) };
  (layouts ??= new WeakMap()).set(meta, layout);
  return layout;
}

export function logicalOf(meta: CartesianMeta): LogicalLayout {
  return layouts?.get(meta) ?? registerLogical(meta, meta.series.map(s => ({
    kind: s.mark, label: s.label, axisId: s.axisId, axisIndex: s.axisIndex,
    roles: ['y'], fields: [s.field], capWidth: 0, size: 4, outliers: null,
  })), []);
}

export interface PhysicalView {
  readonly frame: AlignedFrame;
  readonly visible: readonly boolean[];
  readonly parts: readonly Int32Array[];
  readonly rows?: readonly (Uint8Array | null)[];
}

export function compoundRows(columns: readonly Series[], log: boolean, length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) {
    let value = true, none = true;
    for (const c of columns) {
      const st = c.slot[i];
      if (st !== SLOT_NO_ROW) none = false;
      if (st !== SLOT_VALUE || (log && !(c.y[i]! > 0))) value = false;
    }
    out[i] = value ? SLOT_VALUE : none ? SLOT_NO_ROW : SLOT_GAP;
  }
  return out;
}

export function registerPhysical(published: AlignedFrame, physical: PhysicalView): void {
  (physicals ??= new WeakMap()).set(published, physical);
}

export function physicalOf(view: AlignedView): PhysicalView {
  return physicals?.get(view.frame) ?? { frame: view.frame, visible: view.visible, parts: view.frame.series.map((_, i) => Int32Array.of(i)) };
}

export function intervalText(mark: LogicalMark, read: (role: PartRole) => string): string {
  const range = `${read('low')} – ${read('high')}`;
  return mark.kind === 'errorBar' && mark.roles[0] === 'y' ? `${read('y')} (${range})` : range;
}

export function partIndex(mark: LogicalMark, physical: PhysicalView, index: number, role: PartRole): number {
  const at = mark.roles.indexOf(role);
  return at < 0 ? -1 : physical.parts[index]?.[at] ?? -1;
}

/** Visit one source row's CSR slice without allocating a subarray. Omit the callback to size a scene buffer. */
export function visitOutliers(
  column: OutlierColumn | null, row: Int32Array | null, slot: number, visit?: (value: number, slot: number) => void,
): number {
  if (!column) return 0;
  const r = row ? row[slot]! : slot;
  if (!(r >= 0) || r + 1 >= column.start.length) return 0;
  const start = column.start[r]!, end = column.start[r + 1]!;
  if (visit) for (let k = start; k < end; k++) visit(column.values[k]!, slot);
  return end - start;
}

/** Use the carrier's formatter index even when the legend publishes only its compound representative. */
export function carrierReadout(meta: CartesianMeta, physical: PhysicalView, formatters: Formatters, logSuffix: string) {
  const series = physical.frame.series;
  const value = (index: number, raw: number) => {
    const text = formatters.value(index, raw);
    return isLogSeries(meta, series[index]) && !(raw > 0) ? text + logSuffix : text;
  };
  const cell = (index: number, slot: number) => {
    const s = series[index];
    if (!s) return '';
    const state = s.slot[slot]! as SlotState;
    return state === SLOT_VALUE ? value(index, s.y[slot]!) : formatters.missing(state);
  };
  const outliers = (median: number, column: OutlierColumn | null, slot: number) => {
    const words: string[] = [];
    visitOutliers(column, series[median]?.row ?? null, slot, v => words.push(value(median, v)));
    return words.length ? words.join(', ') : null;
  };
  return { value, cell, outliers };
}

export function boxHalfWidth(projection: Exclude<Projection, { kind: 'ring' }>, xValues: Float64Array, slots: IndexRange): number {
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  let gap = xScale.type === 'band' ? xScale.bandwidth : Infinity;
  if (xScale.type !== 'band') {
    for (let i = slots.start + 1; i < slots.end; i++) {
      const d = Math.abs(xSlotPixel(xScale, xValues, i) - xSlotPixel(xScale, xValues, i - 1));
      if (d > 0 && d < gap) gap = d;
    }
    if (!Number.isFinite(gap)) gap = Math.abs(xScale.range[1] - xScale.range[0]) / 4;
  }
  const half = gap * 0.3;
  return half < 3 ? 3 : half > 24 ? 24 : half;
}

export const WHISKER_WIDTH = 1.5;
export const MEDIAN_WIDTH = 2;
export const RANGE_STROKE_WIDTH = 4;

export interface CompoundSink {
  box(centerX: number, halfWidth: number, y: number, height: number): void;
  whisker(x1: number, y1: number, x2: number, y2: number): void;
  median(x1: number, x2: number, y: number): void;
  point: ((x: number, y: number) => void) | undefined;
}

/** Bind the borrowed columns and scale once. Scene and pick consume the same pixel primitives
 * for any slot with a drawable row. Range runs use the same top and bottom for their joined edges.
 */
export function projectCompound(
  mark: LogicalMark, physical: PhysicalView, index: number,
  projection: Exclude<Projection, { kind: 'ring' }>, plot: Rect, boxHalf: number,
) {
  const rows = physical.rows?.[index];
  if (!rows || !isCompoundKind(mark.kind)) return null;
  const scale = axisScaleOf(projection, mark.axisIndex);
  const column = (role: PartRole) => physical.frame.series[partIndex(mark, physical, index, role)];
  const box = mark.kind === 'boxplot';
  const low = column(box ? 'q1' : 'low'), high = column(box ? 'q3' : 'high');
  const min = column('min'), max = column('max'), centre = column(box ? 'median' : 'y');
  if (!low || !high || (box && (!min || !max || !centre))) return null;
  const innerHigh = (i: number) => Math.max(low.y[i]!, high.y[i]!);
  const innerLow = (i: number) => Math.min(low.y[i]!, high.y[i]!);
  const top = (i: number) => position(scale, box ? Math.max(min!.y[i]!, max!.y[i]!, innerHigh(i)) : innerHigh(i));
  const bottom = (i: number) => position(scale, box ? Math.min(min!.y[i]!, max!.y[i]!, innerLow(i)) : innerLow(i));
  const cap = mark.capWidth < 0 ? boxHalf : mark.capWidth / 2;

  function visit(i: number, x: number, sink: CompoundSink): void {
    const a = top(i), b = bottom(i);
    if (box) {
      const qTop = position(scale, innerHigh(i)), qBottom = position(scale, innerLow(i));
      const lo = Math.min(qTop, qBottom), hi = Math.max(qTop, qBottom);
      const floor = plot.y + plot.height;
      if (x + boxHalf >= plot.x && x - boxHalf <= plot.x + plot.width && hi >= plot.y && lo <= floor) {
        const y = Math.max(lo, plot.y);
        const height = Math.max(1, Math.min(hi, floor) - y);
        sink.box(x, boxHalf, Math.min(y, Math.max(plot.y, floor - height)), height);
      }
      sink.whisker(x, qTop, x, a);
      sink.whisker(x, qBottom, x, b);
      const median = position(scale, centre!.y[i]!);
      sink.median(x - boxHalf, x + boxHalf, median);
    } else {
      sink.whisker(x, a, x, b);
      if (sink.point && centre && centre.slot[i] === SLOT_VALUE && (scale.type !== 'log' || centre.y[i]! > 0)) {
        sink.point(x, position(scale, centre.y[i]!));
      }
    }
    if (cap > 0) {
      const first = box ? a : b, second = box ? b : a;
      sink.whisker(x - cap, first, x + cap, first);
      sink.whisker(x - cap, second, x + cap, second);
    }
  }

  const outliers = (i: number, visit?: (v: number, slot: number) => void) =>
    visitOutliers(mark.outliers, centre?.row ?? null, i, visit);
  const pointY = (v: number) => scale.type === 'log' && !(v > 0) ? NaN : position(scale, v);
  return { rows, low, centre, cap, top, bottom, visit, outliers, pointY };
}

export function markOf(meta: CartesianMeta, field: string): LogicalMark | undefined {
  return logicalOf(meta).byField.get(field);
}
