/**
 * Multi-axis mixed-layer lookup for `axylo/cartesian` (C4.3, RFC §5.2).
 * Uses `axisScaleOf(projection, s.axisIndex)` (same projection authority as `scene.ts`), filters
 * nonpositive values on `'log'` axes before projecting, and enforces deterministic pick priority:
 *   1. Shared x-slot `i` in `visibleSlots`
 *   2. Nearest drawable `line` vertex within `12 px` y-distance (tie-break: later declared layer)
 *   3. Else visible `bar` rectangle hit at slot `i`
 *   4. Else aligned slot `i` (`{ kind: 'x', x }`) listing all visible series in declared layer order
 *
 * Stacks follow spec F10 as the core lookup does: the tooltip carries the stack total (the positive and the
 * negative ends when signs are mixed) marked "incomplete" where a component is missing, and a datum read on its
 * own (keyboard) says so on the missing component.
 */
import {
  SLOT_VALUE, type AlignedView, type DatumRef, type DatumText, type Formatters,
  type Layout, type Lookup, type PickTarget, type Projection, type Rect, type SlotState,
  type StepDirection, type TooltipModel, type View, type XScale,
} from '../core/contracts';
import type { Messages } from '../public';
import { clamp, position } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { barBoxAt, buildBarSlotLayout, xSlotPixel, type BarSlotLayout } from './bar-geom';
import type { CartesianStateRef } from './meta';
import { cartesianStacks, drawnValue, stackTotalText, type CartesianStacks } from './stacks';
import { incomplete } from '../lookup/text';
import { lowerBound } from '../data/search';

const LINE_HIT_RADIUS = 12;
const TOOLTIP_LIMIT = 8;

// The scene's pixel for slot i (bar-geom.ts), so picking and drawing agree.
const xCoord = xSlotPixel;

function pointBox(x: number, y: number): Rect {
  return { x: x - 5, y: y - 5, width: 10, height: 10 };
}

export function createCartesianLookup(
  stateRef: CartesianStateRef,
  view: View,
  layout: Layout,
  formatters: Formatters,
  messages: Messages,
): Lookup {
  // The composition is a 'line' composition (cartesian.ts), so every view it builds is aligned
  // (buildCartesianView keeps the base view's kind): no donut or scatter view ever reaches this lookup.
  return new CartesianLookup(stateRef, view as AlignedView, layout.kind === 'plot' ? layout : null, formatters, messages);
}

class CartesianLookup implements Lookup {
  readonly #stateRef: CartesianStateRef;
  readonly #view: AlignedView;
  readonly #plot: Rect | null;
  readonly #projection: Projection | null;
  readonly #xScale: XScale | null;
  readonly #formatters: Formatters;
  readonly #messages: Messages;
  readonly #stacks: CartesianStacks;
  readonly #visible: readonly number[];
  readonly #barSeries: readonly number[];
  readonly #barLayout: BarSlotLayout;
  readonly #start: number;
  readonly #end: number;
  readonly count: number;

  constructor(
    stateRef: CartesianStateRef,
    view: AlignedView,
    layout: Extract<Layout, { kind: 'plot' }> | null,
    formatters: Formatters,
    messages: Messages,
  ) {
    this.#stateRef = stateRef;
    this.#messages = messages;
    this.#stacks = cartesianStacks(view, stateRef.meta);
    this.#view = view;
    this.#plot = layout?.plot ?? null;
    this.#projection = layout?.projection ?? null;
    this.#xScale = layout && layout.projection.kind !== 'ring'
      ? (layout.projection.kind === 'xy' ? layout.projection.x : layout.projection.band)
      : null;
    this.#formatters = formatters;
    this.#start = view.visibleSlots.start;
    this.#end = view.visibleSlots.end;
    this.count = Math.max(0, this.#end - this.#start);

    const visible: number[] = [];
    const barSeries: number[] = [];
    for (let s = 0; s < view.frame.series.length; s++) {
      if (view.visible[s] && view.frame.series[s]!.drawable) {
        visible.push(s);
        if (stateRef.meta.seriesByField.get(view.frame.series[s]!.field)?.mark === 'bar') barSeries.push(s);
      }
    }
    this.#visible = visible;
    this.#barSeries = barSeries;
    this.#barLayout = buildBarSlotLayout(view, this.#projection, this.#plot, stateRef.meta, barSeries);
  }

  #slotForX(x: number): number {
    const vals = this.#view.frame.x.values;
    const i = lowerBound(vals, x, this.#start, this.#end);
    return i < this.#end && vals[i] === x ? i : -1;
  }

  #seriesIndex(key: string): number {
    return this.#view.frame.series.findIndex(s => s.key === key);
  }

