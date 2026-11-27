/**
 * Pure interaction logic: focus, stepping, reading, overlay marks, and zoom windows. Runs in Node with no DOM.
 */
import {
  SLOT_VALUE, type AlignedView, type DatumRef, type DatumText, type Formatters, type Layout, type Lookup, type Mark, type Overlay,
  type PickTarget, type Rect, type RuleMark, type ScatterView, type SlotState, type StepDirection, type TooltipModel, type View,
} from './contracts';
import { donutGeometry } from '../view/donut-geometry';
import type { Messages } from '../public';
import { fill, pointOf } from '../messages';
import { lowerBound, pageDistance, stepIndex } from '../lookup/search';
import { slotText } from '../lookup/text';
import { slotState } from '../data/store-statistics';

export { pageDistance };

export type Mode = 'all' | 'single';
type Span = readonly [number, number];
type PlotLayout = Extract<Layout, { kind: 'plot' }>;

const isAligned = (v: View): v is AlignedView => v.kind !== 'donut' && v.kind !== 'scatter';
function seriesOf(v: Exclude<View, { kind: 'donut' }>, key: string): number {
  const series = v.frame.series;
  for (let i = 0; i < series.length; i++) if (series[i]!.key === key) return i;
  return -1;
}

export const targetOf = (ref: DatumRef): PickTarget =>
  ref.kind === 'aligned' ? { kind: 'x', x: ref.x }
    : ref.kind === 'point' ? { kind: 'point', refs: [ref], count: 1 }
    : { kind: 'slice', sliceKey: ref.sliceKey };

export function sameRef(a: DatumRef | null, b: DatumRef | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'slice') return a.sliceKey === (b as typeof a).sliceKey;
  if (a.kind === 'aligned') return a.seriesKey === (b as typeof a).seriesKey && a.x === (b as typeof a).x;
  return a.seriesKey === (b as typeof a).seriesKey && a.row === (b as typeof a).row && a.x === (b as typeof a).x;
}

/** The series a reading lists: shown and drawable, in series order. Runs on every pointer move. */
export function readableSeries(view: AlignedView): number[] {
  const series = view.frame.series;
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) if (view.visible[i] && series[i]!.drawable) out.push(i);
  return out;
}

export function stepAcross(view: AlignedView, x: number | null, direction: StepDirection): number | null {
  const { start, end } = view.visibleSlots;
  if (start >= end || !view.frame.series.some((s, i) => view.visible[i] && s.drawable)) return null;
  const xs = view.frame.x.values, at = x === null ? end : lowerBound(xs, x, start, end);
  if (at >= end || xs[at] !== x) return xs[direction === 'last' ? end - 1 : start]!;
  const to = stepIndex(direction, at, start, end);
  return to === null ? null : xs[to]!;
}

export function refsAt(view: AlignedView, x: number): DatumRef[] {
  const series = view.frame.series;
  const out: DatumRef[] = [];
  for (let i = 0; i < series.length; i++) {
    if (view.visible[i] && series[i]!.drawable) out.push({ kind: 'aligned', seriesKey: series[i]!.key, x });
  }
  return out;
}

export const positionText = (m: Messages, f: Formatters, ord: number, count: number): string =>
  fill(m.position, { index: f.count(ord + 1), count: f.count(count) });

export function valueText(view: View, lookup: Lookup, focus: DatumRef, mode: Mode, formatters: Formatters, messages: Messages): string | null {
  const ord = lookup.ordinal(focus);
  if (ord < 0) return null;
  const position = positionText(messages, formatters, ord, lookup.count);
  if (view.kind === 'donut') {
    const d = lookup.datum(focus);
    return d ? fill(messages.pointAll, { x: d.seriesLabel, values: d.value + (d.percent === null || d.percent === d.value ? '' : ` (${d.percent})`), position }) : null;
  }
  if (isAligned(view) && mode === 'all' && focus.kind === 'aligned') {
    const m = lookup.tooltip({ kind: 'x', x: focus.x });
    const rows = alignedRows(view, formatters, focus.x, m, lookup).map(r => fill(messages.seriesValue, { series: r.seriesLabel, value: r.value }));
    if (m.total !== null) rows.push(fill(messages.seriesValue, { series: messages.total, value: m.total }));
    return rows.length ? fill(messages.pointAll, { x: m.title, values: rows.join('; '), position }) : null;
  }
  return pointOf(lookup, focus, formatters, messages);
}

/**
 * The tooltip's rows, then every other readable series at x. Rows past the tooltip's are read from `lookup`
 * when given, so a series drawn from several columns (a Cartesian range) reads as it does in the tooltip.
 */
