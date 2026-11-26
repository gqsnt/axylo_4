import type {
  BandScale, ContinuousScale, DiagnosticSink, Layout, PlacedText, Projection, Rect, ResolvedReference,
  TextMeasurer, TextStyle, TickCandidates, XScale,
} from '../core/contracts';
import { fitBottom, fitLeftCategories, fitValue, messageLines, placeText, prepareLabels, wrapText } from './labels';
import type { FittedLabels, Metrics, PreparedLabels } from './labels';
import { placeReferences } from './references';

type Span = readonly [number, number];

interface Axis {
  readonly candidates: TickCandidates;
  readonly title?: string;
  readonly mayThin: boolean;
}

export interface ValueAxis extends Axis {
  readonly domain: Span;
  /**
   * Wider domains, each with its own tick candidates, sparsest last. When no candidate set of `domain` fits
   * the plot whole, the first of these whose set does is drawn, so the axis still ends at drawn ticks (F7).
   */
  readonly coarser?: readonly { readonly domain: Span; readonly candidates: TickCandidates }[];
}

export interface ContinuousAxis extends ValueAxis {
  readonly type: 'linear' | 'time';
}

export interface BandAxis extends Axis {
  readonly type: 'band';
  readonly count: number;
  readonly padding: number;
}

export interface ScaleConstructors {
  linear(domain: Span, range: Span): ContinuousScale;
  time(domain: Span, range: Span): ContinuousScale;
  band(count: number, range: Span, padding: number): BandScale;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

interface Axes {
  /** Logical category or independent axis, including for horizontal bars. */
  readonly x: ContinuousAxis | BandAxis;
  readonly y: ValueAxis;
  readonly scales: ScaleConstructors;
  readonly references?: readonly ResolvedReference[];
  /** View bounds when they differ from the scale's domain, such as on a padded bar axis. */
  readonly referenceXDomain?: Span;
}

type Cartesian = Axes & (
  | { readonly kind: 'xy' }
  | { readonly kind: 'bands'; readonly horizontal: boolean }
);

interface TextInput {
  readonly measurer: TextMeasurer;
  readonly style: TextStyle;
}

type PlotInput = Size & {
  /** Ignored. Presentation derives AX142 and AX143 from the returned layout. */
  readonly diagnostics?: DiagnosticSink;
  readonly compact?: boolean;
};

export type LayoutInput =
  | (PlotInput & Cartesian & TextInput)
  | (PlotInput & { readonly kind: 'ring' })
  | (Size & TextInput & { readonly kind: 'message'; readonly message: string });

const INSET = 4;
const GAP = 4;
const TICK_GAP = 6;
const MIN_WIDTH = 120;
const MIN_HEIGHT = 80;
const UNCHANGED = { remedies: [], hidden: 0 } as const;
const NO_LABELS: FittedLabels = { ticks: [], texts: [], depth: 0, remedies: [] };

function independentScale(axis: Axes['x'], range: Span, scales: ScaleConstructors): XScale {
  return axis.type === 'band' ? scales.band(axis.count, range, axis.padding) : scales[axis.type](axis.domain, range);
}

function project(plot: Rect, axes: Cartesian): Exclude<Projection, { kind: 'ring' }> {
  const across: Span = [plot.x, plot.x + plot.width];
  const up: Span = [plot.y + plot.height, plot.y];
  const horizontal = axes.kind === 'bands' && axes.horizontal;
  const x = independentScale(axes.x, horizontal ? (axes.x.type === 'band' ? [plot.y, plot.y + plot.height] : up) : across, axes.scales);
  const y = axes.scales.linear(axes.y.domain, horizontal ? across : up);
  return axes.kind === 'xy' ? { kind: 'xy', x, y } : { kind: 'bands', horizontal, band: x, value: y };
}

function ring(plot: Rect): Projection {
  const r1 = Math.min(plot.width, plot.height) / 2;
  return { kind: 'ring', cx: plot.x + plot.width / 2, cy: plot.y + plot.height / 2, r0: r1 * 0.6, r1 };
}

function tooSmall(size: Size): Layout {
  return { ...size, kind: 'too-small' };
}

function metrics(input: TextInput, shared?: Map<string, number>): Metrics {
  const widths = shared ?? new Map<string, number>();
  return {
    lineHeight: input.style.lineHeight,
    width(text) {
      const cached = widths.get(text);
      if (cached !== undefined) return cached;
      const width = input.measurer.width(text, input.style);
      // A streaming axis can introduce a different label at every step.
      if (shared && widths.size >= 512) widths.clear();
      widths.set(text, width);
      return width;
    },
  };
}

function moveText(text: PlacedText, dx: number, dy: number): PlacedText {
  const { box } = text;
  return {
    lines: text.lines, full: text.full, x: text.x + dx, y: text.y + dy, anchor: text.anchor, baseline: text.baseline,
    rotate: text.rotate, role: text.role, box: { x: box.x + dx, y: box.y + dy, width: box.width, height: box.height },
  };
}

function lane(fit: FittedLabels): number {
  return fit.texts.length ? TICK_GAP + fit.depth : 0;
}

function hiddenCategories(axis: Axes['x'], fit: FittedLabels): number {
  // A continuous tick samples the scale. A category label identifies a datum in view.
  if (axis.type !== 'band') return 0;
  let hidden = axis.count - fit.texts.length;
  for (const { lines, full } of fit.texts) {
    // Middle truncation produces one line. Wrapped lines still contain the whole label.
    if (lines.length === 1 && lines[0] !== full) hidden++;
  }
  return hidden;
}

/** Whether a fitted axis kept no whole candidate set (F7). */
type AxisFit = Partial<Record<'x' | 'y', boolean>>;

let allSets: WeakMap<TickCandidates, PreparedLabels> | undefined;
let firstSet: WeakMap<TickCandidates, PreparedLabels> | undefined;

function axisLabels(candidates: TickCandidates, firstOnly: boolean): PreparedLabels {
  const limited = firstOnly && candidates.length > 1;
  const cache = limited ? (firstSet ??= new WeakMap()) : (allSets ??= new WeakMap());
  let prepared = cache.get(candidates);
  if (!prepared) {
    prepared = prepareLabels(candidates, limited ? 1 : candidates.length);
    cache.set(candidates, prepared);
  }
  return prepared;
}

/**
 * What a continuous axis fit depends on besides its tick candidates and the projected tick positions. A fit
 * reads a non-band scale only through `position(scale, tick)` for ticks of the prepared sets, and measures
 * text only through the shared widths of one measurer and style.
 */
interface FitKey {
  readonly fitter: 'value' | 'bottom';
  readonly side: 'left' | 'bottom';
  readonly role: PlacedText['role'];
  readonly span: number;
  readonly room: number;
  readonly rotatedRoom: number;
  readonly mayThin: boolean;
  readonly widths: Map<string, number>;
  readonly measurer: TextMeasurer;
  readonly style: TextStyle;
}

interface FitMemo {
  readonly key: FitKey;
  readonly positions: Float64Array;
  readonly fit: FittedLabels;
}

interface FitMemos {
  /** The layout in which these prepared labels were first fitted. */
  readonly run: number;
  readonly entries: FitMemo[];
}

// A stream keeps its value axis candidates while x moves: the same fits repeat frame after frame. Candidates
// seen in one layout only (a rolling x axis) never pay for recording positions.
const FIT_MEMO_ENTRIES = 4;
const FIT_MEMO_TICKS = 256;
let fitMemos: WeakMap<PreparedLabels, FitMemos> | undefined;
let layoutRun = 0;
let tickPixels: Float64Array | undefined;

function sameFitKey(a: FitKey, b: FitKey): boolean {
  return a.fitter === b.fitter && a.side === b.side && a.role === b.role && Object.is(a.span, b.span) &&
    Object.is(a.room, b.room) && Object.is(a.rotatedRoom, b.rotatedRoom) && a.mayThin === b.mayThin &&
    a.widths === b.widths && a.measurer === b.measurer && a.style === b.style;
}

/** Positions of every prepared tick into `tickPixels`; -1 when there are too many to be worth comparing. */
function tickPositions(prepared: PreparedLabels, scale: ContinuousScale): number {
  let count = 0;
  for (const set of prepared.sets) count += set.length;
  if (count > FIT_MEMO_TICKS) return -1;
  const pixels = tickPixels ??= new Float64Array(FIT_MEMO_TICKS);
  let at = 0;
  for (const set of prepared.sets) for (const tick of set) pixels[at++] = scale.map(tick.value);
  return count;
}

function samePositions(stored: Float64Array, count: number): boolean {
  if (stored.length !== count) return false;
  const pixels = tickPixels!;
  for (let i = 0; i < count; i++) if (!Object.is(stored[i], pixels[i])) return false;
  return true;
}

function rememberedFit(prepared: PreparedLabels, scale: XScale, key: FitKey | null, fit: () => FittedLabels): FittedLabels {
  if (!key || scale.type === 'band') return fit();
  const memos = fitMemos ??= new WeakMap();
  const memo = memos.get(prepared);
  if (!memo) {
    memos.set(prepared, { run: layoutRun, entries: [] });
    return fit();
  }
  if (memo.run === layoutRun && memo.entries.length === 0) return fit();
  const count = tickPositions(prepared, scale);
  if (count < 0) return fit();
  const { entries } = memo;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (!sameFitKey(entry.key, key) || !samePositions(entry.positions, count)) continue;
    if (i > 0) { entries.splice(i, 1); entries.unshift(entry); }
    return entry.fit;
  }
  const fitted = fit();
  entries.unshift({ key, positions: tickPixels!.slice(0, count), fit: fitted });
  if (entries.length > FIT_MEMO_ENTRIES) entries.pop();
  return fitted;
}