  #isLogAxis(seriesIndex: number): boolean {
    const s = this.#view.frame.series[seriesIndex];
    const axis = s?.axisId ? this.#stateRef.meta.axisById.get(s.axisId) : undefined;
    return axis?.scale === 'log';
  }

  #isPlottableAt(sIdx: number, slotIndex: number): boolean {
    const s = this.#view.frame.series[sIdx]!;
    if (s.slot[slotIndex] !== SLOT_VALUE) return false;
    // A SLOT_VALUE is always finite (core/contracts.ts).
    return !this.#isLogAxis(sIdx) || s.y[slotIndex]! > 0;
  }

  #datumText(sIdx: number, slotIndex: number, announce = false): DatumText {
    const s = this.#view.frame.series[sIdx]!;
    const st = s.slot[slotIndex]! as SlotState;
    const xVal = this.#view.frame.x.values[slotIndex]!;
    const ref: DatumRef = { kind: 'aligned', seriesKey: s.key, x: xVal };
    let valueText: string;
    if (st === SLOT_VALUE) {
      const v = s.y[slotIndex]!;
      const formatted = this.#formatters.value(sIdx, v);
      valueText = this.#isLogAxis(sIdx) && !(v > 0) ? `${formatted} (not plotted)` : formatted;
    } else {
      valueText = this.#formatters.missing(st);
      // Read on its own, the component that makes its stack incomplete says so (F10, as lookup/aligned.ts).
      if (announce && this.#stacks.groupOf[sIdx]! >= 0) {
        valueText = incomplete(valueText, this.#messages);
      }
    }
    return {
      ref,
      seriesIndex: sIdx,
      seriesLabel: s.label,
      x: this.#formatters.x(xVal),
      value: valueText,
      state: st,
      percent: null,
      row: s.row ? s.row[slotIndex]! : slotIndex,
    };
  }

  #nearestSlot(xPx: number): number {
    const xScale = this.#xScale;
    if (!xScale || this.count === 0) return -1;
    if (xScale.type === 'band') {
      const idx = clamp(Math.round(xScale.invert(xPx)), this.#start, this.#end - 1);
      return idx;
    }
    const domainX = xScale.invert(xPx);
    const vals = this.#view.frame.x.values;
    const i = lowerBound(vals, domainX, this.#start, this.#end);
    if (i <= this.#start) return this.#start;
    if (i >= this.#end) return this.#end - 1;
    const dPrev = Math.abs(xCoord(xScale, vals, i - 1) - xPx);
    const dCurr = Math.abs(xCoord(xScale, vals, i) - xPx);
    return dPrev <= dCurr ? i - 1 : i;
  }

  #pickPreferredSeries(slotIndex: number, xPx: number, yPx: number): number {
    const projection = this.#projection;
    const plot = this.#plot;
    if (!projection || !plot || projection.kind === 'ring') return this.#visible[0] ?? -1;
    const { meta } = this.#stateRef;

    // 1. Nearest visible drawable line vertex within 12 px (tie-break: later declared layer)
    let bestLine = -1;
    let bestDist = LINE_HIT_RADIUS + 1e-6;
    for (const sIdx of this.#visible) {
      const s = this.#view.frame.series[sIdx]!;
      const spec = meta.seriesByField.get(s.field);
      if ((spec?.mark ?? 'line') !== 'line') continue;
      if (!this.#isPlottableAt(sIdx, slotIndex)) continue;
      const scale = axisScaleOf(projection, s.axisIndex ?? 0);
      const py = position(scale, s.y[slotIndex]!);
      const dist = Math.abs(py - yPx);
      if (dist <= bestDist) {
        bestDist = dist;
        bestLine = sIdx;
      }
    }
    if (bestLine >= 0) return bestLine;

    // 2. Visible bar rectangle containing (xPx, yPx) using exact shared bar geometry (grouped + stacked):
    // check exact containment first so stacked edges never mis-attribute to the adjacent segment.
    let fuzzyBar = -1;
    for (let k = this.#barSeries.length - 1; k >= 0; k--) {
      const sIdx = this.#barSeries[k]!;
      const box = barBoxAt(this.#view, projection, plot, this.#barLayout, sIdx, slotIndex);
      if (!box) continue;
      if (xPx >= box.x && xPx <= box.x + box.width && yPx >= box.y && yPx <= box.y + box.height) {
        return sIdx;
      }
      if (fuzzyBar < 0 && xPx >= box.x - 1 && xPx <= box.x + box.width + 1 && yPx >= box.y - 2 && yPx <= box.y + box.height + 2) {
        fuzzyBar = sIdx;
      }
    }
    if (fuzzyBar >= 0) return fuzzyBar;

    return this.#visible[0] ?? -1;
  }

  #lastPickedSeries = -1;
  #lastPickedSlot = -1;

  pick(x: number, y: number): PickTarget | null {
    const plot = this.#plot;
    if (!plot || this.count === 0 || this.#visible.length === 0) return null;
    if (x < plot.x || x > plot.x + plot.width || y < plot.y || y > plot.y + plot.height) return null;
    const i = this.#nearestSlot(x);
    if (i < 0) return null;
    this.#lastPickedSlot = i;
    this.#lastPickedSeries = this.#pickPreferredSeries(i, x, y);
    return { kind: 'x', x: this.#view.frame.x.values[i]! };
  }

  members(target: PickTarget, from: number, count: number): readonly DatumRef[] {
    if (target.kind !== 'x' || count <= 0) return [];
    const i = this.#slotForX(target.x);
    if (i < 0) return [];
    const out: DatumRef[] = [];
    const end = Math.min(this.#visible.length, from + count);
    for (let k = Math.max(0, from); k < end; k++) {
      const s = this.#view.frame.series[this.#visible[k]!]!;
      out.push({ kind: 'aligned', seriesKey: s.key, x: target.x });
    }
    return out;
  }

  has(target: PickTarget, ref: DatumRef): boolean {
    if (target.kind !== 'x' || ref.kind !== 'aligned' || ref.x !== target.x) return false;
    const sIdx = this.#seriesIndex(ref.seriesKey);
    return sIdx >= 0 && this.#visible.includes(sIdx) && this.#slotForX(target.x) >= 0;
  }

  slot(ref: DatumRef): number {
    if (ref.kind !== 'aligned') return -1;
    return this.#slotForX(ref.x);
  }

  primary(target: PickTarget): DatumRef | null {
    if (target.kind !== 'x' || this.#visible.length === 0) return null;
    const i = this.#slotForX(target.x);
    if (i < 0) return null;
    const preferred = i === this.#lastPickedSlot && this.#lastPickedSeries >= 0 && this.#visible.includes(this.#lastPickedSeries)
      ? this.#lastPickedSeries
      : this.#visible[0]!;
    return { kind: 'aligned', seriesKey: this.#view.frame.series[preferred]!.key, x: target.x };
  }

  tooltip(target: PickTarget): TooltipModel {
    if (target.kind !== 'x') return { title: '', rows: [], count: 0, total: null };
    const i = this.#slotForX(target.x);
    if (i < 0) return { title: '', rows: [], count: 0, total: null };
    const title = this.#formatters.x(target.x);
    const shown = Math.min(this.#visible.length, TOOLTIP_LIMIT);
    const rows: DatumText[] = [];
    for (let k = 0; k < shown; k++) rows.push(this.#datumText(this.#visible[k]!, i));
    return { title, rows, count: this.#visible.length, total: stackTotalText(this.#view, this.#stacks, i, this.#formatters, this.#messages) };
  }

  datum(ref: DatumRef): DatumText | null {
    if (ref.kind !== 'aligned') return null;
    const sIdx = this.#seriesIndex(ref.seriesKey);
    const i = this.#slotForX(ref.x);
    if (sIdx < 0 || i < 0) return null;
    return this.#datumText(sIdx, i, true);
  }

  anchor(ref: DatumRef): Rect | null {
    const plot = this.#plot;
    const projection = this.#projection;
    const xScale = this.#xScale;
    if (ref.kind !== 'aligned' || !plot || !projection || !xScale || projection.kind === 'ring') return null;
    const sIdx = this.#seriesIndex(ref.seriesKey);
    const i = this.#slotForX(ref.x);
    if (sIdx < 0 || i < 0 || !this.#visible.includes(sIdx)) return null;
    const spec = this.#stateRef.meta.seriesByField.get(this.#view.frame.series[sIdx]!.field);
    if (spec?.mark === 'bar') return barBoxAt(this.#view, projection, plot, this.#barLayout, sIdx, i);
    if (!this.#isPlottableAt(sIdx, i)) return null;
    const s = this.#view.frame.series[sIdx]!;
    const yScale = axisScaleOf(projection, s.axisIndex ?? 0);
    const px = xCoord(xScale, this.#view.frame.x.values, i);
    const py = position(yScale, drawnValue(this.#view, this.#stacks, sIdx, i));
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    if (px < plot.x - 1 || px > plot.x + plot.width + 1 || py < plot.y - 1 || py > plot.y + plot.height + 1) return null;
    return pointBox(px, py);
  }

  resolve(ref: DatumRef): DatumRef | null {
    if (ref.kind !== 'aligned') return null;
    const sIdx = this.#seriesIndex(ref.seriesKey);
    const i = this.#slotForX(ref.x);
    return sIdx >= 0 && this.#visible.includes(sIdx) && i >= 0 ? ref : null;
  }

  ordinal(ref: DatumRef): number {
    if (ref.kind !== 'aligned') return -1;
    const sIdx = this.#seriesIndex(ref.seriesKey);
    const i = this.#slotForX(ref.x);
    return sIdx >= 0 && this.#visible.includes(sIdx) && i >= 0 ? i - this.#start : -1;
  }

  step(from: DatumRef | null, direction: StepDirection): DatumRef | null {
    if (this.count === 0 || this.#visible.length === 0) return null;
    const vals = this.#view.frame.x.values;
    if (!from) {
      const s = this.#visible[0]!;
      return { kind: 'aligned', seriesKey: this.#view.frame.series[s]!.key, x: vals[this.#start]! };
    }
    const resolved = this.resolve(from);
    if (!resolved || resolved.kind !== 'aligned') return null;
    const sIdx = this.#seriesIndex(resolved.seriesKey);
    const at = this.#slotForX(resolved.x);
    if (direction === 'series-next' || direction === 'series-previous') {
      const pos = this.#visible.indexOf(sIdx);
      const next = this.#visible[pos + (direction === 'series-next' ? 1 : -1)];
      return next === undefined ? null : { kind: 'aligned', seriesKey: this.#view.frame.series[next]!.key, x: resolved.x };
    }
    const page = Math.max(1, Math.round(this.count / 10));
    let to = at;
    if (direction === 'first') to = this.#start;
    else if (direction === 'last') to = this.#end - 1;
    else if (direction === 'next') to = Math.min(this.#end - 1, at + 1);
    else if (direction === 'previous') to = Math.max(this.#start, at - 1);
    else if (direction === 'page-next') to = Math.min(this.#end - 1, at + page);
    else if (direction === 'page-previous') to = Math.max(this.#start, at - page);
    return to === at ? null : { kind: 'aligned', seriesKey: this.#view.frame.series[sIdx]!.key, x: vals[to]! };
  }
}
