/**
 * O(N) batched candlestick + volume scene builder, exact lookup/tooltip/keyboard navigation,
 * overlay cursor, and accessible table/summary reader for `axylo/finance` (C6.3).
 *
 * Colorblind-safe encoding:
 * - Up candles (`close > open`): hollow stroked rectangle outline (`PathMark`).
 * - Down candles (`close < open`): solid filled rectangle (`RectMark`).
 * - Unchanged / doji candles (`close === open`): crisp horizontal body bar (`PathMark`).
 * - Wicks: single batched `PathMark` across all valid candles (`1` SVG `<path>` even at 10k rows).
 *
 * N7a: candles, wicks and references (x and y) are cut to the price pane, volume bars to the volume pane, in the
 * geometry and again by per-pane SVG clip paths; paints come from --axylo-up / --axylo-down / --axylo-volume.
 * A view denser than its pixel columns draws the layout's OHLCV bins (one candle and one bar per 2 px column).
 */
import {
  SLOT_VALUE, type AlignedView, type BandMark, type DashStyle, type DatumRef, type DatumText, type Formatters, type Layout,
  type Lookup, type Mark, type PaintBindings, type PathMark, type PickTarget, type Projection, type Rect, type RectMark,
  type RuleMark, type Scene, type SlotState, type StepDirection, type TableModel, type TooltipModel,
  type View, type XScale,
} from '../core/contracts';
import type { OverlayInput } from '../core/focus';
import type { Messages, XValue } from '../public';
import type { ReaderParts } from '../reader';
import { alignedReader } from '../reader';
import { boundaryPixel, clamp, position, projectReference, rule, seriesPaint, token } from '../scene/geometry';
import { positionReader } from '../view/references';
import { svgElement } from '../dom/attributes';
import { svgBand, svgPath, svgRects, svgRule, type SvgContext, type SvgMark, type SvgMarks, type SvgNode } from '../render/svg';
import { BIN_WIDTH } from './aggregate';
import {
  FLAG_INCOMPLETE_OHLC, FLAG_INVALID_OHLC, FLAG_INVALID_VOLUME,
  findOhlcSeries, flagsForFrame, frameMeta, type FinanceStateRef,
} from './core';
import { candleData, financePanes } from './layout';

const TICK_LENGTH = 4;
const REFERENCE_DASH = [4, 3] as const;
const REFERENCE_WIDTH = 1.5;
/** The shared reference dash in both modes: the line is told apart by its dash, not by contrast. */
const REFERENCE_DASH_STYLE: DashStyle = { normal: REFERENCE_DASH, contrast: REFERENCE_DASH };

/** Paint slots of the finance marks; their colors come from financeBindings, not from the series palette order. */
export const UP_PAINT = 0;
export const DOWN_PAINT = 1;
export const VOLUME_PAINT = 2;

export type PaneKind = 'price' | 'volume';
export interface PaneTag {
  readonly kind: PaneKind;
  readonly rect: Rect;
}

/**
 * The pane each candle, wick and volume mark is clipped to. The shared scene has a single clip rectangle (the
 * whole plot), so the finance SVG handlers read this to clip each data mark to its own pane. Geometry is also
 * cut to the pane in the scene itself, so a renderer without these handlers still keeps every mark in its pane.
 */
let paneTags: WeakMap<Mark, PaneTag> | undefined;

export function paneOf(mark: Mark): PaneTag | undefined {
  return paneTags?.get(mark);
}

function tagged<M extends Mark>(mark: M, tag: PaneTag): M {
  (paneTags ??= new WeakMap()).set(mark, tag);
  return mark;
}

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
    if (gap > 0 && gap < minGap) {
      if (gap * 0.65 <= 2) return 2;
      minGap = gap;
    }
    prev = cur;
  }
  const base = Number.isFinite(minGap) ? minGap * 0.65 : (plotWidth / count) * 0.65;
  return clamp(base, 2, 24);
}