export function alignedRows(view: AlignedView, formatters: Formatters, x: number, model: TooltipModel, lookup?: Lookup): DatumText[] {
  const given = model.rows;
  const rows: DatumText[] = given.slice();
  const xs = view.frame.x.values, i = lowerBound(xs, x);
  if (i >= xs.length || xs[i] !== x) return rows;
  const shown = new Set(given.map(r => r.seriesIndex));
  const series = view.frame.series;
  for (let s = 0; s < series.length; s++) {
    if (!view.visible[s] || !series[s]!.drawable || shown.has(s)) continue;
    const ser = series[s]!, state = slotState(ser, i) as SlotState, ref: DatumRef = { kind: 'aligned', seriesKey: ser.key, x };
    // A datum read on its own may say its stack is incomplete; a tooltip row does not (the total says it), so
    // only a value is taken from the lookup. An error bar whose centre is missing still has a value there when
    // its bounds do (Cartesian: "No data (20 – 80)"), which the lookup reports as one.
    const read = lookup?.datum(ref), d = (read?.state === SLOT_VALUE || state === SLOT_VALUE) && read;
    rows.push({
      ref, seriesIndex: s, seriesLabel: ser.label, x: model.title,
      value: d ? d.value : slotText(formatters, s, ser.y[i]!, state), state: d ? d.state : state, percent: null, row: ser.row?.[i] ?? i,
    });
  }
  return rows;
}

export function datumReading(view: View, lookup: Lookup, ref: DatumRef, mode: Mode, formatters: Formatters, messages: Messages): string | null {
  if (lookup.ordinal(ref) < 0) return null;
  const words = [messages.pointAll, messages.pointOf, messages.seriesValue, messages.total, messages.position];
  const x = ref.kind === 'aligned' && isAligned(view) ? view.frame.x.categories?.[ref.x] ?? ref.x : null;
  if (isAligned(view) && mode === 'all' && ref.kind === 'aligned') {
    const m = lookup.tooltip({ kind: 'x', x: ref.x });
    return JSON.stringify(['all', ref.seriesKey, x, m.title, alignedRows(view, formatters, ref.x, m, lookup).map(r => [r.seriesIndex, r.seriesLabel, r.value]), m.total, words]);
  }
  const d = lookup.datum(ref);
  if (!d) return null;
  const id = ref.kind === 'point' ? [ref.seriesKey, ref.row] : ref.kind === 'aligned' ? [ref.seriesKey, x] : [ref.sliceKey];
  return JSON.stringify(['one', ref.kind, id, d.seriesLabel, d.x, d.value, d.percent, words]);
}

export interface OverlayInput {
  readonly view: View;
  readonly layout: Layout;
  readonly lookup: Lookup;
  readonly target: PickTarget | null;
  readonly ring: DatumRef | null;
  readonly only: DatumRef | null;
}

const HALO = 13, MARKER = 9, RING_GAP = 4, RING_WIDTH = 2, SURROUND_WIDTH = 4;
export const RING_REACH = 10, OUTLINE_REACH = 4, RING_STROKE = SURROUND_WIDTH;

const rule = (x1: number, y1: number, x2: number, y2: number, name: 'axis' | 'focus' | 'text' | 'background', strokeWidth: number): RuleMark =>
  ({ type: 'rule', x1, y1, x2, y2, stroke: { kind: 'token', name }, strokeWidth, dash: null, role: 'cursor' });

function outline(b: Rect, gap: number, name: 'focus' | 'text' | 'background', w: number): RuleMark[] {
  const x0 = b.x - gap, y0 = b.y - gap, x1 = b.x + b.width + gap, y1 = b.y + b.height + gap, h = w / 2;
  return [rule(x0 - h, y0, x1 + h, y0, name, w), rule(x1, y0 - h, x1, y1 + h, name, w),
    rule(x1 + h, y1, x0 - h, y1, name, w), rule(x0, y1 + h, x0, y0 - h, name, w)];
}

function posScale(layout: Layout) {
  if (layout.kind !== 'plot') return null;
  const p = layout.projection;
  return p.kind === 'xy' ? p.x : p.kind === 'bands' ? p.band : null;
}

function pushPoint(clipped: Mark[], view: Exclude<View, { kind: 'donut' }>, ref: DatumRef, x: number, y: number, halo: 'background' | 'text'): void {
  const series = ref.kind === 'slice' ? -1 : seriesOf(view, ref.seriesKey);
  const xy = Float32Array.of(x, y), shape = view.cues[series]?.marker ?? 'circle';
  clipped.push(
    { type: 'points', series, xy, shape, size: HALO, fill: { kind: 'token', name: halo } },
    { type: 'points', series, xy, shape, size: MARKER, fill: { kind: 'series', index: series } },
  );
}

export type TargetMarks = (input: OverlayInput, plot: Rect, clipped: Mark[], unclipped: Mark[]) => void;

