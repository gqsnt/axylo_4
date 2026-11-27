/**
 * Multi-axis mixed-layer lookup for `axylo/cartesian` (C4.3, RFC §5.2).
 * Enforces deterministic pick priority:
 *   1. Nearest line vertex (12 px at nearest slot) or scatter/box-outlier point (24 px across neighbouring slots)
 *   2. Visible bar rectangle hit at slot
 *   3. Drawn geometry of range, errorBar, or boxplot (later layers first)
 *   4. Aligned slot listing all visible series in declared layer order
 */
import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedView, type DatumRef, type DatumText, type Formatters,
  type Layout, type Lookup, type PickTarget, type Projection, type Rect, type SlotState,
  type StepDirection, type TooltipModel, type View,
} from '../core/contracts';
import type { Messages } from '../public';
import { clamp, position } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { barBoxAt, buildBarSlotLayout, xSlotPixel } from './bar-geom';
import type { CartesianStateRef } from './meta';
import {
  MEDIAN_WIDTH, RANGE_STROKE_WIDTH, WHISKER_WIDTH, boxHalfWidth, carrierReadout, intervalText, isCompoundKind, isLogSeries, markOf, partIndex, physicalOf, projectCompound, type CompoundSink, type LogicalKind, type PartRole,
} from './boxplot';
import { cartesianStacks, drawnValue, stackTotalText } from './stacks';
import { incomplete } from '../lookup/text';
import { lowerBound } from '../data/search';

const LINE_HIT_RADIUS = 12;
const POINT_HIT_RADIUS = 24;
const HIT_SLACK = 3;
const TOOLTIP_LIMIT = 8;

const pointBox = (x: number, y: number): Rect => ({ x: x - 5, y: y - 5, width: 10, height: 10 });