/** Packed geometry of the candles, cut to the price pane: wicks and dojis, hollow up bodies, filled down bodies. */
class CandleBuffers {
  readonly wick: Float32Array;
  readonly up: Float32Array;
  readonly down: Float32Array;
  wickPos = 0;
  upPos = 0;
  downPos = 0;

  constructor(count: number, readonly top: number, readonly bottom: number) {
    this.wick = new Float32Array(count * 12);
    this.up = new Float32Array(count * 12);
    this.down = new Float32Array(count * 4);
  }

  /**
   * A vertical segment from y0 down to y1, cut to the pane. Directional: a segment whose ends are not in that
   * order is empty (an upper wick of a candle with no upper shadow) and is never turned around into one.
   */
  #vertical(x: number, y0: number, y1: number): void {
    if (!(y0 < y1)) return;
    const a = Math.max(this.top, y0);
    const b = Math.min(this.bottom, y1);
    // Compared as stored (float32): ends that round together would be a zero-length segment.
    if (!(Math.fround(a) < Math.fround(b))) return;
    const w = this.wick;
    w[this.wickPos++] = x; w[this.wickPos++] = a;
    w[this.wickPos++] = x; w[this.wickPos++] = b;
    w[this.wickPos++] = NaN; w[this.wickPos++] = NaN;
  }

  /**
   * One candle, in pixels (yH <= body <= yL for a valid candle). Its raw extent is tested against the pane
   * before anything is thickened: a candle wholly outside an explicit domain draws nothing, however close it
   * is (a minimum body pushed into the pane would show a value the domain excludes). A candle that crosses the
   * pane keeps the parts inside it, real wicks included.
   */
  add(cx: number, halfW: number, yO: number, yH: number, yL: number, yC: number, direction: number): void {
    const { top, bottom } = this;
    if (!(yL >= top && yH <= bottom)) return;
    const bodyTop = Math.min(yO, yC);
    const bodyBottom = Math.max(yO, yC);
    // The body takes part only where its own raw extent meets the pane; then it is at least 1 px tall.
    const bodyIn = bodyBottom >= top && bodyTop <= bottom;
    const thin = bodyBottom - bodyTop < 1;
    const topY = thin ? (bodyTop + bodyBottom) / 2 - 0.5 : bodyTop;
    const botY = thin ? topY + 1 : bodyBottom;
    if (direction > 0) {
      this.#vertical(cx, yH, bodyTop);
      this.#vertical(cx, bodyBottom, yL);
      if (!bodyIn) return;
      const a = Math.max(top, topY);
      const b = Math.min(bottom, botY);
      if (!(a < b)) return;
      const x0 = cx - halfW;
      const x1 = cx + halfW;
      const u = this.up;
      if (topY >= top && botY <= bottom) {
        u[this.upPos++] = x0; u[this.upPos++] = topY;
        u[this.upPos++] = x1; u[this.upPos++] = topY;
        u[this.upPos++] = x1; u[this.upPos++] = botY;
        u[this.upPos++] = x0; u[this.upPos++] = botY;
        u[this.upPos++] = x0; u[this.upPos++] = topY;
        u[this.upPos++] = NaN; u[this.upPos++] = NaN;
      } else if (topY >= top) {
        // The bottom edge lies outside the pane: an open outline down to the pane edge.
        u[this.upPos++] = x0; u[this.upPos++] = b;
        u[this.upPos++] = x0; u[this.upPos++] = topY;
        u[this.upPos++] = x1; u[this.upPos++] = topY;
        u[this.upPos++] = x1; u[this.upPos++] = b;
        u[this.upPos++] = NaN; u[this.upPos++] = NaN;
      } else if (botY <= bottom) {
        u[this.upPos++] = x0; u[this.upPos++] = a;
        u[this.upPos++] = x0; u[this.upPos++] = botY;
        u[this.upPos++] = x1; u[this.upPos++] = botY;
        u[this.upPos++] = x1; u[this.upPos++] = a;
        u[this.upPos++] = NaN; u[this.upPos++] = NaN;
      } else {
        u[this.upPos++] = x0; u[this.upPos++] = a;
        u[this.upPos++] = x0; u[this.upPos++] = b;
        u[this.upPos++] = NaN; u[this.upPos++] = NaN;
        u[this.upPos++] = x1; u[this.upPos++] = a;
        u[this.upPos++] = x1; u[this.upPos++] = b;
        u[this.upPos++] = NaN; u[this.upPos++] = NaN;
      }
    } else if (direction < 0) {
      this.#vertical(cx, yH, yL);
      if (!bodyIn) return;
      const a = Math.max(top, topY);
      const b = Math.min(bottom, botY);
      if (!(a < b)) return;
      const d = this.down;
      d[this.downPos++] = cx - halfW;
      d[this.downPos++] = a;
      d[this.downPos++] = halfW * 2;
      d[this.downPos++] = b - a;
    } else {
      this.#vertical(cx, yH, yL);
      if (yC >= top && yC <= bottom) {
        const w = this.wick;
        w[this.wickPos++] = cx - halfW; w[this.wickPos++] = yC;
        w[this.wickPos++] = cx + halfW; w[this.wickPos++] = yC;
        w[this.wickPos++] = NaN; w[this.wickPos++] = NaN;
      }
    }
  }
}