export const alignedTargetMarks: TargetMarks = ({ view, layout, lookup, target, only }, plot, clipped, unclipped) => {
  if (target?.kind !== 'x' || !isAligned(view) || layout.kind !== 'plot') return;
  const p = layout.projection, s = posScale(layout);
  if (s) {
    const at = s.type === 'band' ? s.center(target.x) : s.map(target.x);
    if (Number.isFinite(at)) {
      clipped.push(p.kind === 'bands' && p.horizontal
        ? rule(plot.x, at, plot.x + plot.width, at, 'axis', 1)
        : rule(at, plot.y, at, plot.y + plot.height, 'axis', 1));
    }
  }
  for (const ref of only ? [only] : refsAt(view, target.x)) {
    const b = lookup.anchor(ref);
    if (!b) continue;
    if (p.kind === 'bands') unclipped.push(...outline(b, 1, 'text', 2));
    else pushPoint(clipped, view, ref, b.x + b.width / 2, b.y + b.height / 2, 'background');
  }
};

export const scatterTargetMarks: TargetMarks = ({ view, lookup, target }, _plot, clipped) => {
  if (target?.kind !== 'point' || view.kind !== 'scatter') return;
  for (const ref of target.refs) { const b = lookup.anchor(ref); if (b) pushPoint(clipped, view, ref, b.x, b.y, 'text'); }
};

export const donutTargetMarks: TargetMarks = ({ view, layout, target }, _plot, _clipped, unclipped) => {
  if (target?.kind !== 'slice' || view.kind !== 'donut' || layout.kind !== 'plot' || layout.projection.kind !== 'ring') return;
  const p = layout.projection, g = donutGeometry(view.slices, p), at = g.drawn.findIndex(s => s.key === target.sliceKey);
  if (at < 0) return;
  const from = g.angles[2 * at]!, to = g.angles[2 * at + 1]!;
  if (!(to > from)) return;
  const angles = Float32Array.of(from, to), fills = [{ kind: 'token', name: 'text' } as const];
  const push = (r0: number, r1: number) => unclipped.push({ type: 'arcs', cx: p.cx, cy: p.cy, r0, r1, angles, fills, gap: 0 });
  push(p.r1 + 1, p.r1 + 4);
  if (p.r0 > 5) push(p.r0 - 4, p.r0 - 1);
};

export const buildOverlay = (input: OverlayInput): Overlay | null =>
  overlayWith(input.view.kind === 'donut' ? donutTargetMarks : input.view.kind === 'scatter' ? scatterTargetMarks : alignedTargetMarks, input);

export function overlayWith(targetMarks: TargetMarks, input: OverlayInput): Overlay | null {
  const { layout, lookup, target, ring } = input;
  if (layout.kind !== 'plot' || (!target && !ring)) return null;
  const plot = layout.plot, clipped: Mark[] = [], unclipped: Mark[] = [];
  targetMarks(input, plot, clipped, unclipped);
  const rb = ring ? ringLine(layout, lookup, ring) : null;
  if (rb) unclipped.push(...outline(rb, 0, 'background', SURROUND_WIDTH), ...outline(rb, 0, 'focus', RING_WIDTH));
  return clipped.length || unclipped.length ? { clip: plot, clipped, unclipped } : null;
}