export function createCartesianLookup(
  stateRef: CartesianStateRef,
  rawView: View,
  rawLayout: Layout,
  formatters: Formatters,
  messages: Messages,
): Lookup {
  const view = rawView as AlignedView;
  const layout = rawLayout.kind === 'plot' ? rawLayout : null;
  const { meta } = stateRef;
  const { frame } = view;
  const { series } = frame;
  const vals = frame.x.values;
  const plot = layout?.plot ?? null;
  const projection: Exclude<Projection, { kind: 'ring' }> | null = layout && layout.projection.kind !== 'ring' ? layout.projection : null;
  const xScale = projection ? (projection.kind === 'xy' ? projection.x : projection.band) : null;
  const stacks = cartesianStacks(view, meta);
  const start = view.visibleSlots.start;
  const end = view.visibleSlots.end;
  const count = Math.max(0, end - start);
  const physical = physicalOf(view);
  const marks = series.map(s => markOf(meta, s.field));
  const boxHalf = projection ? boxHalfWidth(projection, vals, view.visibleSlots) : 0;

  const geometry = marks.map((m, i) => m && projection && plot
    ? projectCompound(m, physical, i, projection, plot, boxHalf) : null);

  const kindOf = (sIdx: number): LogicalKind => marks[sIdx]?.kind ?? meta.seriesByField.get(series[sIdx]!.field)?.mark ?? 'line';

  const visible: number[] = [];
  const barSeries: number[] = [];
  for (let s = 0; s < series.length; s++) {
    if (view.visible[s] && series[s]!.drawable) {
      visible.push(s);
      if (kindOf(s) === 'bar') barSeries.push(s);
    }
  }
  const barLayout = buildBarSlotLayout(view, projection, plot, meta, barSeries);

  const isLog = (s: AlignedView['frame']['series'][number] | undefined) => isLogSeries(meta, s);
  const readout = carrierReadout(meta, physical, formatters, ' (not plotted)');
  const slotForX = (x: number) => {
    const i = lowerBound(vals, x, start, end);
    return i < end && vals[i] === x ? i : -1;
  };
  const seriesIndex = (key: string) => series.findIndex(s => s.key === key);
  const isPlottable = (sIdx: number, i: number) => {
    const s = series[sIdx]!;
    return s.slot[i] === SLOT_VALUE && (!isLog(s) || s.y[i]! > 0);
  };
  const xAt = (i: number) => xSlotPixel(xScale!, vals, i);

  const datumText = (sIdx: number, i: number, announce = false): DatumText => {
    const s = series[sIdx]!;
    let state = s.slot[i]! as SlotState;
    let value: string;
    const mark = marks[sIdx];
    if (mark && isCompoundKind(mark.kind)) {
      state = SLOT_VALUE;
      const at = (role: PartRole) => partIndex(mark, physical, sIdx, role);
      const read = (role: PartRole) => {
        const idx = at(role);
        const part = physical.frame.series[idx];
        if (role !== 'y' && part && state === SLOT_VALUE) state = part.slot[i]! as SlotState;
        return readout.cell(idx, i);
      };
      if (mark.kind === 'boxplot') {
        const median = read('median'), min = read('min'), q1 = read('q1'), q3 = read('q3'), max = read('max');
        if (state !== SLOT_VALUE) {
          value = formatters.missing(state);
        } else {
          const list = readout.outliers(at('median'), mark.outliers, i);
          value = `median ${median} (min ${min}, Q1 ${q1}, Q3 ${q3}, max ${max}; ${list === null ? 'no outliers' : `outliers ${list}`})`;
        }
      } else {
        value = intervalText(mark, read);
      }
    } else if (state === SLOT_VALUE) {
      value = readout.value(sIdx, s.y[i]!);
    } else {
      value = formatters.missing(state);
      if (announce && stacks.groupOf[sIdx]! >= 0) value = incomplete(value, messages);
    }
    const xVal = vals[i]!;
    return {
      ref: { kind: 'aligned', seriesKey: s.key, x: xVal },
      seriesIndex: sIdx, seriesLabel: s.label, x: formatters.x(xVal), value, state, percent: null,
      row: s.row ? s.row[i]! : i,
    };
  };

  const nearestSlot = (xPx: number) => {
    if (!xScale || !count) return -1;
    if (xScale.type === 'band') return clamp(Math.round(xScale.invert(xPx)), start, end - 1);
    const i = lowerBound(vals, xScale.invert(xPx), start, end);
    if (i <= start) return start;
    if (i >= end) return end - 1;
    return Math.abs(xAt(i - 1) - xPx) <= Math.abs(xAt(i) - xPx) ? i - 1 : i;
  };

  const compoundBox = (sIdx: number, i: number): Rect | null => {
    const g = geometry[sIdx], mark = marks[sIdx];
    if (!g || !mark || g.rows[i] !== SLOT_VALUE) return null;
    const px = xAt(i), top = g.top(i), bottom = g.bottom(i);
    const half = mark.kind === 'boxplot' ? Math.max(boxHalf, g.cap) : Math.max(4, mark.kind === 'errorBar' ? g.cap : 0);
    if (!Number.isFinite(px) || !Number.isFinite(top) || !Number.isFinite(bottom)) return null;
    return { x: px - half, y: Math.min(top, bottom), width: 2 * half, height: Math.max(1, Math.abs(bottom - top)) };
  };

  /** The nearest slot from k in direction step that is drawn, skipping SLOT_NO_ROW as the painted band does. */
  const drawnNeighbour = (rows: Uint8Array, k: number, step: number) => {
    while (k >= start && k < end && rows[k] === SLOT_NO_ROW) k += step;
    return k >= start && k < end && rows[k] === SLOT_VALUE ? k : -1;
  };

  /** Distance from (xPx, yPx) to a painted rectangle clipped to plot, or Infinity when wholly clipped or empty. */
  const rectDist = (x1: number, y1: number, x2: number, y2: number, xPx: number, yPx: number): number => {
    if (!plot) return Infinity;
    const cx1 = Math.max(x1, plot.x), cx2 = Math.min(x2, plot.x + plot.width);
    const cy1 = Math.max(y1, plot.y), cy2 = Math.min(y2, plot.y + plot.height);
    if (!(cx2 > cx1 && cy2 > cy1)) return Infinity;
    const dx = xPx < cx1 ? cx1 - xPx : xPx > cx2 ? xPx - cx2 : 0;
    const dy = yPx < cy1 ? cy1 - yPx : yPx > cy2 ? yPx - cy2 : 0;
    return Math.hypot(dx, dy);
  };

  /** The slot and distance of the drawn compound geometry under/near the pointer, or null. */
  const compoundHit = (sIdx: number, i: number, xPx: number, yPx: number): { slot: number; dist: number } | null => {
    const mark = marks[sIdx];
    const g = geometry[sIdx];
    if (!mark || !plot || !g) return null;
    const { rows, cap } = g;
    // Butt-capped zero-length strokes paint nothing (render/svg.ts stroke-linecap="butt").
    const hSeg = (x1: number, x2: number, sy: number, sw: number) =>
      x2 > x1 ? rectDist(x1, sy - sw / 2, x2, sy + sw / 2, xPx, yPx) : Infinity;
    const vSeg = (sx: number, y1: number, y2: number, sw: number) => {
      const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
      return hi > lo ? rectDist(sx - sw / 2, lo, sx + sw / 2, hi, xPx, yPx) : Infinity;
    };
    if (mark.kind === 'range') {
      const bandDist = (l: number, r: number): number => {
        if (l < 0 || r < 0) return Infinity;
        const lx = xAt(l), rx = xAt(r);
        const x0 = Math.max(Math.min(lx, rx), plot.x), x1 = Math.min(Math.max(lx, rx), plot.x + plot.width);
        if (!(x1 > x0)) return Infinity;
        const cx = clamp(xPx, x0, x1);
        const t = rx === lx ? 0 : clamp((cx - lx) / (rx - lx), 0, 1);
        const a = g.top(l), b = g.bottom(l);
        const yA = a + t * (g.top(r) - a), yB = b + t * (g.bottom(r) - b);
        const yLo = Math.min(yA, yB), yHi = Math.max(yA, yB);
        return yHi > yLo ? rectDist(x0, yLo, x1, yHi, xPx, yPx) : Infinity;
      };
      if (rows[i] === SLOT_NO_ROW) {
        // keep(bridge) paints across a slot with no row; it has no reading, so report the nearer drawn end.
        const l = drawnNeighbour(rows, i - 1, -1), r = drawnNeighbour(rows, i + 1, 1);
        const dist = bandDist(l, r);
        return dist <= HIT_SLACK ? { slot: xPx - xAt(l) <= xAt(r) - xPx ? l : r, dist } : null;
      }
      if (rows[i] !== SLOT_VALUE) return null;
      const px = xAt(i), prev = drawnNeighbour(rows, i - 1, -1), next = drawnNeighbour(rows, i + 1, 1);
      // A lone row is painted as a 4 px butt-capped vertical stroke; endpoints fall back to their painted side.
      const dist = prev < 0 && next < 0 ? vSeg(px, g.top(i), g.bottom(i), RANGE_STROKE_WIDTH)
        : next < 0 || (xPx < px && prev >= 0) ? bandDist(prev, i) : bandDist(i, next);
      return dist <= HIT_SLACK ? { slot: i, dist } : null;
    }
    const halfMarker = (view.compact ? 3 : mark.size) / 2;
    const reach = (mark.kind === 'boxplot' ? Math.max(boxHalf, cap) : Math.max(cap, halfMarker, WHISKER_WIDTH / 2)) + HIT_SLACK;
    let dist = Infinity;
    const sink: CompoundSink = {
      box(x, halfWidth, y, h) { dist = Math.min(dist, rectDist(x - halfWidth, y, x + halfWidth, y + h, xPx, yPx)); },
      whisker(x1, y1, x2, y2) {
        const d = x1 === x2 ? vSeg(x1, y1, y2, WHISKER_WIDTH) : hSeg(x1, x2, y1, WHISKER_WIDTH);
        dist = Math.min(dist, d);
      },
      median(x1, x2, y) { dist = Math.min(dist, hSeg(x1, x2, y, MEDIAN_WIDTH)); },
      point(x, y) {
        if (Number.isFinite(y) && inPlot(x, y, halfMarker)) {
          dist = Math.min(dist, Math.max(0, Math.hypot(xPx - x, yPx - y) - halfMarker));
        }
      },
    };
    let bestSlot = -1, bestDist = Infinity, bestDx = Infinity;
    const check = (j: number, dx: number) => {
      if (rows[j] !== SLOT_VALUE) return;
      dist = Infinity;
      g.visit(j, xAt(j), sink);
      if (dist > HIT_SLACK) return;
      if (dist < bestDist || (dist === bestDist && (dx < bestDx || (dx === bestDx && j < bestSlot)))) {
        bestDist = dist; bestDx = dx; bestSlot = j;
      }
    };
    const iDx = Math.abs(xAt(i) - xPx);
    if (iDx <= reach) check(i, iDx);
    for (const step of [-1, 1]) {
      for (let j = i + step; j >= start && j < end; j += step) {
        const dx = Math.abs(xAt(j) - xPx);
        if (dx > reach) break;
        check(j, dx);
      }
    }
    return bestSlot >= 0 ? { slot: bestSlot, dist: bestDist } : null;
  };

  // A glyph clipped entirely outside the plot is not on screen, so it cannot win a pick (half = rendered half extent).
  const inPlot = (px: number, py: number, half: number) =>
    !!plot && px + half >= plot.x && px - half <= plot.x + plot.width && py + half >= plot.y && py - half <= plot.y + plot.height;

  let lastPickedSeries = -1;
  let lastPickedSlot = -1;
  let lastPickedAt: Rect | null = null;

  const pickPreferred = (slotIndex: number, xPx: number, yPx: number) => {
    const fallback = { series: visible[0] ?? -1, slot: slotIndex, at: null as Rect | null };
    if (!projection || !plot) return fallback;
    let best: typeof fallback | null = null;
    let bestDist = Infinity;
    const consider = (sIdx: number, j: number, px: number, py: number, dist: number, radius: number, half: number) => {
      if (!inPlot(px, py, half)) return;
      if (dist <= radius + 1e-6 && dist <= bestDist) { bestDist = dist; best = { series: sIdx, slot: j, at: pointBox(px, py) }; }
    };
    let outlierSeries = -1;
    const outlier = (v: number, slot: number) => {
      const x = xAt(slot), y = geometry[outlierSeries]!.pointY(v);
      consider(outlierSeries, slot, x, y, Math.hypot(x - xPx, y - yPx), POINT_HIT_RADIUS, marks[outlierSeries]!.size / 2);
    };
    const pointsAt = (j: number, px: number) => {
      for (const sIdx of visible) {
        const mark = marks[sIdx];
        const kind = kindOf(sIdx);
        if (kind === 'line' || kind === 'scatter') {
          if ((kind === 'line' && j !== slotIndex) || !isPlottable(sIdx, j)) continue;
          const s = series[sIdx]!;
          const py = position(axisScaleOf(projection, s.axisIndex ?? 0), s.y[j]!);
          consider(sIdx, j, px, py, kind === 'line' ? Math.abs(py - yPx) : Math.hypot(px - xPx, py - yPx), kind === 'line' ? LINE_HIT_RADIUS : POINT_HIT_RADIUS, (kind === 'line' ? 4 : mark?.size ?? 4) / 2);
        } else if (mark?.outliers && physical.rows?.[sIdx]?.[j] === SLOT_VALUE) {
          outlierSeries = sIdx;
          geometry[sIdx]?.outliers(j, outlier);
        }
      }
    };
    pointsAt(slotIndex, xAt(slotIndex));
    for (const step of [-1, 1]) {
      for (let j = slotIndex + step; j >= start && j < end; j += step) {
        const px = xAt(j);
        if (Math.abs(px - xPx) > POINT_HIT_RADIUS) break;
        pointsAt(j, px);
      }
    }
    if (best) return best;

    let fuzzyBar = -1;
    for (let k = barSeries.length - 1; k >= 0; k--) {
      const sIdx = barSeries[k]!;
      const box = barBoxAt(view, projection, plot, barLayout, sIdx, slotIndex);
      if (!box) continue;
      if (xPx >= box.x && xPx <= box.x + box.width && yPx >= box.y && yPx <= box.y + box.height) return { series: sIdx, slot: slotIndex, at: box };
      if (fuzzyBar < 0 && xPx >= box.x - 1 && xPx <= box.x + box.width + 1 && yPx >= box.y - 2 && yPx <= box.y + box.height + 2) fuzzyBar = sIdx;
    }
    if (fuzzyBar >= 0) return { series: fuzzyBar, slot: slotIndex, at: null };

    let bestCompound: { series: number; slot: number; dist: number } | null = null;
    for (let k = visible.length - 1; k >= 0; k--) {
      const sIdx = visible[k]!;
      const hit = compoundHit(sIdx, slotIndex, xPx, yPx);
      if (!hit) continue;
      if (hit.dist === 0) return { series: sIdx, slot: hit.slot, at: null };
      if (!bestCompound || hit.dist < bestCompound.dist) bestCompound = { series: sIdx, slot: hit.slot, dist: hit.dist };
    }
    if (bestCompound) return { series: bestCompound.series, slot: bestCompound.slot, at: null };
    return fallback;
  };

  const lookup: Lookup = {
    count,
    pick(x: number, y: number): PickTarget | null {
      if (!plot || !count || !visible.length) return null;
      if (x < plot.x || x > plot.x + plot.width || y < plot.y || y > plot.y + plot.height) return null;
      const nearest = nearestSlot(x);
      if (nearest < 0) return null;
      const hit = pickPreferred(nearest, x, y);
      lastPickedSlot = hit.slot;
      lastPickedSeries = hit.series;
      lastPickedAt = hit.at;
      return { kind: 'x', x: vals[hit.slot]! };
    },
    members(target: PickTarget, from: number, n: number): readonly DatumRef[] {
      if (target.kind !== 'x' || n <= 0 || slotForX(target.x) < 0) return [];
      const out: DatumRef[] = [];
      for (let k = Math.max(0, from), stop = Math.min(visible.length, from + n); k < stop; k++) {
        out.push({ kind: 'aligned', seriesKey: series[visible[k]!]!.key, x: target.x });
      }
      return out;
    },
    has(target: PickTarget, ref: DatumRef): boolean {
      if (target.kind !== 'x' || ref.kind !== 'aligned' || ref.x !== target.x) return false;
      const sIdx = seriesIndex(ref.seriesKey);
      return sIdx >= 0 && visible.includes(sIdx) && slotForX(target.x) >= 0;
    },
    slot: ref => ref.kind === 'aligned' ? slotForX(ref.x) : -1,
    primary(target: PickTarget): DatumRef | null {
      if (target.kind !== 'x' || !visible.length) return null;
      const i = slotForX(target.x);
      if (i < 0) return null;
      const preferred = i === lastPickedSlot && lastPickedSeries >= 0 && visible.includes(lastPickedSeries) ? lastPickedSeries : visible[0]!;
      return { kind: 'aligned', seriesKey: series[preferred]!.key, x: target.x };
    },
    tooltip(target: PickTarget): TooltipModel {
      if (target.kind !== 'x') return { title: '', rows: [], count: 0, total: null };
      const i = slotForX(target.x);
      if (i < 0) return { title: '', rows: [], count: 0, total: null };
      const rows: DatumText[] = [];
      for (let k = 0, shown = Math.min(visible.length, TOOLTIP_LIMIT); k < shown; k++) rows.push(datumText(visible[k]!, i));
      return { title: formatters.x(target.x), rows, count: visible.length, total: stackTotalText(view, stacks, i, formatters, messages) };
    },
    datum(ref: DatumRef): DatumText | null {
      if (ref.kind !== 'aligned') return null;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      return sIdx >= 0 && i >= 0 ? datumText(sIdx, i, true) : null;
    },
    anchor(ref: DatumRef): Rect | null {
      if (ref.kind !== 'aligned' || !plot || !projection) return null;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      if (sIdx < 0 || i < 0 || !visible.includes(sIdx)) return null;
      if (lastPickedAt && sIdx === lastPickedSeries && i === lastPickedSlot) return lastPickedAt;
      const kind = kindOf(sIdx);
      if (kind === 'bar') return barBoxAt(view, projection, plot, barLayout, sIdx, i);
      if (isCompoundKind(kind)) {
        const box = compoundBox(sIdx, i);
        if (!box) return null;
        const y0 = clamp(box.y, plot.y, plot.y + plot.height), y1 = clamp(box.y + box.height, plot.y, plot.y + plot.height);
        return { x: box.x, y: y0, width: box.width, height: Math.max(1, y1 - y0) };
      }
      if (!isPlottable(sIdx, i)) return null;
      const px = xAt(i), py = position(axisScaleOf(projection, series[sIdx]!.axisIndex ?? 0), drawnValue(view, stacks, sIdx, i));
      if (!Number.isFinite(px) || !Number.isFinite(py) || !inPlot(px, py, 1)) return null;
      return pointBox(px, py);
    },
    resolve(ref: DatumRef): DatumRef | null {
      if (ref.kind !== 'aligned') return null;
      const sIdx = seriesIndex(ref.seriesKey);
      return sIdx >= 0 && visible.includes(sIdx) && slotForX(ref.x) >= 0 ? ref : null;
    },
    ordinal(ref: DatumRef): number {
      if (ref.kind !== 'aligned') return -1;
      const sIdx = seriesIndex(ref.seriesKey), i = slotForX(ref.x);
      return sIdx >= 0 && visible.includes(sIdx) && i >= 0 ? i - start : -1;
    },
    step(from: DatumRef | null, direction: StepDirection): DatumRef | null {
      if (!count || !visible.length) return null;
      if (!from) return { kind: 'aligned', seriesKey: series[visible[0]!]!.key, x: vals[start]! };
      if (!lookup.resolve(from) || from.kind !== 'aligned') return null;
      const sIdx = seriesIndex(from.seriesKey), at = slotForX(from.x);
      if (direction === 'series-next' || direction === 'series-previous') {
        const next = visible[visible.indexOf(sIdx) + (direction === 'series-next' ? 1 : -1)];
        return next === undefined ? null : { kind: 'aligned', seriesKey: series[next]!.key, x: from.x };
      }
      const page = Math.max(1, Math.round(count / 10));
      const to = direction === 'first' ? start
        : direction === 'last' ? end - 1
        : direction === 'next' ? Math.min(end - 1, at + 1)
        : direction === 'previous' ? Math.max(start, at - 1)
        : direction === 'page-next' ? Math.min(end - 1, at + page)
        : direction === 'page-previous' ? Math.max(start, at - page) : at;
      return to === at ? null : { kind: 'aligned', seriesKey: series[sIdx]!.key, x: vals[to]! };
    },
  };
  return lookup;
}
