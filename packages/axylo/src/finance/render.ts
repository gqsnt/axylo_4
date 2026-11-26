/**
 * O(N) batched candlestick + volume scene builder, exact lookup/tooltip/keyboard navigation,
 * overlay cursor, and accessible table/summary reader for `axylo/finance` (C6.3).
 *
 * Colorblind-safe encoding:
 * - Up candles (`close > open`): hollow stroked rectangle outline (`PathMark`).
 * - Down candles (`close < open`): solid filled rectangle (`RectMark`).
 * - Unchanged / doji candles (`close === open`): crisp horizontal body bar (`PathMark`).
 * - Wicks: single batched `PathMark` across all valid candles (`1` SVG `<path>` even at 10k rows).
 */
import {
  SLOT_VALUE, type AlignedView, type DatumRef, type DatumText, type Formatters, type Layout,
  type Lookup, type Mark, type PathMark, type PickTarget, type Projection, type Rect, type RectMark,
  type RuleMark, type Scene, type SlotState, type StepDirection, type TableModel, type TooltipModel,
  type View, type XScale,
} from '../core/contracts';
import type { OverlayInput } from '../core/focus';
import type { Messages, XValue } from '../public';
import type { ReaderParts } from '../reader';
import { alignedReader } from '../reader';
import { boundaryPixel, clamp, position, rule, seriesPaint, token } from '../scene/geometry';
import {
  FLAG_INCOMPLETE_OHLC, FLAG_INVALID_OHLC, FLAG_INVALID_VOLUME,
  findOhlcSeries, formatFinancePrice, formatFinanceVolume, type FinanceStateRef,
} from './core';

const TICK_LENGTH = 4;
const REFERENCE_DASH = [4, 3] as const;

function xCoord(xScale: XScale, xVals: Float64Array, i: number): number {
  return xScale.type === 'band' ? xScale.center(i) : position(xScale, xVals[i]!);
}

function candleWidth(xScale: XScale, xVals: Float64Array, start: number, end: number, plotWidth: number): number {
  if (xScale.type === 'band') return clamp(xScale.bandwidth * 0.65, 2, 24);
  const count = Math.max(1, end - start);
  if (count === 1) return Math.min(20, plotWidth * 0.25);
  let minGap = Infinity;
  let prev = position(xScale, xVals[start]!);
  for (let i = start + 1; i < end; i++) {
    const cur = position(xScale, xVals[i]!);
    const gap = Math.abs(cur - prev);
    if (gap > 0 && gap < minGap) minGap = gap;
    prev = cur;
  }
  const base = Number.isFinite(minGap) ? minGap * 0.65 : (plotWidth / count) * 0.65;
  return clamp(base, 2, 24);
}