function ringLine(layout: Layout, lookup: Lookup, ref: DatumRef): Rect | null {
  if (layout.kind !== 'plot') return null;
  const b = lookup.anchor(ref);
  if (!b) return null;
  const p = layout.plot, gap = b.width === 0 && b.height === 0 ? 8 : RING_GAP, h = SURROUND_WIDTH / 2;
  const x0 = Math.max(p.x + h, b.x - gap), y0 = Math.max(p.y + h, b.y - gap);
  const x1 = Math.min(p.x + p.width - h, b.x + b.width + gap), y1 = Math.min(p.y + p.height - h, b.y + b.height + gap);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

export function ringRect(layout: Layout, lookup: Lookup, ref: DatumRef): Rect | null {
  const l = ringLine(layout, lookup, ref);
  return l && { x: l.x - 2, y: l.y - 2, width: l.width + SURROUND_WIDTH, height: l.height + SURROUND_WIDTH };
}

export function targetBox(view: View, lookup: Lookup, target: PickTarget, only: DatumRef | null): Rect | null {
  const refs: readonly DatumRef[] = target.kind === 'x' ? (isAligned(view) ? (only ? [only] : refsAt(view, target.x)) : [])
    : target.kind === 'point' ? target.refs : [{ kind: 'slice', sliceKey: target.sliceKey }];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ref of refs) {
    const b = lookup.anchor(ref);
    if (!b) continue;
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

export const ZOOM_FACTOR = 2, PAN_SHARE = 0.1;

function inside(full: Span, start: number, width: number): Span {
  const a = Math.max(full[0], Math.min(start, full[1] - width));
  return [a, a + width];
}

export function scaleWindow(full: Span, cur: Span, factor: number, center: number, minWidth: number): Span | null {
  const fw = full[1] - full[0], cw = cur[1] - cur[0], w = Math.max(minWidth, cw * factor);
  if (!(fw > 0) || w >= fw) return null;
  const next = inside(full, center - (cw > 0 ? (center - cur[0]) / cw : 0.5) * w, w);
  return Number.isFinite(next[0]) && Number.isFinite(next[1]) && next[1] > next[0] ? next : cur;
}

export function zoomStep(full: Span, cur: Span, factor: number, center: number, minWidth: number): Span | null | undefined {
  const w = cur[1] - cur[0], next = scaleWindow(full, cur, factor, center, minWidth);
  if (factor < 1) return next && next[1] - next[0] < w ? next : undefined;
  if (factor > 1) return next === null ? (cur[0] <= full[0] && cur[1] >= full[1] ? undefined : null) : next[1] - next[0] > w ? next : undefined;
  return undefined;
}

/**
 * Whether zooming in from window `w` about its centre moves anything: `zoomStep(...) !== undefined`, worked out
 * without the windows it would make (the toolbar asks on every commit).
 */
export function canZoomIn(view: View, w: Span): boolean {
  if (view.kind === 'donut') return false;
  const full = view.xFull, factor = 1 / ZOOM_FACTOR, center = (w[0] + w[1]) / 2, minWidth = minimumWidth(view);
  // scaleWindow, as zoomStep calls it.
  const fw = full[1] - full[0], cw = w[1] - w[0], width = Math.max(minWidth, cw * factor);
  if (!(fw > 0) || width >= fw) return false;
  const start = center - (cw > 0 ? (center - w[0]) / cw : 0.5) * width;
  const a = Math.max(full[0], Math.min(start, full[1] - width)), b = a + width;
  // A window that is not finite or empty is the current one, which is not narrower than itself.
  return Number.isFinite(a) && Number.isFinite(b) && b > a && b - a < w[1] - w[0];
}

export function pinchWidth(start: number, factor: number, minWidth: number): number {
  const w = Math.max(minWidth, start * factor);
  return factor < 1 ? Math.min(w, start) : factor > 1 ? Math.max(w, start) : start;
}

export function panWindow(full: Span, cur: Span, share: number): Span | null {
  const w = cur[1] - cur[0], moved = inside(full, cur[0] + share * w, w);
  return moved[0] === cur[0] ? null : moved;
}

export function minimumWidth(view: View): number {
  if (view.kind === 'donut') return 0;
  const [a, b] = view.xFull, full = b - a;
  const ulp = 2 ** (Math.floor(Math.log2(Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE))) - 52);
  const n = view.kind === 'scatter' ? 0 : view.frame.x.values.length;
  return Math.max(Math.min(view.kind === 'scatter' ? full / 1e4 : n > 1 ? 2 * full / (n - 1) : full, full / 2), ulp);
}

export const zoomApplies = (view: View, option: unknown): boolean =>
  option !== false && view.kind !== 'donut' && !view.compact && (view.kind === 'scatter' || view.frame.x.kind !== 'category');

export function stepInSeries(view: ScatterView, ref: DatumRef, direction: StepDirection): DatumRef | null {
  if (ref.kind !== 'point') return null;
  const s = seriesOf(view, ref.seriesKey), ser = view.frame.series[s], range = view.visiblePoints[s];
  if (!ser || !range || range.end <= range.start) return null;
  const rows = ser.row;
  let at = -1;
  for (let i = range.start; i < range.end; i++) if ((rows ? rows[i]! : i) === ref.row) { at = i; break; }
  const to = at < 0 ? null : stepIndex(direction, at, range.start, range.end);
  return to === null ? null : { kind: 'point', seriesKey: ser.key, row: rows ? rows[to]! : to, x: ser.x[to]! };
}

export function rangeWindow(full: Span, a: number, b: number, minWidth: number): Span | null | undefined {
  const lo = Math.max(full[0], Math.min(a, b)), hi = Math.min(full[1], Math.max(a, b)), w = hi - lo;
  return !(w > 0) || w < minWidth ? undefined : w >= full[1] - full[0] ? null : [lo, hi];
}

export function pixelOf(layout: Layout, position: number): number | null {
  const s = posScale(layout);
  return s && s.type !== 'band' ? s.map(position) : null;
}

export function positionAt(layout: Layout, px: number, py: number): number | null {
  const s = posScale(layout);
  if (!s || s.type === 'band') return null;
  const p = (layout as PlotLayout).projection;
  return s.invert(p.kind === 'bands' && p.horizontal ? py : px);
}

export type { PlotLayout };