/**
 * The outline width of a hollow (up) body: a third of the body, between 0.5 and 1.75 px, so the two side
 * strokes never meet and the interior stays open (body - stroke >= 1 px for any body of 1.5 px or more, the
 * dense bins' included: a 1.5 px body with 0.5 px strokes spans exactly its 2 px column).
 */
export function hollowStroke(bodyWidth: number): number {
  return clamp(bodyWidth / 3, 0.5, 1.75);
}

const used = (buf: Float32Array, n: number): Float32Array => (n === buf.length ? buf : buf.subarray(0, n));

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

  // The frame's own fields and labels: a mid-frame update cannot change what this scene draws.
  const meta = frameMeta(stateRef, view.frame);
  const compact = layout.kind === 'compact' || view.compact;
  const xScale = projection.kind === 'xy' ? projection.x : projection.band;
  const yScale = projection.kind === 'xy' ? projection.y : projection.value;
  const known = financePanes(layout);
  const panes = known ?? {
    price: plot, volume: null, volumeScale: null, volumeTicks: [], volumeMax: 0, divider: null,
    bins: candleData(view, meta, xScale, plot.x, plot.width, false).bins, volumeFormatFailed: false, volumeLabelsHidden: 0,
    volumeOmitted: false,
  };
  const price = panes.price;
  const priceTag: PaneTag = { kind: 'price', rect: price };
  const left = plot.x;
  const right = plot.x + plot.width;
  const top = plot.y;
  const bottom = plot.y + plot.height;
  const pTop = price.y;
  const pBottom = price.y + price.height;

  const marks: Mark[] = [];
  const edges: RuleMark[] = [];
  const refLines: PathMark[] = [];

  // 1. References belong to the price pane: lines and bands, x and y alike, are projected onto the price pane
  // exactly as their labels are (layout/references.ts), and carry the price pane's SVG clip, so even the
  // stroke of a line on a pane edge stays inside it. A line outside the domain is not drawn: pinning it to an
  // edge would show a wrong value. Lines are dashed paths rather than rules so the shared renderer keeps
  // batching grid and tick rules while these get the pane clip.
  if (!compact && view.references.length) {
    const paint = token('reference');
    for (const ref of view.references) {
      const projected = projectReference(ref, projection, price);
      if (!projected) continue;
      const { vertical, low, high } = projected;
      if (low === high) {
        const xy = vertical ? new Float32Array([low, pTop, low, pBottom]) : new Float32Array([left, low, right, low]);
        refLines.push(tagged({
          type: 'path', series: UP_PAINT, xy, stroke: paint, strokeWidth: REFERENCE_WIDTH, dash: REFERENCE_DASH_STYLE,
        } satisfies PathMark, priceTag));
      } else {
        const box = vertical ? { x: low, y: pTop, width: high - low, height: price.height } : { x: left, y: low, width: plot.width, height: high - low };
        marks.push(tagged({ type: 'band', box, fill: paint, opacity: 0.12 } satisfies BandMark, priceTag));
      }
    }
  }

  // 2. Axes, ticks and gridlines, each pane its own.
  if (layout.kind === 'plot' && !compact) {
    const axisPaint = token('axis');
    const gridPaint = token('grid');
    edges.push(rule('axis', axisPaint, left, bottom, right, bottom));
    edges.push(rule('axis', axisPaint, left, pTop, left, pBottom));
    for (const tick of layout.xTicks) {
      const px = boundaryPixel(xScale.type === 'band' ? xScale.center(tick.value) : position(xScale, tick.value), left, right);
      if (px !== null) edges.push(rule('tick', axisPaint, px, bottom, px, bottom + TICK_LENGTH));
    }
    for (const tick of layout.yTicks) {
      const py = boundaryPixel(position(yScale, tick.value), pTop, pBottom);
      if (py === null) continue;
      marks.push(rule('grid', gridPaint, left, py, right, py));
      edges.push(rule('tick', axisPaint, left - TICK_LENGTH, py, left, py));
    }
    const vol = panes.volume;
    if (vol && panes.volumeScale) {
      const vTop = vol.y;
      const vBottom = vol.y + vol.height;
      edges.push(rule('axis', axisPaint, right, vTop, right, vBottom));
      for (const tick of panes.volumeTicks) {
        const py = boundaryPixel(panes.volumeScale.map(tick.value), vTop, vBottom);
        if (py === null) continue;
        if (tick.value !== 0) marks.push(rule('grid', gridPaint, left, py, right, py));
        edges.push(rule('tick', axisPaint, right, py, right + TICK_LENGTH, py));
      }
      if (panes.divider !== null) marks.push(rule('grid', gridPaint, left, panes.divider, right, panes.divider));
    }
  }

  const { open, high, low, close, volume } = findOhlcSeries(view.frame, meta);
  if (open && high && low && close) {
    const xVals = view.frame.x.values;
    const { start, end } = view.visibleSlots;
    const bins = panes.bins;
    const count = bins?.count ?? Math.max(0, end - start);
    const bodyW = bins ? BIN_WIDTH * 0.75 : candleWidth(xScale, xVals, start, end, plot.width);
    const halfW = bodyW / 2;
    const candles = new CandleBuffers(count, pTop, pBottom);
    const vol = panes.volume, vScale = panes.volumeScale;
    const bars = vol && vScale && volume && panes.volumeMax > 0 ? new Float32Array(count * 4) : null;
    let vp = 0;
    const pushVolume = (cx: number, v: number) => {
      if (!bars || !(v > 0)) return;
      const y = Math.max(vol!.y, vScale!.map(v));
      const h = vol!.y + vol!.height - y;
      if (!(h > 0)) return;
      bars[vp++] = cx - halfW; bars[vp++] = y; bars[vp++] = bodyW; bars[vp++] = h;
    };
    if (bins) {
      for (let b = 0; b < bins.count; b++) {
        const cx = bins.center[b]!;
        if (bars) pushVolume(cx, bins.volume[b]!);
        if (bins.candles[b] === 0) continue;
        const o = bins.open[b]!, c = bins.close[b]!;
        candles.add(cx, halfW, position(yScale, o), position(yScale, bins.high[b]!), position(yScale, bins.low[b]!),
          position(yScale, c), c > o ? 1 : c < o ? -1 : 0);
      }
    } else {
      const flags = flagsForFrame(view.frame, meta);
      for (let i = start; i < end; i++) {
        const flag = flags[i]!;
        if ((flag & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC)) !== 0) continue;
        const cx = xCoord(xScale, xVals, i);
        if (bars && (flag & FLAG_INVALID_VOLUME) === 0 && volume!.slot[i] === SLOT_VALUE && Number.isFinite(volume!.y[i]!)) {
          pushVolume(cx, volume!.y[i]!);
        }
        const o = open.y[i]!, c = close.y[i]!;
        candles.add(cx, halfW, position(yScale, o), position(yScale, high.y[i]!), position(yScale, low.y[i]!),
          position(yScale, c), c > o ? 1 : c < o ? -1 : 0);
      }
    }

    if (bars && vp) {
      marks.push(tagged({
        type: 'rects', series: VOLUME_PAINT, xywh: used(bars, vp), fill: seriesPaint(VOLUME_PAINT), variant: 'bar',
      } satisfies RectMark, { kind: 'volume', rect: vol! }));
    }
    if (candles.wickPos >= 4) {
      marks.push(tagged({
        type: 'path', series: UP_PAINT, xy: used(candles.wick, candles.wickPos), stroke: token('axis'), strokeWidth: 1.25,
        dash: { normal: null, contrast: null },
      } satisfies PathMark, priceTag));
    }
    if (candles.downPos >= 4) {
      marks.push(tagged({
        type: 'rects', series: DOWN_PAINT, xywh: used(candles.down, candles.downPos), fill: seriesPaint(DOWN_PAINT), variant: 'bar',
      } satisfies RectMark, priceTag));
    }
    if (candles.upPos >= 6) {
      marks.push(tagged({
        type: 'path', series: UP_PAINT, xy: used(candles.up, candles.upPos), stroke: seriesPaint(UP_PAINT), strokeWidth: hollowStroke(bodyW),
        dash: { normal: null, contrast: null },
      } satisfies PathMark, priceTag));
    }
  }

  marks.push(...edges, ...refLines);
  return { width: layout.width, height: layout.height, clip: plot, marks };
}

