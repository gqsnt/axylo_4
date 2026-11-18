/**
 * The pure part of the interaction layer: what the reader is on, how it moves, how it reads, and what is
 * drawn over the marks for it. Everything here reads the frame through the view and the lookup (never the
 * scene), and touches no DOM, so it is tested in Node.
 *
 * Decision 0001: the plot is one range input. Its value is the place of the current x among the visible x
 * slots. By default it reads every visible series at that x ("all" mode); after Up or Down it reads one series
 * ("single" mode) and moves with `lookup.step`, which skips that series' missing values as the contract says.
 */
import {
  SLOT_NO_ROW,
  type AlignedView, type DatumRef, type Formatters, type Layout, type Lookup, type Mark, type Overlay,
  type PickTarget, type Rect, type RuleMark, type StepDirection, type View,
} from './contracts';
import type { Messages } from '../public';
import { fill, pointOf } from '../messages';

export type Mode = 'all' | 'single';
type Span = readonly [number, number];
type PlotLayout = Extract<Layout, { kind: 'plot' }>;

/** The pointer target that shows the same thing as a focused datum. */
export function targetOf(ref: DatumRef): PickTarget {
  switch (ref.kind) {
    case 'aligned': return { kind: 'x', x: ref.x };
    case 'point': return { kind: 'point', refs: [ref], count: 1 };
    case 'slice': return { kind: 'slice', sliceKey: ref.sliceKey };
  }
}

export function sameRef(a: DatumRef | null, b: DatumRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'aligned' && b.kind === 'aligned') return a.seriesKey === b.seriesKey && a.x === b.x;
  if (a.kind === 'point' && b.kind === 'point') return a.seriesKey === b.seriesKey && a.row === b.row && a.x === b.x;
  if (a.kind === 'slice' && b.kind === 'slice') return a.sliceKey === b.sliceKey;
  return false;
}

function lowerBound(values: ArrayLike<number>, value: number, start: number, end: number): number {
  while (start < end) {
    const mid = (start + end) >>> 1;
    if (values[mid]! < value) start = mid + 1;
    else end = mid;
  }
  return start;
}

/** Matches lookup's page size (spec A2 "Page keys"): a tenth of the visible positions, at least one. */
export function pageDistance(count: number): number {
  return Math.max(1, Math.floor(count / 10));
}

/** Series a reader can land on: visible and drawable. */
export function readableSeries(view: AlignedView): number[] {
  return view.frame.series.flatMap((s, i) => view.visible[i] && s.drawable ? [i] : []);
}

/**
 * In "all" mode the reader moves over x slots. A slot is skipped only when no readable series has an
 * observation there (the x exists for a hidden series alone); a slot where a series has no data has a place
 * and is read as "No data" (spec F2), so an outage can be reached.
 */
function occupied(view: AlignedView, series: readonly number[], i: number): boolean {
  for (const s of series) if (view.frame.series[s]!.slot[i] !== SLOT_NO_ROW) return true;
  return false;
}

/** The x position "all" mode moves to, or null when there is nowhere to go in that direction. */
export function stepAcross(view: AlignedView, x: number | null, direction: StepDirection): number | null {
  const { start, end } = view.visibleSlots;
  const positions = view.frame.x.values;
  const series = readableSeries(view);
  if (start >= end || series.length === 0) return null;
  const seek = (from: number, delta: 1 | -1, lo = start, hi = end): number => {
    for (let i = from; i >= lo && i < hi; i += delta) if (occupied(view, series, i)) return i;
    return -1;
  };
  let at = x === null ? -1 : lowerBound(positions, x, start, end);
  if (at >= 0 && (at >= end || positions[at] !== x)) at = -1;
  let to = -1;
  if (at < 0) {
    to = direction === 'last' ? seek(end - 1, -1) : seek(start, 1);
  } else {
    const page = pageDistance(end - start);
    switch (direction) {
      case 'next': to = seek(at + 1, 1); break;
      case 'previous': to = seek(at - 1, -1); break;
      case 'first': to = seek(start, 1); break;
      case 'last': to = seek(end - 1, -1); break;
      case 'page-next': {
        const target = Math.min(end - 1, at + page);
        to = seek(target, 1);
        if (to < 0) to = seek(target - 1, -1, at + 1);
        break;
      }
      case 'page-previous': {
        const target = Math.max(start, at - page);
        to = seek(target, -1);
        if (to < 0) to = seek(target + 1, 1, start, at);
        break;
      }
      default: return null;
    }
    if (to === at) return null;
  }
  return to < 0 ? null : positions[to]!;
}

/** The refs of every readable series at x, in series order. */
export function refsAt(view: AlignedView, x: number): DatumRef[] {
  return readableSeries(view).map(s => ({ kind: 'aligned', seriesKey: view.frame.series[s]!.key, x }) as const);
}

/** The place of a datum among the visible ones, as the `position` message says it ("Point 4 of 10"). */
export function positionText(messages: Messages, formatters: Formatters, ordinal: number, count: number): string {
  return fill(messages.position, { index: formatters.count(ordinal + 1), count: formatters.count(count) });
}

