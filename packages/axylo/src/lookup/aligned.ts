import { binIndex } from '../data/search';
import { SLOT_NULL, SLOT_VALUE } from '../core/contracts';
import type { AlignedFrame, AlignedView, DatumRef, DatumText, Formatters, Lookup, PickTarget, Rect, SlotState, StepDirection, TooltipModel, XScale } from '../core/contracts';
import type { Messages } from '../public';
import { fill } from '../messages';
import { clipBox, contains, pointBox, POINTER_SLACK, type PlotLayout } from './geometry';
import { clamp, projectBand } from '../scene/geometry';
import { lowerBound, stepIndex } from './search';
import { incomplete, singleContinuousSeries, slotLabel, slotText } from './text';
import { seriesSlots, slotState } from '../data/store-statistics';

const TOOLTIP_LIMIT = 8;
let firstSeries: readonly number[] | undefined;
let noSeries: readonly number[] | undefined;

type MutableRow = { -readonly [K in keyof DatumText]: DatumText[K] };
type AlignedRef = Extract<DatumRef, { kind: 'aligned' }>;
type XTarget = Extract<PickTarget, { kind: 'x' }>;

export interface AlignedHoverModel {
  title: string;
  readonly rows: readonly [MutableRow];
  readonly count: 1;
  readonly total: null;
}

// Only unpinned hover owns a reusable model. Lookup.tooltip and datum still return snapshots.
export type AlignedHoverLookup = Lookup & {
  readonly alignedHover?: (target: XTarget, reuse: AlignedHoverModel | null) => AlignedHoverModel | null;
};

class AlignedLookup implements AlignedHoverLookup {
  readonly #frame: AlignedFrame;
  readonly #series: AlignedFrame['series'];
  readonly #stack: AlignedView['stack'];
  readonly #start: number;
  readonly #end: number;
  readonly #positions: Float64Array;
  readonly #visibility: AlignedView['visible'];
  readonly #visible: readonly number[];
  readonly #plot: Rect | undefined;
  readonly #projection: PlotLayout['projection'] | undefined;
  readonly #xScale: XScale | null;
  readonly #horizontal: boolean;
  readonly #singleSeries: ReturnType<typeof singleContinuousSeries>;
  readonly count: number;
  #keys: Map<string, number> | undefined;
  #bounds: Float64Array | undefined;
  #pickedSlot = -1;
  #pickedPixel = NaN;
  #pickedTarget: XTarget | undefined;
  #pickedRef: AlignedRef | undefined;
  #pickedAnchor: Rect | null | undefined;

  readonly #formatters: Formatters;
  readonly #messages: Messages;

  constructor(
    view: AlignedView,
    layout: PlotLayout | null,
    formatters: Formatters,
    messages: Messages,
  ) {
    this.#formatters = formatters;
    this.#messages = messages;
    const { frame, visibleSlots: { start, end }, stack } = view;
    const { series } = frame;
    if (series.length <= 1) {
      this.#visible = view.visible[0] && series[0]?.drawable ? firstSeries ??= [0] : noSeries ??= [];
    } else {
      const visible: number[] = [];
      for (let s = 0; s < series.length; s++) if (view.visible[s] && series[s]!.drawable) visible.push(s);
      this.#visible = visible;
    }
    const plot = layout?.plot, projection = layout?.projection;
    this.#frame = frame;
    this.#series = series;
    this.#stack = stack;
    this.#start = start;
    this.#end = end;
    this.#positions = frame.x.values;
    this.#visibility = view.visible;
    this.#plot = plot;
    this.#projection = projection;
    this.#xScale = projection?.kind === 'xy' ? projection.x : projection?.kind === 'bands' ? projection.band : null;
    this.#horizontal = projection?.kind === 'bands' && projection.horizontal;
    this.#singleSeries = singleContinuousSeries(view);
    this.count = end - start;
  }

  #inView(i: number): boolean { return i >= this.#start && i < this.#end; }