export function buildFinanceScene(
  stateRef: FinanceStateRef,
  view: View,
  layout: Layout,
  _dpr: number,
): Scene {
  if ((layout.kind !== 'plot' && layout.kind !== 'compact') || view.kind === 'donut' || view.kind === 'scatter') {
    return { width: layout.width, height: layout.height, clip: { x: 0, y: 0, width: layout.width, height: layout.height }, marks: [] };
  }
  const { plot, projection } = layout;
  if (projection.kind === 'ring') return { width: layout.width, height: layout.height, clip: plot, marks: [] };

  const compact = layout.kind === 'compact' || view.compact;
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const yScale = projection.kind === 'xy' ? projection.y : projection.value;
  const left = plot.x;
  const right = plot.x + plot.width;
  const top = plot.y;
  const bottom = plot.y + plot.height;

  const marks: Mark[] = [];
  const edges: RuleMark[] = [];
  const refLines: RuleMark[] = [];

  // 1. Reference bands & gridlines
  if (!compact && view.references.length) {
    const paint = token('reference');
    for (const ref of view.references) {
      if (ref.axis === 'x') {
        const a = xScale.type === 'band' ? xScale.center(ref.from) : position(xScale, ref.from);
        const b = xScale.type === 'band' ? xScale.center(ref.to) : position(xScale, ref.to);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = clamp(Math.min(a, b), left, right);
        const hi = clamp(Math.max(a, b), left, right);
        if (ref.from === ref.to) refLines.push({ ...rule('reference', paint, lo, top, lo, bottom), strokeWidth: 1.5, dash: REFERENCE_DASH });
        else marks.push({ type: 'band', box: { x: lo, y: top, width: Math.max(1, hi - lo), height: plot.height }, fill: paint, opacity: 0.12 });
      } else {
        const a = position(yScale, ref.from);
        const b = position(yScale, ref.to);
        if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
        const lo = clamp(Math.min(a, b), top, bottom);
        const hi = clamp(Math.max(a, b), top, bottom);
        if (ref.from === ref.to) refLines.push({ ...rule('reference', paint, left, lo, right, lo), strokeWidth: 1.5, dash: REFERENCE_DASH });
        else marks.push({ type: 'band', box: { x: left, y: lo, width: plot.width, height: Math.max(1, hi - lo) }, fill: paint, opacity: 0.12 });
      }
    }
  }

  if (layout.kind === 'plot' && !compact) {
    const axisPaint = token('axis');
    const gridPaint = token('grid');
    edges.push(rule('axis', axisPaint, left, bottom, right, bottom));
    edges.push(rule('axis', axisPaint, left, top, left, bottom));
    for (const tick of layout.xTicks) {
      const px = boundaryPixel(xScale.type === 'band' ? xScale.center(tick.value) : position(xScale, tick.value), left, right);
      if (px !== null) edges.push(rule('tick', axisPaint, px, bottom, px, bottom + TICK_LENGTH));
    }
    for (const tick of layout.yTicks) {
      const py = boundaryPixel(position(yScale, tick.value), top, bottom);
      if (py === null) continue;
      marks.push(rule('grid', gridPaint, left, py, right, py));
      edges.push(rule('tick', axisPaint, left - TICK_LENGTH, py, left, py));
    }
  }

  const { meta } = stateRef;
  const { open, high, low, close, volume } = findOhlcSeries(view.frame, meta);
  if (open && high && low && close) {
    const flags = meta.slotFlags;
    const xVals = view.frame.x.values;
    const { start, end } = view.visibleSlots;
    const nSlots = Math.max(0, end - start);
    const bodyW = candleWidth(xScale, xVals, start, end, plot.width);
    const halfW = bodyW / 2;

    // Optional volume panel in bottom 22% of plot (independent positive volume scale)
    if (volume && nSlots > 0) {
      let maxVol = 0;
      for (let i = start; i < end; i++) {
        if ((flags[i]! & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC | FLAG_INVALID_VOLUME)) !== 0) continue;
        if (volume.slot[i] !== SLOT_VALUE) continue;
        const v = volume.y[i]!;
        if (v > maxVol && Number.isFinite(v)) maxVol = v;
      }
      if (maxVol > 0) {
        const volMaxH = Math.max(8, plot.height * 0.22);
        const volBuf = new Float32Array(nSlots * 4);
        let vp = 0;
        for (let i = start; i < end; i++) {
          if ((flags[i]! & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC | FLAG_INVALID_VOLUME)) !== 0) continue;
          if (volume.slot[i] !== SLOT_VALUE) continue;
          const v = volume.y[i]!;
          if (!(v > 0) || !Number.isFinite(v)) continue;
          const cx = xCoord(xScale, xVals, i);
          const vh = Math.max(1, (v / maxVol) * volMaxH);
          volBuf[vp++] = cx - halfW;
          volBuf[vp++] = bottom - vh;
          volBuf[vp++] = bodyW;
          volBuf[vp++] = vh;
        }
        if (vp > 0) {
          marks.push({
            type: 'rects',
            series: 2,
            xywh: vp === volBuf.length ? volBuf : volBuf.subarray(0, vp),
            fill: seriesPaint(2),
            variant: 'bar',
          } satisfies RectMark);
        }
      }
    }

    // Batched O(N) typed buffers for wicks/dojis, hollow up bodies, and filled down bodies
    const wickBuf = new Float32Array(nSlots * 12);
    let wickPos = 0;
    const upBuf = new Float32Array(nSlots * 12); // closed 5-vertex rect + NaN separator = 12 floats
    let upPos = 0;
    const downBuf = new Float32Array(nSlots * 4);
    let downPos = 0;

    for (let i = start; i < end; i++) {
      if ((flags[i]! & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC)) !== 0) continue;
      const o = open.y[i]!;
      const h = high.y[i]!;
      const l = low.y[i]!;
      const c = close.y[i]!;
      const cx = xCoord(xScale, xVals, i);
      const yH = position(yScale, h);
      const yL = position(yScale, l);
      const yO = position(yScale, o);
      const yC = position(yScale, c);

      if (c > o) {
        // Up candle: hollow stroked rectangle outline + upper/lower wicks stopping cleanly at body edges
        const topY = Math.min(yO, yC);
        const botY = Math.max(topY + 1, Math.max(yO, yC));
        if (yH < topY) {
          wickBuf[wickPos++] = cx; wickBuf[wickPos++] = yH;
          wickBuf[wickPos++] = cx; wickBuf[wickPos++] = topY;
          wickBuf[wickPos++] = NaN; wickBuf[wickPos++] = NaN;
        }
        if (yL > botY) {
          wickBuf[wickPos++] = cx; wickBuf[wickPos++] = botY;
          wickBuf[wickPos++] = cx; wickBuf[wickPos++] = yL;
          wickBuf[wickPos++] = NaN; wickBuf[wickPos++] = NaN;
        }
        const x0 = cx - halfW;
        const x1 = cx + halfW;
        upBuf[upPos++] = x0; upBuf[upPos++] = topY;
        upBuf[upPos++] = x1; upBuf[upPos++] = topY;
        upBuf[upPos++] = x1; upBuf[upPos++] = botY;
        upBuf[upPos++] = x0; upBuf[upPos++] = botY;
        upBuf[upPos++] = x0; upBuf[upPos++] = topY;
        upBuf[upPos++] = NaN; upBuf[upPos++] = NaN;
      } else if (c < o) {
        // Down candle: full wick + filled solid rectangle
        wickBuf[wickPos++] = cx; wickBuf[wickPos++] = yH;
        wickBuf[wickPos++] = cx; wickBuf[wickPos++] = yL;
        wickBuf[wickPos++] = NaN; wickBuf[wickPos++] = NaN;
        const topY = Math.min(yO, yC);
        const hPx = Math.max(1, Math.abs(yC - yO));
        downBuf[downPos++] = cx - halfW;
        downBuf[downPos++] = topY;
        downBuf[downPos++] = bodyW;
        downBuf[downPos++] = hPx;
      } else {
        // Unchanged / doji: full wick + horizontal crossbar across candle width
        wickBuf[wickPos++] = cx; wickBuf[wickPos++] = yH;
        wickBuf[wickPos++] = cx; wickBuf[wickPos++] = yL;
        wickBuf[wickPos++] = NaN; wickBuf[wickPos++] = NaN;
        wickBuf[wickPos++] = cx - halfW; wickBuf[wickPos++] = yC;
        wickBuf[wickPos++] = cx + halfW; wickBuf[wickPos++] = yC;
        wickBuf[wickPos++] = NaN; wickBuf[wickPos++] = NaN;
      }
    }

    if (wickPos >= 4) {
      marks.push({
        type: 'path',
        series: 0,
        xy: wickPos === wickBuf.length ? wickBuf : wickBuf.subarray(0, wickPos),
        stroke: token('axis'),
        strokeWidth: 1.25,
        dash: { normal: null, contrast: null },
      } satisfies PathMark);
    }
    if (downPos >= 4) {
      marks.push({
        type: 'rects',
        series: 1,
        xywh: downPos === downBuf.length ? downBuf : downBuf.subarray(0, downPos),
        fill: seriesPaint(1),
        variant: 'bar',
      } satisfies RectMark);
    }
    if (upPos >= 10) {
      marks.push({
        type: 'path',
        series: 0,
        xy: upPos === upBuf.length ? upBuf : upBuf.subarray(0, upPos),
        stroke: seriesPaint(0),
        strokeWidth: 1.75,
        dash: { normal: null, contrast: null },
      } satisfies PathMark);
    }
  }

  marks.push(...edges, ...refLines);
  return { width: layout.width, height: layout.height, clip: plot, marks };
}