const NO_TITLE: readonly string[] = [];

function titleLines(title: string | undefined, span: number, text: Metrics): readonly string[] | null {
  if (!title) return NO_TITLE;
  const lines = wrapText(title, span, text);
  for (const line of lines) if (text.width(line) > span) return null;
  return lines;
}

const titleSize = (lines: readonly string[], text: Metrics) => lines.length ? GAP + lines.length * text.lineHeight : 0;

function layoutAxes(
  input: PlotInput & Cartesian & TextInput, size: Size, text: Metrics, showTicks: boolean,
  measured: number[], fit: AxisFit = {}, widths?: Map<string, number>,
): Layout {
  const { width, height } = size;
  const horizontal = input.kind === 'bands' && input.horizontal;
  const leftAxis = horizontal ? input.x : input.y;
  const bottomAxis = horizontal ? input.y : input.x;
  const leftCandidates = leftAxis.candidates;
  const bottomCandidates = bottomAxis.candidates;
  const leftLabels = showTicks ? axisLabels(leftCandidates, horizontal) : undefined;
  const bottomLabels = showTicks ? axisLabels(bottomCandidates, !horizontal && !bottomAxis.mayThin) : undefined;
  const leftRole = horizontal ? 'tick-x' : 'tick-y';
  const bottomRole = horizontal ? 'tick-y' : 'tick-x';
  const clearance = leftLabels?.sets.some(ticks => ticks.length > 0) ? text.lineHeight / 2 : 0;
  const top = INSET + clearance;
  let left = INSET;
  let bottom = INSET + clearance;
  const visited: number[] = [];
  let growMargins = false;
  let lastBottom = -1, lastLeft = -1;
  let leftTitle = NO_TITLE, bottomTitle = NO_TITLE;
  let leftTitleSize = 0, bottomTitleSize = 0;
  let leftFit = NO_LABELS, bottomFit = NO_LABELS;

  for (;;) {
    const plot = { x: left, y: top, width: width - left - INSET, height: height - top - bottom };
    if (plot.width < MIN_WIDTH - 1e-7 || plot.height < MIN_HEIGHT - 1e-7) return tooSmall(size);

    const projection = project(plot, input);
    const xScale = projection.kind === 'xy' ? projection.x : projection.band;
    const yScale = projection.kind === 'xy' ? projection.y : projection.value;
    // Each axis has the same range and title room when its own span has not changed.
    if (bottom !== lastBottom) {
      const lines = titleLines(leftAxis.title, plot.height, text);
      if (!lines) return tooSmall(size);
      lastBottom = bottom;
      leftTitle = lines;
      leftTitleSize = titleSize(lines, text);
      const room = width - 2 * INSET - MIN_WIDTH - leftTitleSize - TICK_GAP;
      if (leftLabels) leftFit = horizontal
        ? fitLeftCategories(leftCandidates[0] ?? [], xScale, width, height, leftRole, text, room, leftLabels)
        : rememberedFit(leftLabels, yScale, widths ? {
          fitter: 'value', side: 'left', role: leftRole, span: height, room, rotatedRoom: room, mayThin: true,
          widths, measurer: input.measurer, style: input.style,
        } : null, () => fitValue(leftCandidates, yScale, 'left', height, room, leftRole, text, leftLabels, measured));
    }
    if (left !== lastLeft) {
      const lines = titleLines(bottomAxis.title, plot.width, text);
      if (!lines) return tooSmall(size);
      lastLeft = left;
      bottomTitle = lines;
      bottomTitleSize = titleSize(lines, text);
      const fixed = INSET + clearance + bottomTitleSize + TICK_GAP;
      const room = height - top - MIN_HEIGHT - fixed;
      if (bottomLabels) {
        const rotatedRoom = Math.min(room, height * 0.4 - fixed);
        const key: FitKey | null = widths ? {
          fitter: horizontal ? 'value' : 'bottom', side: 'bottom', role: bottomRole, span: width, room,
          rotatedRoom: horizontal ? room : rotatedRoom, mayThin: horizontal || bottomAxis.mayThin,
          widths, measurer: input.measurer, style: input.style,
        } : null;
        bottomFit = horizontal
          ? rememberedFit(bottomLabels, yScale, key,
            () => fitValue(bottomCandidates, yScale, 'bottom', width, room, bottomRole, text, bottomLabels, measured))
          : rememberedFit(bottomLabels, xScale, key, () => fitBottom(bottomCandidates, bottomAxis.mayThin, xScale, width, room,
            bottomRole, text, bottomLabels, rotatedRoom, measured));
      }
    }

    const nextLeft = INSET + lane(leftFit) + leftTitleSize;
    const nextBottom = INSET + clearance + lane(bottomFit) + bottomTitleSize;
    // A sparser tick set can free space for a denser set on the next pass. If that
    // cycles, keep enough margin for either fit and use the labels at the final ranges.
    if (!growMargins) {
      if (visited.length === 32) growMargins = true;
      else for (let i = 0; i < visited.length; i += 2) {
        if (visited[i] === left && visited[i + 1] === bottom) { growMargins = true; break; }
      }
    }
    if ((!growMargins && nextLeft === left && nextBottom === bottom) ||
        (growMargins && nextLeft <= left && nextBottom <= bottom)) {
      const base = plot.y + plot.height + clearance;
      const texts: PlacedText[] = [];
      for (const label of leftFit.texts) texts.push(moveText(label, left - TICK_GAP, 0));
      for (const label of bottomFit.texts) texts.push(moveText(label, 0, base + TICK_GAP));
      if (leftAxis.title && leftTitle.length) {
        texts.push(placeText(leftTitle, leftAxis.title, left - lane(leftFit) - GAP - leftTitle.length * text.lineHeight / 2,
          plot.y + plot.height / 2, 'middle', 'middle', -90, horizontal ? 'title-x' : 'title-y', text));
      }
      if (bottomAxis.title && bottomTitle.length) {
        texts.push(placeText(bottomTitle, bottomAxis.title, left + plot.width / 2, base + lane(bottomFit) + GAP,
          'middle', 'top', 0, horizontal ? 'title-y' : 'title-x', text));
      }

      const xFit = horizontal ? leftFit : bottomFit;
      const yFit = horizontal ? bottomFit : leftFit;
      fit.y = yFit.partial;
      fit.x = input.x.type !== 'band' && xFit.partial;
      placeReferences(input.references ?? [], projection, plot, texts, text, input.referenceXDomain);
      return {
        ...size, kind: 'plot', plot, projection, xTicks: xFit.ticks, yTicks: yFit.ticks, texts,
        fit: {
          x: { remedies: xFit.remedies, hidden: hiddenCategories(input.x, xFit) },
          y: { remedies: yFit.remedies, hidden: 0 },
        },
      };
    }
    if (!growMargins) visited.push(left, bottom);
    left = growMargins ? Math.max(left, nextLeft) : nextLeft;
    bottom = growMargins ? Math.max(bottom, nextBottom) : nextBottom;
  }
}