  #targetSlot(target: PickTarget): number {
    const i = target.kind === 'x' ? this.#index(target.x) : -1;
    return this.#inView(i) ? i : -1;
  }

  #seriesIndex(key: string): number | undefined {
    if (this.#series.length <= 4) {
      for (let s = this.#series.length - 1; s >= 0; s--) if (this.#series[s]!.key === key) return s;
      return undefined;
    }
    if (!this.#keys) {
      this.#keys = new Map();
      for (let s = 0; s < this.#series.length; s++) this.#keys.set(this.#series[s]!.key, s);
    }
    return this.#keys.get(key);
  }

  #ref(s: number, i: number): AlignedRef {
    if (this.#singleSeries && i === this.#pickedSlot) return this.#pickedRef ??= { kind: 'aligned', seriesKey: this.#singleSeries.key, x: this.#positions[i]! };
    return { kind: 'aligned', seriesKey: this.#series[s]!.key, x: this.#positions[i]! };
  }

  #index(x: number): number {
    // The tooltip, cursor, and focus usually ask about the x just picked.
    if (this.#pickedSlot >= 0 && this.#positions[this.#pickedSlot] === x) return this.#pickedSlot;
    const i = lowerBound(this.#positions, x);
    return this.#positions[i] === x ? i : -1;
  }

  #isValue(s: number, i: number): boolean {
    return slotState(this.#series[s]!, i) === SLOT_VALUE;
  }

  #seek(s: number, i: number, delta: 1 | -1, lo = this.#start, hi = this.#end): number {
    const slot = seriesSlots(this.#series[s]!);
    if (!slot) return i >= lo && i < hi ? i : -1;
    for (; i >= lo && i < hi; i += delta) if (slot[i] === SLOT_VALUE) return i;
    return -1;
  }

  #first(): DatumRef | null {
    let earliest = this.#end;
    let chosen = -1;
    for (const s of this.#visible) {
      const i = this.#seek(s, this.#start, 1, this.#start, earliest);
      if (i >= 0) {
        earliest = i;
        chosen = s;
      }
    }
    return chosen < 0 ? null : this.#ref(chosen, earliest);
  }

  /**
   * One series' row at a slot. Rows are plain: an incomplete stack is said once, on the tooltip's total
   * (spec F10, review C2-7). A single datum read on its own (`announce`) has no total beside it, so the
   * component that makes its stack incomplete says so; the values that are there are not qualified.
   */
  #write(s: number, i: number, announce = false, reuse?: MutableRow): MutableRow {
    const entry = this.#series[s]!;
    const state = slotState(entry, i) as SlotState;
    const value = slotText(this.#formatters, s, entry.y[i]!, state);
    const missingComponent = announce && state !== SLOT_VALUE
      && this.#stack?.incomplete?.[i] && this.#stack.order.includes(s) && this.#visible.includes(s);
    const datum = this.#ref(s, i), x = slotLabel(this.#frame, this.#formatters, i);
    const text = missingComponent ? incomplete(value, this.#messages) : value, row = entry.row?.[i] ?? i;
    if (reuse) {
      reuse.ref = datum; reuse.seriesLabel = entry.label; reuse.x = x;
      reuse.value = text; reuse.state = state; reuse.row = row;
      return reuse;
    }
    return { ref: datum, seriesIndex: s, seriesLabel: entry.label, x, value: text, state, percent: null, row };
  }

  #primaryAt(i: number): DatumRef | null {
    for (const s of this.#visible) if (this.#isValue(s, i)) return this.#ref(s, i);
    const s = this.#visible[0];
    return s === undefined ? null : this.#ref(s, i);
  }

  resolve(datum: DatumRef): DatumRef | null {
    if (datum.kind !== 'aligned') return null;
    const s = this.#seriesIndex(datum.seriesKey);
    if (s === undefined) return null;
    const i = lowerBound(this.#positions, datum.x);
    const exact = this.#inView(i) && this.#positions[i] === datum.x;
    if (!this.#visibility[s] || !this.#series[s]!.drawable) {
      return exact && !this.#visibility[s] ? this.#primaryAt(i) : null;
    }
    if (exact) return datum;
    const next = this.#seek(s, Math.max(i, this.#start), 1);
    const replacement = next >= 0 ? next : this.#seek(s, Math.min(i - 1, this.#end - 1), -1);
    return replacement < 0 ? null : this.#ref(s, replacement);
  }

  #nearestSlot(pixel: number): number {
    const xScale = this.#xScale, start = this.#start, end = this.#end, positions = this.#positions;
    if (!xScale || start === end) return -1;
    const x = xScale.invert(pixel);
    if (xScale.type === 'band') return this.#inView(x) ? x : -1;
    if (this.#frame.binEdges) {
      const bin = binIndex(this.#frame.binEdges, x);
      return bin >= 0 ? clamp(bin, start, end - 1) : -1;
    }
    const right = lowerBound(positions, x, start, end);
    if (right === start) return start;
    if (right === end) return end - 1;
    // Use screen distances for the final comparison because inversion can round at a midpoint.
    const leftPixel = xScale.map(positions[right - 1]!);
    const rightPixel = xScale.map(positions[right]!);
    const midpoint = leftPixel / 2 + rightPixel / 2;
    return (leftPixel <= rightPixel ? pixel >= midpoint : pixel <= midpoint) ? right : right - 1;
  }

  members(target: PickTarget, from: number, count: number): readonly DatumRef[] {
    const i = this.#targetSlot(target);
    // The tooltip's rows, in its order: the visible series at that x.
    from = Math.max(0, from);
    return i < 0 ? [] : this.#visible.slice(from, from + Math.max(0, count)).map(s => this.#ref(s, i));
  }

  has(target: PickTarget, datum: DatumRef): boolean {
    const i = this.#targetSlot(target);
    if (i < 0 || datum.kind !== 'aligned' || datum.x !== this.#positions[i]) return false;
    const s = this.#seriesIndex(datum.seriesKey);
    return s !== undefined && !!this.#visibility[s] && this.#series[s]!.drawable;
  }

  slot(datum: DatumRef): number {
    return datum.kind === 'aligned' && this.#seriesIndex(datum.seriesKey) !== undefined ? this.#index(datum.x) : -1;
  }

  pick(pointerX: number, pointerY: number): PickTarget | null {
    const plot = this.#plot;
    if (!plot || !this.#visible.length) return null;
    const { x, y, width, height } = plot, right = x + width, bottom = y + height;
    // Clamp the picking axis only, with the same one-pixel allowance as pointerOnPlot.
    if (!(pointerX >= x - POINTER_SLACK && pointerX <= right + POINTER_SLACK &&
      pointerY >= y - POINTER_SLACK && pointerY <= bottom + POINTER_SLACK)) return null;
    const pixel = this.#horizontal ? Math.min(bottom, Math.max(y, pointerY)) : Math.min(right, Math.max(x, pointerX));
    if (this.#pickedTarget && pixel === this.#pickedPixel) return this.#pickedTarget;
    const i = this.#nearestSlot(pixel);
    if (i < 0) return null;
    this.#pickedPixel = pixel;
    if (i !== this.#pickedSlot) {
      this.#pickedSlot = i;
      this.#pickedRef = this.#pickedAnchor = undefined;
      this.#pickedTarget = { kind: 'x', x: this.#positions[i]! };
    }
    return this.#pickedTarget!;
  }

  tooltip(target: PickTarget): TooltipModel {
    const i = this.#targetSlot(target);
    if (i < 0) return { title: '', rows: [], count: 0, total: null };
    const stack = this.#stack, formatters = this.#formatters;
    let total: string | null = null;
    if (stack && stack.order.length) {
      let positive = 0;
      let negative = 0;
      let hasValue = false;
      for (const s of stack.order) {
        if (!this.#isValue(s, i)) continue;
        const value = this.#series[s]!.y[i]!;
        if (value < 0) negative += value;
        else positive += value;
        hasValue = true;
      }
      const first = stack.order[0]!;
      total = !hasValue ? formatters.missing(SLOT_NULL)
        : positive > 0 && negative < 0 ? fill(this.#messages.totalMixed, {
          positive: formatters.value(first, positive), negative: formatters.value(first, negative),
        }) : formatters.value(first, positive + negative);
      if (hasValue && stack.incomplete?.[i]) total = incomplete(total, this.#messages);
    }
    const title = slotLabel(this.#frame, formatters, i);
    const shown = Math.min(this.#visible.length, TOOLTIP_LIMIT);
    const rows: DatumText[] = [];
    for (let row = 0; row < shown; row++) rows.push(this.#write(this.#visible[row]!, i));
    return { title, rows, count: this.#visible.length, total };
  }

  primary(target: PickTarget): DatumRef | null {
    const i = this.#targetSlot(target);
    return i < 0 ? null : this.#primaryAt(i);
  }

  datum(datum: DatumRef): DatumText | null {
    if (datum.kind !== 'aligned') return null;
    const s = this.#seriesIndex(datum.seriesKey);
    const i = this.#index(datum.x);
    return s === undefined || i < 0 ? null : this.#write(s, i, true);
  }

  anchor(datum: DatumRef): Rect | null {
    const plot = this.#plot, projection = this.#projection, xScale = this.#xScale, stack = this.#stack;
    if (datum.kind !== 'aligned' || !plot || !projection || !xScale) return null;
    if (datum === this.#pickedRef && this.#pickedAnchor !== undefined) return this.#pickedAnchor;
    const s = this.#seriesIndex(datum.seriesKey);
    const i = this.#index(datum.x);
    const lane = s === undefined ? -1 : this.#visible.indexOf(s);
    if (s === undefined || lane < 0 || !this.#inView(i)) return null;
    const value = this.#series[s]!.y[i]!;
    const present = this.#isValue(s, i);
    const accumulated = stack?.order.indexOf(s) ?? -1;
    const side = value < 0 ? stack?.negative : stack?.positive;
    const top = accumulated < 0 ? value : side![accumulated]![i]!;
    if (projection.kind === 'xy') {
      const cache = this.#singleSeries !== undefined && i === this.#pickedSlot;
      if (cache && this.#pickedAnchor !== undefined) return this.#pickedAnchor;
      if (!present) {
        if (cache) this.#pickedAnchor = null;
        return null;
      }
      const x = xScale.type === 'band' ? xScale.center(datum.x) : xScale.map(datum.x);
      const y = projection.y.map(top);
      const box = contains(plot, x, y) ? pointBox(x, y) : null;
      if (cache) this.#pickedAnchor = box;
      return box;
    }
    if (projection.kind !== 'bands') return null;
    const horizontal = projection.horizontal;
    const low = horizontal ? plot.y : plot.x;
    const high = low + (horizontal ? plot.height : plot.width);
    const bounds = this.#bounds ??= new Float64Array(2);
    projectBand(this.#frame, xScale, i, high - low, bounds, 0);
    const bandStart = clamp(bounds[0]!, low, high);
    const part = (clamp(bounds[1]!, low, high) - bandStart) / (stack ? 1 : this.#visible.length);
    const size = this.#frame.binEdges ? part : Math.max(1, part);
    const middle = bandStart + part * ((stack ? 0 : lane) + 0.5);
    const band = clamp(middle - size / 2, low, Math.max(low, high - size));
    const base = accumulated > 0 ? side![accumulated - 1]![i]! : 0;
    const valueLow = horizontal ? plot.x : plot.y;
    const valueHigh = valueLow + (horizontal ? plot.width : plot.height);
    const baseline = projection.value.map(base);
    const tip = present ? projection.value.map(top) : baseline;
    let a = clamp(baseline, valueLow, valueHigh);
    const b = clamp(tip, valueLow, valueHigh);
    const mixedSign = value < 0 && (stack?.positive.at(-1)?.[i] ?? 0) > 0;
    if (stack && (base !== 0 || mixedSign) && Math.abs(b - a) > 1 && baseline === a) {
      a += Math.sign(b - a);
    }
    const length = Math.abs(a - b);
    const edge = Math.min(a, b);
    const box = horizontal ? { x: edge, y: band, width: length, height: size }
      : { x: band, y: edge, width: size, height: length };
    if (!present) {
      // The renderer grows missing markers from a zero-length baseline rectangle.
      const height = Math.max(6, box.height);
      return clipBox({ ...box, y: box.y + box.height - height, height, width: Math.max(6, box.width) }, plot);
    }
    if (length === 0 && (baseline < valueLow && tip < valueLow || baseline > valueHigh && tip > valueHigh)) return null;
    return clipBox(box, plot);
  }

  ordinal(datum: DatumRef): number {
    if (datum.kind !== 'aligned') return -1;
    const s = this.#seriesIndex(datum.seriesKey);
    const i = this.#index(datum.x);
    return s !== undefined && this.#visibility[s] && this.#series[s]!.drawable && this.#inView(i) ? i - this.#start : -1;
  }

  step(from: DatumRef | null, direction: StepDirection): DatumRef | null {
    if (!from) return this.#first();
    const resolved = this.resolve(from);
    if (resolved?.kind !== 'aligned') return null;
    const s = this.#seriesIndex(resolved.seriesKey)!;
    const at = this.#index(resolved.x);
    let to = -1;
    switch (direction) {
      case 'series-next':
      case 'series-previous': {
        const neighbor = this.#visible[this.#visible.indexOf(s) + (direction === 'series-next' ? 1 : -1)];
        return neighbor === undefined ? null : this.#ref(neighbor, at);
      }
      case 'first': to = this.#seek(s, this.#start, 1); break;
      case 'last': to = this.#seek(s, this.#end - 1, -1); break;
      case 'next': to = this.#seek(s, at + 1, 1); break;
      case 'previous': to = this.#seek(s, at - 1, -1); break;
      case 'page-next':
      case 'page-previous': {
        const forward = direction === 'page-next';
        const delta = forward ? 1 : -1;
        const target = stepIndex(direction, at, this.#start, this.#end);
        if (target === null) return null;
        to = this.#seek(s, target, delta);
        if (to < 0) to = this.#seek(s, target - delta, forward ? -1 : 1, forward ? at + 1 : this.#start, forward ? this.#end : at);
        break;
      }
    }
    return to < 0 || to === at ? null : this.#ref(s, to);
  }

  get alignedHover(): AlignedHoverLookup['alignedHover'] {
    return this.#singleSeries ? this.#hover : undefined;
  }

  #hover(target: XTarget, reuse: AlignedHoverModel | null): AlignedHoverModel | null {
    const i = this.#targetSlot(target);
    if (i < 0) return null;
    const title = slotLabel(this.#frame, this.#formatters, i);
    if (!reuse) return { title, rows: [this.#write(0, i)], count: 1, total: null };
    this.#write(0, i, false, reuse.rows[0]);
    reuse.title = title;
    return reuse;
  }
}

export function alignedLookup(view: AlignedView, layout: PlotLayout | null, formatters: Formatters, messages: Messages): Lookup {
  return new AlignedLookup(view, layout, formatters, messages);
}