/**
 * Value text of the proxy (decision 0001): what the reader is on, ending with its place. "All" mode reads
 * every series at the x with `pointAll` and `seriesValue`; one series (single mode, scatter) uses `pointOf`.
 */
export function valueText(
  view: View, lookup: Lookup, focus: DatumRef, mode: Mode, formatters: Formatters, messages: Messages,
): string | null {
  const ordinal = lookup.ordinal(focus);
  if (ordinal < 0) return null;
  const position = positionText(messages, formatters, ordinal, lookup.count);
  if (view.kind === 'donut') {
    const datum = lookup.datum(focus);
    if (!datum) return null;
    const share = datum.percent === null || datum.percent === datum.value ? '' : ` (${datum.percent})`;
    return fill(messages.pointAll, {
      x: datum.seriesLabel, values: datum.value + share, position,
    });
  }
  if (view.kind !== 'scatter' && mode === 'all' && focus.kind === 'aligned') {
    const rows = refsAt(view, focus.x).flatMap(ref => {
      const datum = lookup.datum(ref);
      return datum ? [fill(messages.seriesValue, { series: datum.seriesLabel, value: datum.value })] : [];
    });
    if (!rows.length) return null;
    return fill(messages.pointAll, { x: formatters.x(focus.x), values: rows.join('; '), position });
  }
  return pointOf(lookup, focus, formatters, messages);
}

// ── overlay ─────────────────────────────────────────────────────────────────────────────────────────

export interface OverlayInput {
  readonly view: View;
  readonly layout: Layout;
  readonly lookup: Lookup;
  /** What is shown (pointer or keyboard). */
  readonly target: PickTarget | null;
  /** The keyboard's datum, when the proxy has focus and is focus-visible: it gets the focus ring. */
  readonly ring: DatumRef | null;
  /** In single mode only the focused series is highlighted. */
  readonly only: DatumRef | null;
}

const HALO = 13;
const MARKER = 9;
const RING_GAP = 4;

function rule(x1: number, y1: number, x2: number, y2: number, name: 'axis' | 'focus' | 'text', width: number): RuleMark {
  return { type: 'rule', x1, y1, x2, y2, stroke: { kind: 'token', name }, strokeWidth: width, dash: null, role: 'cursor' };
}

function outline(box: Rect, gap: number, name: 'focus' | 'text', width: number): RuleMark[] {
  const x0 = box.x - gap, y0 = box.y - gap, x1 = box.x + box.width + gap, y1 = box.y + box.height + gap;
  return [rule(x0, y0, x1, y0, name, width), rule(x1, y0, x1, y1, name, width), rule(x1, y1, x0, y1, name, width), rule(x0, y1, x0, y0, name, width)];
}

function seriesIndex(view: View, ref: DatumRef): number {
  if (view.kind === 'donut') return -1;
  if (ref.kind === 'slice') return -1;
  return view.frame.series.findIndex(s => s.key === ref.seriesKey);
}

/** Cursor rule, highlighted points or bar and slice outlines, and the keyboard focus ring (contracts: Overlay). */
export function buildOverlay(input: OverlayInput): Overlay | null {
  const { view, layout, lookup, target, ring, only } = input;
  if (layout.kind !== 'plot' || (target === null && ring === null)) return null;
  const plot = layout.plot;
  const clipped: Mark[] = [];
  const unclipped: Mark[] = [];
  const projection = layout.projection;

  if (target?.kind === 'x' && view.kind !== 'donut' && view.kind !== 'scatter') {
    const refs = only ? [only] : refsAt(view, target.x);
    const scale = projection.kind === 'xy' ? projection.x : projection.kind === 'bands' ? projection.band : null;
    if (scale) {
      const at = scale.type === 'band' ? scale.center(target.x) : scale.map(target.x);
      const across = projection.kind === 'bands' && projection.horizontal;
      if (Number.isFinite(at)) {
        clipped.push(across ? rule(plot.x, at, plot.x + plot.width, at, 'axis', 1) : rule(at, plot.y, at, plot.y + plot.height, 'axis', 1));
      }
    }
    for (const ref of refs) {
      const box = lookup.anchor(ref);
      if (!box) continue;
      if (projection.kind === 'bands') {
        unclipped.push(...outline(box, 1, 'text', 2));
      } else {
        const s = seriesIndex(view, ref);
        const cue = view.cues[s];
        const xy = Float32Array.of(box.x + box.width / 2, box.y + box.height / 2);
        const shape = cue?.marker ?? 'circle';
        clipped.push({ type: 'points', series: s, xy, shape, size: HALO, fill: { kind: 'token', name: 'background' } });
        clipped.push({ type: 'points', series: s, xy, shape, size: MARKER, fill: { kind: 'series', index: s } });
      }
    }
  } else if (target?.kind === 'point' && view.kind === 'scatter') {
    for (const ref of target.refs) {
      const box = lookup.anchor(ref);
      if (!box) continue;
      const s = seriesIndex(view, ref);
      const xy = Float32Array.of(box.x, box.y);
      const shape = view.cues[s]?.marker ?? 'circle';
      clipped.push({ type: 'points', series: s, xy, shape, size: HALO, fill: { kind: 'token', name: 'text' } });
      clipped.push({ type: 'points', series: s, xy, shape, size: MARKER, fill: { kind: 'series', index: s } });
    }
  } else if (target?.kind === 'slice' && view.kind === 'donut' && projection.kind === 'ring') {
    const slice = view.slices.find(s => s.key === target.sliceKey);
    if (slice?.angles && slice.angles[1] > slice.angles[0]) {
      const angles = Float32Array.of(slice.angles[0], slice.angles[1]);
      const fills = [{ kind: 'token', name: 'text' } as const];
      unclipped.push({ type: 'arcs', cx: projection.cx, cy: projection.cy, r0: projection.r1 + 1, r1: projection.r1 + 4, angles, fills, gap: 0 });
      if (projection.r0 > 5) {
        unclipped.push({ type: 'arcs', cx: projection.cx, cy: projection.cy, r0: projection.r0 - 4, r1: projection.r0 - 1, angles, fills, gap: 0 });
      }
    }
  }

  if (ring) {
    const box = lookup.anchor(ring);
    if (box) unclipped.push(...outline(box, box.width === 0 && box.height === 0 ? 8 : RING_GAP, 'focus', 2));
  }
  return clipped.length || unclipped.length ? { clip: plot, clipped, unclipped } : null;
}