export function computeLayout(input: LayoutInput, widths?: Map<string, number>): Layout {
  const { width, height } = input;
  const size = { width, height };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ...size, kind: 'unmeasured' };

  if (input.kind === 'message') {
    const text = metrics(input);
    const maxLines = Math.floor((height - 2 * INSET) / text.lineHeight);
    const lines = messageLines(input.message, width - 2 * INSET, maxLines, text);
    return { ...size, kind: 'message', text: placeText(lines, input.message, width / 2, height / 2, 'middle', 'middle', 0, 'message', text) };
  }
  if (input.compact) {
    const x = Math.min(2, width / 2);
    const y = Math.min(2, height / 2);
    const plot = { x, y, width: width - 2 * x, height: height - 2 * y };
    return { ...size, kind: 'compact', plot, projection: input.kind === 'ring' ? ring(plot) : project(plot, input) };
  }
  if (input.kind === 'ring') {
    if (width < MIN_WIDTH || height < MIN_HEIGHT) return tooSmall(size);
    const plot = { x: 0, y: 0, width, height };
    return { ...size, kind: 'plot', plot, projection: ring(plot), xTicks: [], yTicks: [], texts: [], fit: { x: UNCHANGED, y: UNCHANGED } };
  }
  if (width < MIN_WIDTH + 2 * INSET || height < MIN_HEIGHT + 2 * INSET) return tooSmall(size);
  const text = metrics(input, widths);
  const fit: AxisFit = {};
  const measured: number[] = [];
  layoutRun++;
  let layout = layoutAxes(input, size, text, true, measured, fit, widths);
  // Titles may need the space otherwise reserved for ticks at the ends of the left axis.
  if (layout.kind === 'too-small') return layoutAxes(input, size, text, false, measured);
  let chosen = input;
  // Try the value axis first. Only a scatter's numeric x also has coarser domains.
  for (const key of ['y', 'x'] as const) {
    const axis = chosen[key];
    if (!fit[key] || !('coarser' in axis)) continue;
    for (const coarser of axis.coarser ?? []) {
      const candidate = { ...chosen, [key]: { ...axis, ...coarser, coarser: undefined } };
      const next: AxisFit = {};
      const wider = layoutAxes(candidate, size, text, true, measured, next, widths);
      if (wider.kind !== 'plot' || next[key] || (key === 'x' && next.y && !fit.y)) continue;
      layout = wider;
      chosen = candidate;
      fit.x = next.x;
      break;
    }
  }
  return layout;
}