function lowerBound(arr: Float64Array, value: number, lo: number, hi: number): number {
  let l = lo, r = hi;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (arr[m]! < value) l = m + 1;
    else r = m;
  }
  return l;
}

function directionOf(open: number, close: number): 'up' | 'down' | 'unchanged' {
  return close > open ? 'up' : close < open ? 'down' : 'unchanged';
}

export function createFinanceLookup(
  stateRef: FinanceStateRef,
  view: View,
  layout: Layout,
  formatters: Formatters,
  _messages: Messages,
  locale = 'en-US',
): Lookup {
  if (view.kind === 'donut' || view.kind === 'scatter') {
    return {
      count: 0, pick: () => null, members: () => [], has: () => false, slot: () => -1, primary: () => null,
      tooltip: () => ({ title: '', rows: [], count: 0, total: null }), datum: () => null, anchor: () => null,
      resolve: () => null, ordinal: () => -1, step: () => null,
    };
  }
  return new FinanceLookup(stateRef, view, layout.kind === 'plot' ? layout : null, formatters, locale);
}

class FinanceLookup implements Lookup {
  readonly #stateRef: FinanceStateRef;
  readonly #view: AlignedView;
  readonly #plot: Rect | null;
  readonly #projection: Projection | null;
  readonly #xScale: XScale | null;
  readonly #formatters: Formatters;
  readonly #locale: string;
  readonly #start: number;
  readonly #end: number;
  readonly count: number;