// ───────────────────────────── SVG paint and pane clips ─────────────────────────────

/**
 * Live semantic paints. Under forced colors the stylesheet defines --axylo-forced-series (CanvasText,
 * !important), which wins over an author's brand colors; otherwise --axylo-up / --axylo-down / --axylo-volume
 * apply, and unset they fall back to the chart's themed palette slots (contrast-checked by AX141). Direction
 * never relies on color: up is hollow, down is filled, unchanged is a horizontal tick.
 */
export function financePaintExpression(property: '--axylo-up' | '--axylo-down' | '--axylo-volume', fallback: string): string {
  return `var(--axylo-forced-series, var(${property}, ${fallback}))`;
}

let derivedBindings: WeakMap<PaintBindings, PaintBindings> | undefined;

export function financeBindings(bindings: PaintBindings): PaintBindings {
  const cache = derivedBindings ??= new WeakMap();
  let out = cache.get(bindings);
  if (!out) {
    const series = [...bindings.series];
    const slot = (i: number) => bindings.series[i] ?? bindings.tokens.axis;
    series[UP_PAINT] = financePaintExpression('--axylo-up', slot(UP_PAINT));
    series[DOWN_PAINT] = financePaintExpression('--axylo-down', slot(DOWN_PAINT));
    series[VOLUME_PAINT] = financePaintExpression('--axylo-volume', slot(VOLUME_PAINT));
    out = { tokens: bindings.tokens, series };
    cache.set(bindings, out);
  }
  return out;
}