/** The union of the anchors a tooltip must not cover, in plot coordinates; null when nothing is drawn. */
export function targetBox(view: View, lookup: Lookup, target: PickTarget, only: DatumRef | null): Rect | null {
  let refs: readonly DatumRef[];
  if (target.kind === 'x') refs = view.kind === 'donut' || view.kind === 'scatter' ? [] : only ? [only] : refsAt(view, target.x);
  else if (target.kind === 'point') refs = target.refs;
  else refs = [{ kind: 'slice', sliceKey: target.sliceKey }];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const ref of refs) {
    const box = lookup.anchor(ref);
    if (!box) continue;
    x0 = Math.min(x0, box.x);
    y0 = Math.min(y0, box.y);
    x1 = Math.max(x1, box.x + box.width);
    y1 = Math.max(y1, box.y + box.height);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

// ── zoom ────────────────────────────────────────────────────────────────────────────────────────────

/** Factor of one zoom step (buttons, keys): the visible x range halves or doubles around its centre. */
export const ZOOM_FACTOR = 2;
/** Shift+arrow moves the window by this share of its width. */
export const PAN_SHARE = 0.1;

/** Keeps a window of the given width inside `full`, moving it rather than shrinking it. */
function inside(full: Span, start: number, width: number): Span {
  const a = Math.max(full[0], Math.min(start, full[1] - width));
  return [a, a + width];
}

/**
 * The window after scaling `current` by `factor` around `center` (a position), clamped to `full` and to a
 * smallest width. null means the whole range (no zoom), so the reset control can disappear.
 */
export function scaleWindow(full: Span, current: Span, factor: number, center: number, minWidth: number): Span | null {
  const fullWidth = full[1] - full[0];
  const width = Math.max(minWidth, (current[1] - current[0]) * factor);
  if (!(fullWidth > 0) || width >= fullWidth) return null;
  const share = current[1] > current[0] ? (center - current[0]) / (current[1] - current[0]) : 0.5;
  return inside(full, center - share * width, width);
}

/** The window moved by `share` of its width (negative: towards the start); null when it would not move. */
export function panWindow(full: Span, current: Span, share: number): Span | null {
  const width = current[1] - current[0];
  const moved = inside(full, current[0] + share * width, width);
  return moved[0] === current[0] ? null : moved;
}

/** Smallest window: about two x slots for aligned charts, a ten-thousandth of the range otherwise. */
export function minimumWidth(view: View): number {
  if (view.kind === 'donut') return 0;
  const full = view.xFull[1] - view.xFull[0];
  if (view.kind === 'scatter') return full / 1e4;
  const n = view.frame.x.values.length;
  return n > 1 ? 2 * full / (n - 1) : full;
}

/** Whether zoom applies to this chart (spec 3.6): not donut, not a category axis, not compact, not switched off. */
export function zoomApplies(view: View, option: unknown): boolean {
  if (option === false || view.kind === 'donut' || view.compact) return false;
  if (view.kind === 'scatter') return true;
  return view.frame.x.kind !== 'category';
}

/** The x position under a plot pixel, from the layout's projection; null on a band (category) axis. */
export function positionAt(layout: Layout, px: number, py: number): number | null {
  if (layout.kind !== 'plot') return null;
  const p = layout.projection;
  if (p.kind === 'xy') return p.x.type === 'band' ? null : p.x.invert(px);
  if (p.kind === 'bands') return p.band.type === 'band' ? null : p.band.invert(p.horizontal ? py : px);
  return null;
}

export type { PlotLayout };