  constructor(
    stateRef: FinanceStateRef,
    view: AlignedView,
    layout: Extract<Layout, { kind: 'plot' }> | null,
    formatters: Formatters,
    locale: string,
  ) {
    this.#stateRef = stateRef;
    this.#view = view;
    this.#plot = layout?.plot ?? null;
    this.#projection = layout?.projection ?? null;
    this.#xScale = layout && layout.projection.kind !== 'ring'
      ? (layout.projection.kind === 'xy' ? layout.projection.x : layout.projection.band)
      : null;
    this.#formatters = formatters;
    this.#locale = locale;
    this.#start = view.visibleSlots.start;
    this.#end = view.visibleSlots.end;
    this.count = Math.max(0, this.#end - this.#start);
  }

  #slotForX(x: number): number {
    const vals = this.#view.frame.x.values;
    const i = lowerBound(vals, x, this.#start, this.#end);
    return i < this.#end && vals[i] === x ? i : -1;
  }

  #primaryKey(): string {
    return this.#stateRef.meta.closeField || this.#view.frame.series[0]?.key || 'close';
  }

  #nearestSlot(xPx: number): number {
    const xScale = this.#xScale;
    if (!xScale || this.count === 0) return -1;
    if (xScale.type === 'band') return clamp(Math.round(xScale.invert(xPx)), this.#start, this.#end - 1);
    const vals = this.#view.frame.x.values;
    const i = lowerBound(vals, xScale.invert(xPx), this.#start, this.#end);
    if (i <= this.#start) return this.#start;
    if (i >= this.#end) return this.#end - 1;
    return Math.abs(xCoord(xScale, vals, i - 1) - xPx) <= Math.abs(xCoord(xScale, vals, i) - xPx) ? i - 1 : i;
  }

  pick(x: number, y: number): PickTarget | null {
    const plot = this.#plot;
    if (!plot || this.count === 0) return null;
    if (x < plot.x || x > plot.x + plot.width || y < plot.y || y > plot.y + plot.height) return null;
    const i = this.#nearestSlot(x);
    return i >= 0 ? { kind: 'x', x: this.#view.frame.x.values[i]! } : null;
  }

  members(target: PickTarget, from: number, count: number): readonly DatumRef[] {
    if (target.kind !== 'x' || count <= 0 || from > 0 || this.#slotForX(target.x) < 0) return [];
    return [{ kind: 'aligned', seriesKey: this.#primaryKey(), x: target.x }];
  }

  has(target: PickTarget, ref: DatumRef): boolean {
    return target.kind === 'x' && ref.kind === 'aligned' && ref.x === target.x && this.#slotForX(target.x) >= 0;
  }

  slot(ref: DatumRef): number {
    return ref.kind === 'aligned' ? this.#slotForX(ref.x) : -1;
  }

  primary(target: PickTarget): DatumRef | null {
    if (target.kind !== 'x' || this.#slotForX(target.x) < 0) return null;
    return { kind: 'aligned', seriesKey: this.#primaryKey(), x: target.x };
  }

  #buildRows(slotIndex: number): DatumText[] {
    const { meta } = this.#stateRef;
    const { open, high, low, close, volume } = findOhlcSeries(this.#view.frame, meta);
    const xVal = this.#view.frame.x.values[slotIndex]!;
    const xText = this.#formatters.x(xVal);
    const flags = meta.slotFlags[slotIndex] ?? 0;
    const rowIdx = close?.row ? close.row[slotIndex]! : slotIndex;
    const ref: DatumRef = { kind: 'aligned', seriesKey: this.#primaryKey(), x: xVal };
    const mk = (seriesIndex: number, label: string, value: string, state: SlotState = SLOT_VALUE): DatumText => ({
      ref, seriesIndex, seriesLabel: label, x: xText, value, state, percent: null, row: rowIdx,
    });

    const fmtS = (s: typeof open, suffix = ''): { text: string; state: SlotState } => {
      if (!s) return { text: this.#formatters.missing(0 as SlotState), state: 0 as SlotState };
      const st = s.slot[slotIndex]! as SlotState;
      if (st !== SLOT_VALUE) return { text: this.#formatters.missing(st), state: st };
      const formatted = formatFinancePrice(meta, s.y[slotIndex]!, this.#locale);
      return { text: suffix ? `${formatted}${suffix}` : formatted, state: st };
    };

    const ohlcSuffix = (flags & FLAG_INVALID_OHLC) !== 0 ? ' (invalid OHLC)' : '';
    const oR = fmtS(open, ohlcSuffix);
    const hR = fmtS(high, ohlcSuffix);
    const lR = fmtS(low, ohlcSuffix);
    const cR = fmtS(close, ohlcSuffix);
    const rows: DatumText[] = [
      mk(0, meta.openLabel, oR.text, oR.state),
      mk(1, meta.highLabel, hR.text, hR.state),
      mk(2, meta.lowLabel, lR.text, lR.state),
      mk(3, meta.closeLabel, cR.text, cR.state),
    ];

    if (open && close && open.slot[slotIndex] === SLOT_VALUE && close.slot[slotIndex] === SLOT_VALUE && (flags & FLAG_INVALID_OHLC) === 0) {
      const diff = close.y[slotIndex]! - open.y[slotIndex]!;
      const dir = directionOf(open.y[slotIndex]!, close.y[slotIndex]!);
      const sign = diff > 0 ? '+' : '';
      rows.push(mk(3, 'Change', `${sign}${formatFinancePrice(meta, diff, this.#locale)} (${dir})`));
    }

    if (volume) {
      const vst = volume.slot[slotIndex]! as SlotState;
      const vText = vst === SLOT_VALUE
        ? `${formatFinanceVolume(meta, volume.y[slotIndex]!, this.#locale)}${(flags & FLAG_INVALID_VOLUME) !== 0 ? ' (invalid volume)' : ''}`
        : this.#formatters.missing(vst);
      rows.push(mk(4, meta.volumeLabel, vText, vst));
    }
    return rows;
  }

  tooltip(target: PickTarget): TooltipModel {
    if (target.kind !== 'x') return { title: '', rows: [], count: 0, total: null };
    const i = this.#slotForX(target.x);
    if (i < 0) return { title: '', rows: [], count: 0, total: null };
    const rows = this.#buildRows(i);
    return { title: this.#formatters.x(target.x), rows, count: rows.length, total: null };
  }

  datum(ref: DatumRef): DatumText | null {
    if (ref.kind !== 'aligned') return null;
    const i = this.#slotForX(ref.x);
    if (i < 0) return null;
    const rows = this.#buildRows(i);
    const summary = rows.map(r => `${r.seriesLabel}: ${r.value}`).join(', ');
    return { ...rows[3]!, seriesLabel: 'OHLC', value: summary };
  }

  anchor(ref: DatumRef): Rect | null {
    const plot = this.#plot;
    const projection = this.#projection;
    const xScale = this.#xScale;
    if (ref.kind !== 'aligned' || !plot || !projection || !xScale || projection.kind === 'ring') return null;
    const i = this.#slotForX(ref.x);
    if (i < 0) return null;
    const { close } = findOhlcSeries(this.#view.frame, this.#stateRef.meta);
    const yScale = projection.kind === 'xy' ? projection.y : projection.value;
    const px = xCoord(xScale, this.#view.frame.x.values, i);
    const py = close && close.slot[i] === SLOT_VALUE ? position(yScale, close.y[i]!) : plot.y + plot.height / 2;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
    return { x: px - 5, y: py - 5, width: 10, height: 10 };
  }

  resolve(ref: DatumRef): DatumRef | null {
    if (ref.kind !== 'aligned') return null;
    return this.#slotForX(ref.x) >= 0 ? ref : null;
  }

  ordinal(ref: DatumRef): number {
    if (ref.kind !== 'aligned') return -1;
    const i = this.#slotForX(ref.x);
    return i >= 0 ? i - this.#start : -1;
  }

  step(from: DatumRef | null, direction: StepDirection): DatumRef | null {
    if (this.count === 0) return null;
    const vals = this.#view.frame.x.values;
    const key = this.#primaryKey();
    if (!from) return { kind: 'aligned', seriesKey: key, x: vals[this.#start]! };
    if (from.kind !== 'aligned') return null;
    const at = this.#slotForX(from.x);
    if (at < 0) return null;
    if (direction === 'series-next' || direction === 'series-previous') return null;
    const page = Math.max(1, Math.round(this.count / 10));
    let to = at;
    if (direction === 'first') to = this.#start;
    else if (direction === 'last') to = this.#end - 1;
    else if (direction === 'next') to = Math.min(this.#end - 1, at + 1);
    else if (direction === 'previous') to = Math.max(this.#start, at - 1);
    else if (direction === 'page-next') to = Math.min(this.#end - 1, at + page);
    else if (direction === 'page-previous') to = Math.max(this.#start, at - page);
    return to === at ? null : { kind: 'aligned', seriesKey: key, x: vals[to]! };
  }
}

export function createFinanceOverlay(stateRef: FinanceStateRef) {
  return (input: OverlayInput, plot: Rect, clipped: Mark[]): void => {
    const { view, layout, target, ring } = input;
    if (view.kind === 'donut' || view.kind === 'scatter' || layout.kind !== 'plot' || layout.projection.kind === 'ring') return;
    const xVal = target?.kind === 'x' ? target.x : ring?.kind === 'aligned' ? ring.x : null;
    if (xVal === null) return;
    const vals = view.frame.x.values;
    const { start, end } = view.visibleSlots;
    const i = lowerBound(vals, xVal, start, end);
    if (i >= end || vals[i] !== xVal) return;
    const xScale = layout.projection.kind === 'xy' ? layout.projection.x : layout.projection.band;
    const px = xCoord(xScale, vals, i);
    if (Number.isFinite(px)) clipped.push(rule('cursor', token('axis'), px, plot.y, px, plot.y + plot.height));
    void stateRef;
  };
}

export function createFinanceReader(stateRef: FinanceStateRef): ReaderParts {
  return {
    tableRowCount: alignedReader.tableRowCount,
    table(view, caption, formatters, _messages, _labels, locale): TableModel {
      if (view.kind === 'donut' || view.kind === 'scatter') {
        return { caption, headers: [], rowCount: 0, pageSize: 50, row: () => null, pageForX: () => null };
      }
      const { meta } = stateRef;
      const { open, high, low, close, volume } = findOhlcSeries(view.frame, meta);
      const { start, end } = view.visibleSlots;
      const rowCount = Math.max(0, end - start);
      const loc = locale ?? 'en-US';
      const headers = [
        view.frame.xLabel,
        meta.openLabel,
        meta.highLabel,
        meta.lowLabel,
        meta.closeLabel,
        'Change',
        'Direction',
        ...(volume ? [meta.volumeLabel] : []),
      ];
      const pageSize = 50;
      return {
        caption,
        headers,
        rowCount,
        pageSize,
        pageForX(_x: XValue): number | null { return 0; },
        row(index: number): readonly string[] | null {
          if (index < 0 || index >= rowCount) return null;
          const slotIndex = start + index;
          const flags = meta.slotFlags[slotIndex] ?? 0;
          const invalidOhlc = (flags & FLAG_INVALID_OHLC) !== 0;
          const ohlcSuffix = invalidOhlc ? ' (invalid OHLC)' : '';
          const fmtPrice = (s: typeof open) => {
            if (!s) return formatters.missing(0 as SlotState);
            const st = s.slot[slotIndex]! as SlotState;
            return st === SLOT_VALUE ? `${formatFinancePrice(meta, s.y[slotIndex]!, loc)}${ohlcSuffix}` : formatters.missing(st);
          };
          let changeText = formatters.missing(0 as SlotState);
          let dirText = invalidOhlc ? 'omitted' : formatters.missing(0 as SlotState);
          if (!invalidOhlc && open && close && open.slot[slotIndex] === SLOT_VALUE && close.slot[slotIndex] === SLOT_VALUE) {
            const diff = close.y[slotIndex]! - open.y[slotIndex]!;
            changeText = `${diff > 0 ? '+' : ''}${formatFinancePrice(meta, diff, loc)}`;
            dirText = directionOf(open.y[slotIndex]!, close.y[slotIndex]!);
          }
          const cells = [
            formatters.x(view.frame.x.values[slotIndex]!),
            fmtPrice(open),
            fmtPrice(high),
            fmtPrice(low),
            fmtPrice(close),
            changeText,
            dirText,
          ];
          if (volume) {
            const vst = volume.slot[slotIndex]! as SlotState;
            const vText = vst === SLOT_VALUE
              ? `${formatFinanceVolume(meta, volume.y[slotIndex]!, loc)}${(flags & FLAG_INVALID_VOLUME) !== 0 ? ' (invalid volume)' : ''}`
              : formatters.missing(vst);
            cells.push(vText);
          }
          return cells;
        },
      };
    },
    text(input, type, xLabel, yLabel, table, listReady) {
      const base = [...alignedReader.text(input, type, xLabel, yLabel, table, listReady)];
      base.push('Up candles are drawn hollow; down candles are filled; unchanged candles are horizontal ticks.');
      return base;
    },
  };
}