let clipIds = 0;
let paneClips: WeakMap<SvgContext, Map<PaneKind, { readonly url: string; readonly rect: SVGElement; bounds: Rect | null }>> | undefined;

function paneClipUrl(c: SvgContext, tag: PaneTag): string {
  const byContext = paneClips ??= new WeakMap();
  let clips = byContext.get(c);
  if (!clips) byContext.set(c, clips = new Map());
  let clip = clips.get(tag.kind);
  if (!clip) {
    const id = `axylo-finance-${tag.kind}-${++clipIds}`;
    const el = svgElement(c.doc, 'clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
    const rect = svgElement(c.doc, 'rect');
    el.appendChild(rect);
    c.defs.appendChild(el);
    clips.set(tag.kind, clip = { url: `url(#${id})`, rect, bounds: null });
  }
  const r = tag.rect;
  const b = clip.bounds;
  if (!b || b.x !== r.x || b.y !== r.y || b.width !== r.width || b.height !== r.height) {
    clip.rect.setAttribute('x', String(r.x));
    clip.rect.setAttribute('y', String(r.y));
    clip.rect.setAttribute('width', String(Math.max(0, r.width)));
    clip.rect.setAttribute('height', String(Math.max(0, r.height)));
    clip.bounds = r;
  }
  return clip.url;
}

/**
 * Replaces the plot clip the renderer set with the mark's pane clip. Only the element is changed, not the
 * renderer's attribute cache, so a node reused for an untagged mark gets the renderer's clip back.
 */
function clipToPane(c: SvgContext, n: SvgNode, mark: Mark): void {
  const tag = paneOf(mark);
  const wanted = tag ? paneClipUrl(c, tag) : (n.attrs?.['clip-path'] as string | undefined) ?? null;
  if (n.el.getAttribute('clip-path') === wanted) return;
  if (wanted === null) n.el.removeAttribute('clip-path');
  else n.el.setAttribute('clip-path', wanted);
}

const financePath: SvgMark<PathMark> = (c, n, mark, bindings, dpr, clip) => {
  svgPath(c, n, mark, financeBindings(bindings), dpr, clip);
  clipToPane(c, n, mark);
};

interface FinanceGroup extends SvgNode {
  paths?: SVGPathElement[];
}

/** Keep small marks as individual bars. Larger marks retain the same painted and clipped group. */
const RECT_BATCH_THRESHOLD = 64;

let barFractions: string[] | undefined;
function barNumber(cents: number): string {
  if (!(cents >= 0 && cents < 2e9)) return String(cents / 100);
  barFractions ??= Array.from({ length: 100 }, (_, i) => String(i / 100).slice(1));
  return Math.floor(cents / 100) + barFractions[cents % 100]!;
}

function drawBarPaths(doc: Document, group: FinanceGroup, boxes: Float32Array): void {
  const paths = group.paths!;
  let count = 0;
  let d = '';
  let right = -Infinity;
  const flush = () => {
    const path = paths[count] ??= group.el.appendChild(svgElement(doc, 'path'));
    path.setAttribute('d', d);
    count++;
    d = '';
  };
  // The scene's candles and volume bars each have one body width.
  const w = boxes[2]!, width = Math.round(Math.abs(w) * 100);
  const across = `h${width / 100}v`, back = `h-${width / 100}z`;
  for (let i = 0; i < boxes.length; i += 4) {
    const x = boxes[i]!, y = boxes[i + 1]!, h = boxes[i + 3]!;
    // Match svgRects/paintBox: a non-finite box has zero area. SVG rounds the origin and size independently.
    if (!Number.isFinite(x + y + w + h)) {
      d += 'M0 0h0v0h-0z';
      continue;
    }
    const left = Math.round((x + Math.min(0, w)) * 100);
    // Separate paint operations preserve alpha where minimum-width candles or a clipped end column overlap.
    if (left < right) flush();
    d += `M${barNumber(left)} ${barNumber(Math.round((y + Math.min(0, h)) * 100))}${across}${barNumber(Math.round(Math.abs(h) * 100))}${back}`;
    right = left + width;
  }
  if (d) flush();
  while (paths.length > count) paths.pop()!.remove();
}

const financeRects: SvgMark<RectMark> = (c, n: FinanceGroup, mark, bindings, dpr, clip) => {
  const colors = financeBindings(bindings);
  const batch = mark.variant === 'bar' && !!paneOf(mark) && mark.xywh.length > 4 * RECT_BATCH_THRESHOLD;
  if (batch !== !!n.paths) {
    // The shared renderer pools groups by variant. Its child and style caches belong to the previous mode.
    if (n.el.children.length) n.el.replaceChildren();
    n.paths = batch ? [] : undefined;
    n.rects = undefined;
    n.boxes = undefined;
    n.source = null;
    n.styles = null;
    if (batch) {
      n.el.style.setProperty('fill', 'currentColor');
      n.el.style.setProperty('stroke', 'none');
    }
  }
  if (batch) {
    if (n.boxes !== mark.xywh) {
      drawBarPaths(c.doc, n, mark.xywh);
      n.boxes = mark.xywh;
    }
    const style = n.el.style;
    const color = colors.series[mark.series]!;
    if (style.getPropertyValue('color') !== color) style.setProperty('color', color);
  } else svgRects(c, n, mark, colors, dpr, clip);
  clipToPane(c, n, mark);
};

const financeBand: SvgMark<BandMark> = (c, n, mark, bindings, dpr, clip) => {
  svgBand(c, n, mark, bindings, dpr, clip);
  clipToPane(c, n, mark);
};

/**
 * The SVG handlers of the finance scene: semantic paints and per-pane clips on data and reference marks. Rules
 * keep the shared handler itself, which is what lets the renderer batch grid and tick rules.
 */
export const financeSvgMarks: SvgMarks = { band: financeBand, path: financePath, rects: financeRects, rule: svgRule };

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
    return frameMeta(this.#stateRef, this.#view.frame).closeField || this.#view.frame.series[0]?.key || 'close';
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
    const meta = frameMeta(this.#stateRef, this.#view.frame);
    const series = this.#view.frame.series;
    const { open, high, low, close, volume } = findOhlcSeries(this.#view.frame, meta);
    const oIdx = open ? series.indexOf(open) : 0;
    const hIdx = high ? series.indexOf(high) : 1;
    const lIdx = low ? series.indexOf(low) : 2;
    const cIdx = close ? series.indexOf(close) : 3;
    const vIdx = volume ? series.indexOf(volume) : -1;
    const xVal = this.#view.frame.x.values[slotIndex]!;
    const xText = this.#formatters.x(xVal);
    const flags = flagsForFrame(this.#view.frame, meta)[slotIndex] ?? 0;
    const rowIdx = close?.row ? close.row[slotIndex]! : slotIndex;
    const ref: DatumRef = { kind: 'aligned', seriesKey: this.#primaryKey(), x: xVal };
    const mk = (seriesIndex: number, label: string, value: string, state: SlotState = SLOT_VALUE): DatumText => ({
      ref, seriesIndex, seriesLabel: label, x: xText, value, state, percent: null, row: rowIdx,
    });

    const fmtS = (s: typeof open, idx: number, suffix = ''): { text: string; state: SlotState } => {
      if (!s) return { text: this.#formatters.missing(0 as SlotState), state: 0 as SlotState };
      const st = s.slot[slotIndex]! as SlotState;
      if (st !== SLOT_VALUE) return { text: this.#formatters.missing(st), state: st };
      const formatted = this.#formatters.value(idx, s.y[slotIndex]!);
      return { text: suffix ? `${formatted}${suffix}` : formatted, state: st };
    };

    const ohlcSuffix = (flags & FLAG_INVALID_OHLC) !== 0 ? ' (invalid OHLC)' : '';
    const oR = fmtS(open, oIdx, ohlcSuffix);
    const hR = fmtS(high, hIdx, ohlcSuffix);
    const lR = fmtS(low, lIdx, ohlcSuffix);
    const cR = fmtS(close, cIdx, ohlcSuffix);
    const rows: DatumText[] = [
      mk(oIdx, meta.openLabel, oR.text, oR.state),
      mk(hIdx, meta.highLabel, hR.text, hR.state),
      mk(lIdx, meta.lowLabel, lR.text, lR.state),
      mk(cIdx, meta.closeLabel, cR.text, cR.state),
    ];

    if (open && close && open.slot[slotIndex] === SLOT_VALUE && close.slot[slotIndex] === SLOT_VALUE && (flags & FLAG_INVALID_OHLC) === 0) {
      const diff = close.y[slotIndex]! - open.y[slotIndex]!;
      const dir = directionOf(open.y[slotIndex]!, close.y[slotIndex]!);
      const sign = diff > 0 ? '+' : '';
      rows.push(mk(cIdx, 'Change', `${sign}${this.#formatters.value(cIdx, diff)} (${dir})`));
    }

    if (volume && vIdx >= 0 && this.#view.visible[vIdx] !== false) {
      const vst = volume.slot[slotIndex]! as SlotState;
      const vText = vst === SLOT_VALUE
        ? `${this.#formatters.value(vIdx, volume.y[slotIndex]!)}${(flags & FLAG_INVALID_VOLUME) !== 0 ? ' (invalid volume)' : ''}`
        : this.#formatters.missing(vst);
      rows.push(mk(vIdx, meta.volumeLabel, vText, vst));
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
    const { close } = findOhlcSeries(this.#view.frame, frameMeta(this.#stateRef, this.#view.frame));
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
    table(view, caption, formatters): TableModel {
      if (view.kind === 'donut' || view.kind === 'scatter') {
        return { caption, headers: [], rowCount: 0, pageSize: 50, row: () => null, pageForX: () => null };
      }
      const meta = frameMeta(stateRef, view.frame);
      const series = view.frame.series;
      const { open, high, low, close, volume } = findOhlcSeries(view.frame, meta);
      const oIdx = open ? series.indexOf(open) : 0;
      const hIdx = high ? series.indexOf(high) : 1;
      const lIdx = low ? series.indexOf(low) : 2;
      const cIdx = close ? series.indexOf(close) : 3;
      const vIdx = volume ? series.indexOf(volume) : -1;
      const flags = flagsForFrame(view.frame, meta);
      const { start, end } = view.visibleSlots;
      const rowCount = Math.max(0, end - start);
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
      const readX = positionReader(view.frame.x, undefined);
      return {
        caption,
        headers,
        rowCount,
        pageSize,
        pageForX(x: XValue): number | null {
          if (rowCount === 0) return null;
          const target = readX(x);
          if (!Number.isFinite(target)) return null;
          const idx = lowerBound(view.frame.x.values, target, start, end);
          if (idx >= end) return null;
          return Math.floor((idx - start) / pageSize);
        },
        row(index: number): readonly string[] | null {
          if (index < 0 || index >= rowCount) return null;
          const slotIndex = start + index;
          const slotFlag = flags[slotIndex] ?? 0;
          const invalidOhlc = (slotFlag & FLAG_INVALID_OHLC) !== 0;
          const ohlcSuffix = invalidOhlc ? ' (invalid OHLC)' : '';
          const fmtPrice = (s: typeof open, idx: number) => {
            if (!s) return formatters.missing(0 as SlotState);
            const st = s.slot[slotIndex]! as SlotState;
            return st === SLOT_VALUE ? `${formatters.value(idx, s.y[slotIndex]!)}${ohlcSuffix}` : formatters.missing(st);
          };
          let changeText = formatters.missing(0 as SlotState);
          let dirText = invalidOhlc ? 'omitted' : formatters.missing(0 as SlotState);
          if (!invalidOhlc && open && close && open.slot[slotIndex] === SLOT_VALUE && close.slot[slotIndex] === SLOT_VALUE) {
            const diff = close.y[slotIndex]! - open.y[slotIndex]!;
            changeText = `${diff > 0 ? '+' : ''}${formatters.value(cIdx, diff)}`;
            dirText = directionOf(open.y[slotIndex]!, close.y[slotIndex]!);
          }
          const cells = [
            formatters.x(view.frame.x.values[slotIndex]!),
            fmtPrice(open, oIdx),
            fmtPrice(high, hIdx),
            fmtPrice(low, lIdx),
            fmtPrice(close, cIdx),
            changeText,
            dirText,
          ];
          if (volume && vIdx >= 0) {
            const vst = volume.slot[slotIndex]! as SlotState;
            const vText = vst === SLOT_VALUE
              ? `${formatters.value(vIdx, volume.y[slotIndex]!)}${(slotFlag & FLAG_INVALID_VOLUME) !== 0 ? ' (invalid volume)' : ''}`
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
