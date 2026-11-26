import { denseSlots, fullStatistics, hasBlockSummary, windowStatistics, withSignedZeros, WINDOW_SIZE as BLOCK, type Statistics } from '../data/store-statistics';
import { lowerBound, upperBound } from '../data/search';
import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedFrame, type AlignedView, type DiagnosticSink, type DonutFrame,
  type DonutView, type Frame, type IndexRange, type MarkerShape, type PointFrame, type ResolvedReference,
  type ScatterView, type SeriesCue, type StackView, type View, type XKind,
} from '../core/contracts';
import type { ResolvedXField } from '../data';
import { report } from '../diagnostics';
import type { Reference, ValueFieldOptions, XValue } from '../public';
import { valueDomain } from '../scale';
import { barExtent, barRange } from './bar-bands';
import { buildDonut } from './donut';
import { positionReader, readSpan, resolveReferences, type Span } from './references';
import { buildStack, reportStack } from './stack';

interface CartesianState {
  readonly hidden?: ReadonlySet<string>;
  readonly zoom?: Span<XValue> | null;
  readonly xDomain?: Span<XValue> | null;
  readonly valueDomain?: Span | null;
  readonly valueScale?: ValueFieldOptions['scale'] | null;
  /** Preserves the declared x type when parsing option values on an inferred axis. */
  readonly xField?: ResolvedXField;
  readonly valueField?: string;
  readonly references?: readonly Reference[];
}

export interface AlignedViewState extends CartesianState {
  readonly kind: AlignedView['kind'];
  readonly stacked?: boolean;
  readonly horizontal?: boolean;
  readonly compact?: boolean;
  readonly previous?: View | null;
}

export interface ScatterViewState extends CartesianState {
  readonly kind: 'scatter';
  readonly previous?: View | null;
}

export interface DonutViewState {
  readonly kind: 'donut';
  readonly otherLabel: (count: number) => string;
  readonly previous?: View | null;
}

export type ViewState = AlignedViewState | ScatterViewState | DonutViewState;

const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star'];
const CONTRAST_DASHES: readonly SeriesCue['dash']['contrast'][] = [
  null, [12, 5], [5, 4], [1, 5], [9, 4, 1, 4], [9, 4, 1, 4, 1, 4], [12, 4, 5, 4], [1, 2],
];
let standardCues: readonly SeriesCue[] | undefined;
let compactCues: readonly SeriesCue[] | undefined;

function cueTable(compact: boolean): readonly SeriesCue[] {
  return SHAPES.map((marker, i) => {
    const contrast = Object.freeze(CONTRAST_DASHES[i]!);
    return Object.freeze({ marker, dash: Object.freeze({ normal: compact ? contrast : null, contrast }) });
  });
}

let extrema: WeakMap<AlignedView | ScatterView, Span> | undefined;
const noReferences: readonly ResolvedReference[] = [];
let widenedDomains: WeakMap<AlignedView, string | undefined> | undefined;

function reuse<T>(values: T[], previous: readonly T[] | undefined, same: (a: T, b: T) => boolean): readonly T[] {
  if (!previous) return values;
  let unchanged = previous.length === values.length;
  for (let i = 0, end = Math.min(values.length, previous.length); i < end; i++) {
    if (same(values[i]!, previous[i]!)) values[i] = previous[i]!;
    else unchanged = false;
  }
  return unchanged ? previous : values;
}

function sameSpan(a: Span, b: Span): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameRange(a: IndexRange, b: IndexRange): boolean {
  return a.start === b.start && a.end === b.end;
}

function cues(count: number, compact: boolean, previous: AlignedView | ScatterView | undefined, sink: DiagnosticSink): readonly SeriesCue[] {
  if (count > SHAPES.length && (previous?.cues.length ?? 0) <= SHAPES.length) report(sink, 'AX130', 'none');
  if (compact && count > 1 && !(previous?.compact && previous.cues.length > 1)) report(sink, 'AX131', 'none');
  const existing = previous?.compact === compact ? previous.cues : undefined;
  if (existing?.length === count) return existing;
  const shared = compact ? (compactCues ??= cueTable(true)) : (standardCues ??= cueTable(false));
  return Array.from({ length: count }, (_, i) => {
    if (i < shared.length) return shared[i]!;
    if (existing && i < existing.length) return existing[i]!;
    const cycle = Math.floor(i / SHAPES.length);
    const contrast = CONTRAST_DASHES[i % CONTRAST_DASHES.length]!;
    return {
      marker: SHAPES[(i + cycle) % SHAPES.length]!,
      dash: { normal: [2 + i, 3], contrast },
    };
  });
}

function rangeOf(values: Float64Array, domain: Span, previous?: IndexRange, edges?: Float64Array | null): IndexRange {
  const length = values.length;
  let start: number;
  let end: number;
  if (edges?.length) {
    start = Math.min(length, Math.max(0, upperBound(edges, domain[0]) - 1));
    end = Math.min(length, lowerBound(edges, domain[1]));
  } else {
    start = domain[0] <= values[0]! ? 0 : lowerBound(values, domain[0]);
    end = domain[1] >= values[length - 1]! ? length : upperBound(values, domain[1]);
  }
  return previous?.start === start && previous.end === end ? previous : { start, end };
}

function nextObservation(slot: Uint8Array, from: number, end: number, direction: -1 | 1): number {
  while (from !== end && slot[from] === SLOT_NO_ROW) from += direction;
  return from;
}

function drawRange(slot: Uint8Array, range: IndexRange): IndexRange {
  const { start, end } = range;
  const first = nextObservation(slot, start, end, 1);
  const last = first === end ? start - 1 : nextObservation(slot, end - 1, start - 1, -1);
  let left = start;
  let right = end;
  if (first === end || slot[first] === SLOT_VALUE) {
    const outside = nextObservation(slot, start - 1, -1, -1);
    if (slot[outside] === SLOT_VALUE) left = outside;
  }
  if (first === end || slot[last] === SLOT_VALUE) {
    const outside = nextObservation(slot, end, slot.length, 1);
    if (slot[outside] === SLOT_VALUE) right = outside + 1;
  }
  // A view between observations can show their connecting segment, but only if both ends exist.
  if (first === end && (left === start || right === end)) return range;
  return left === start && right === end ? range : { start: left, end: right };
}

/** Stacked bands taper across the immediate frame interval even when a component has no stroke there. */
export function stackAreaRange(frame: AlignedFrame, visible: IndexRange, domain: Span): IndexRange {
  const { start, end } = visible;
  const x = frame.x.values;
  if (frame.x.kind === 'category') return visible;
  const left = start > 0 && start < x.length && domain[0] < x[start]! ? start - 1 : start;
  const right = end > 0 && end < x.length && x[end - 1]! < domain[1] ? end + 1 : end;
  return left === start && right === end ? visible : { start: left, end: right };
}

function adjacentDrawRange(slot: Uint8Array, visible: IndexRange, fill: IndexRange): IndexRange {
  const start = slot[fill.start] === SLOT_VALUE ? fill.start : visible.start;
  const end = slot[fill.end - 1] === SLOT_VALUE ? fill.end : visible.end;
  return { start, end };
}

export function interpolated(x: Float64Array, edge: number, left: number, right: number, y: Float64Array | Float32Array): number {
  let a = y[left]!;
  let b = y[right]!;
  let start = x[left]!;
  let end = x[right]!;
  if (edge === start || a === b) return a;
  if (edge === end) return b;
  // Measure the smaller distance directly. The complementary fraction can round to zero.
  if (end - edge < edge - start) {
    [start, end] = [end, start];
    [a, b] = [b, a];
  }
  const width = end - start;
  const t = Number.isFinite(width) ? (edge - start) / width : (edge / 2 - start / 2) / (end / 2 - start / 2);
  const delta = b - a;
  const value = Number.isFinite(delta) ? a + delta * t : a * (1 - t) + b * t;
  return Math.max(Math.min(a, b), Math.min(value, Math.max(a, b)));
}

const SUMMARY_THRESHOLD = 4096; // Sixteen blocks.
type AlignedSeries = AlignedFrame['series'][number];
interface WindowStatistics {
  readonly start: number;
  readonly end: number;
  readonly ordered: Statistics;
  readonly signed: Statistics;
}

// Published series are immutable. Updates and appends publish new series, even when they share a buffer.
let summaries: WeakMap<AlignedSeries, WindowStatistics> | undefined;

export function alignedStatistics(series: AlignedSeries, start: number, end: number, signedExtrema = false): Statistics {
  const { slot, y } = series;
  const size = end - start;
  const full = start === 0 && end === slot.length;
  if (full) {
    const known = fullStatistics.get(series);
    if (known) return signedExtrema ? known.signed : known.ordered;
  } else if (size >= BLOCK) {
    const known = summaries?.get(series);
    if (known?.start === start && known.end === end) return signedExtrema ? known.signed : known.ordered;
    // A short slice of a large column is cheaper to scan until a drawing index exists.
    if ((size >= SUMMARY_THRESHOLD && size >= slot.length / 16) || hasBlockSummary(y, slot)) {
      const stats = windowStatistics(y, slot, start, end);
      (summaries ??= new WeakMap()).set(series, { start, end, ...stats });
      return signedExtrema ? stats.signed : stats.ordered;
    }
  }
  let continuous = full;
  let min = Infinity;
  let max = -Infinity;
  let last = NaN;
  let zeros = 0;
  // Layout and the reader can ask for the same window with different signed-zero ordering.
  const trackZeros = signedExtrema || size >= BLOCK;
  for (let i = start; i < end; i++) {
    if (slot[i] !== SLOT_VALUE) { continuous = false; continue; }
    const value = y[i]!;
    if (!(value > -Infinity && value < Infinity)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (trackZeros && value === 0) zeros |= Object.is(value, -0) ? 1 : 2;
    last = value;
  }
  const stats = { min, max, last };
  if (size < BLOCK && !zeros) return stats;
  const summaryStats = withSignedZeros(stats, zeros);
  if (size >= BLOCK) {
    if (full) {
      fullStatistics.set(series, summaryStats);
      if (continuous) denseSlots.set(slot, 'fresh');
    } else {
      (summaries ??= new WeakMap()).set(series, { start, end, ...summaryStats });
    }
  }
  return signedExtrema ? summaryStats.signed : stats;
}

export function alignedExtrema(
  frame: AlignedFrame, visible: readonly boolean[], range: IndexRange, draws: readonly IndexRange[],
  domain: Span | null, stack: StackView | null, kind: AlignedView['kind'],
): Span {
  let min = Infinity;
  let max = -Infinity;
  const x = frame.x.values;
  if (stack) {
    const { start, end } = kind === 'bar' ? draws[0] ?? range : range;
    // Every component stroke lies between the two cumulative totals on each adjacent interval.
    const fill = domain && kind === 'area' ? stackAreaRange(frame, range, domain) : range;
    for (const total of [stack.negative.at(-1), stack.positive.at(-1)]) {
      if (!total) continue;
      for (let i = start; i < end; i++) {
        const value = total[i]!;
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
      }
      if (domain && fill.start < start) {
        const value = interpolated(x, domain[0], start - 1, start, total);
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
      }
      if (domain && end < fill.end) {
        const value = interpolated(x, domain[1], end - 1, end, total);
        if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
      }
    }
    return [min, max];
  }
  for (let series = 0; series < frame.series.length; series++) {
    if (!visible[series]) continue;
    const component = frame.series[series]!;
    const { y, slot } = component;
    const { start, end } = kind === 'bar' ? draws[series] ?? range : range;
    const stats = alignedStatistics(component, start, end, true);
    min = Math.min(min, stats.min);
    max = Math.max(max, stats.max);
    if (!domain || kind === 'bar') continue;
    const draw = draws[series]!;
    if (draw.start < start) {
      const right = nextObservation(slot, start, draw.end, 1);
      const value = interpolated(x, domain[0], draw.start, right, y);
      if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
    }
    if (draw.end > end) {
      const left = nextObservation(slot, end - 1, draw.start - 1, -1);
      const right = draw.end - 1;
      const value = interpolated(x, domain[1], left, right, y);
      if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
    }
  }
  return [min, max];
}

export function pointExtrema(frame: PointFrame, visible: readonly boolean[], ranges: readonly IndexRange[]): Span {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < frame.series.length; i++) {
    if (!visible[i]) continue;
    const { y } = frame.series[i]!;
    const { start, end } = ranges[i]!;
    for (let j = start; j < end; j++) {
      const v = y[j]!;
      if (!(v > -Infinity && v < Infinity)) continue;
      if (v < min) min = v;
      else if (v === 0 && min === 0) min = Math.min(min, v);
      if (v > max) max = v;
      else if (v === 0 && max === 0) max = Math.max(max, v);
    }
  }
  return [min, max];
}

export function scatterX(frame: PointFrame, sink?: DiagnosticSink): Span {
  let min = Infinity;
  let max = -Infinity;
  let count = 0;
  for (const { x, drawable, missingX } of frame.series) {
    if (x.length) {
      min = Math.min(min, x[0]!);
      max = Math.max(max, x[x.length - 1]!);
      if (drawable) count += x.length;
    }
    // Observations with an x and no y belong to the default range too, so the table reaches them (F2).
    if (missingX) for (let i = 0; i < missingX.length; i++) {
      const v = missingX[i]!;
      if (Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
    }
  }
  if (sink && count > 50_000) report(sink, 'AX133', 'none');
  return [min, max];
}

function fitZoom(full: Span, zoom: Span | null): Span {
  if (!zoom) return full;
  const [low, high] = full;
  const [start, end] = zoom;
  if (start >= low && end <= high) return zoom;
  // Compare half-widths so even a window spanning the extremes of a numeric axis can be shifted.
  const width = end - start;
  const overflow = !Number.isFinite(width);
  const halfWidth = end / 2 - start / 2;
  if (overflow ? halfWidth >= high / 2 - low / 2 : width >= high - low) return full;
  if (start < low) {
    const shifted = overflow ? (low / 2 + halfWidth) * 2 : low + width;
    return shifted > low ? [low, Math.min(high, shifted)] : full;
  }
  const shifted = overflow ? (high / 2 - halfWidth) * 2 : high - width;
  return shifted < high ? [Math.max(low, shifted), high] : full;
}

export function withReferences(data: Span, references: readonly ResolvedReference[], axis: 'x' | 'y'): Span {
  if (references.length === 0) return data;
  let [min, max] = data;
  for (const reference of references) {
    if (reference.axis !== axis) continue;
    min = Math.min(min, reference.from);
    max = Math.max(max, reference.to);
  }
  return [min, max];
}

export function zeroBaseline(kind: View['kind']): boolean {
  return kind === 'area' || kind === 'bar' || kind === 'histogram';
}

function xExtents(
  data: Span, kind: XKind, readX: ReturnType<typeof positionReader>, references: readonly ResolvedReference[],
  state: AlignedViewState | ScatterViewState, compact: boolean, sink: DiagnosticSink,
): { xFull: Span; xDomain: Span } {
  const authorInput = state.xDomain === undefined ? state.xField?.domain : state.xDomain;
  const author = readSpan(authorInput, readX, 'x.domain', sink);
  const [min, max] = withReferences(data, references, 'x');
  const xFull: Span = state.kind === 'scatter' && kind === 'number'
    ? valueDomain({ min, max, authorDomain: author, includeZero: false }).domain
    : author ?? (min <= max ? [min, max] : kind === 'category' ? [0, 0] : [0, 1]);
  const zoom = compact || kind === 'category' && state.kind === 'bar' ? null : readSpan(state.zoom, readX, 'zoom', sink, true);
  return { xFull, xDomain: fitZoom(xFull, zoom) };
}

function yExtent(
  data: Span, references: readonly ResolvedReference[], state: AlignedViewState | ScatterViewState,
  scale: CartesianState['valueScale'], sink: DiagnosticSink,
): ReturnType<typeof valueDomain> {
  const [min, max] = withReferences(data, references, 'y');
  if (state.valueDomain && !state.valueDomain.every(Number.isFinite)) {
    report(sink, 'AX103', 'none', { field: 'y.domain' });
  }
  return valueDomain({
    min, max, includeZero: zeroBaseline(state.kind),
    authorDomain: state.valueDomain, valueScale: scale,
  });
}

export function alignedScale(frame: AlignedFrame, visible: readonly boolean[]): AlignedFrame['series'][number]['valueScale'] {
  let scale: AlignedFrame['series'][number]['valueScale'] | undefined;
  for (let i = 0; i < frame.series.length; i++) {
    if (!visible[i]) continue;
    const value = frame.series[i]!.valueScale;
    if (scale === undefined) scale = value;
    else if (value !== scale) return null;
  }
  return scale ?? null;
}

function keepSpan(span: Span, previous?: Span): Span {
  return previous && sameSpan(span, previous) ? previous : span;
}

export function buildView(frame: AlignedFrame, state: AlignedViewState, sink: DiagnosticSink): AlignedView;
export function buildView(frame: PointFrame, state: ScatterViewState, sink: DiagnosticSink): ScatterView;
export function buildView(frame: DonutFrame, state: DonutViewState, sink: DiagnosticSink): DonutView;
export function buildView(frame: Frame, state: ViewState, sink: DiagnosticSink): View;
export function buildView(frame: Frame, state: ViewState, sink: DiagnosticSink): View {
  if (frame.shape === 'donut' && state.kind === 'donut') return buildDonutView(frame, state, sink);
  if (frame.shape === 'donut' || state.kind === 'donut' || (frame.shape === 'points') !== (state.kind === 'scatter')) {
    throw new TypeError('The view kind must match the frame shape.');
  }
  if (frame.shape === 'points' && state.kind === 'scatter') return buildScatterView(frame, state, sink);
  if (frame.shape !== 'aligned' || state.kind === 'scatter') throw new TypeError('Expected an aligned chart.');
  return buildAlignedView(frame, state, sink);
}

// One builder per frame shape, so a chart kind's composition reaches only its own; buildView above is the
// dispatch for callers that hold the kind as a value (validate()).

export function buildDonutView(frame: DonutFrame, state: DonutViewState, sink: DiagnosticSink): DonutView {
  const previous = state.previous?.kind === 'donut' ? state.previous : undefined;
  return buildDonut(frame, state.otherLabel, previous, sink);
}

function visibleSeries(
  series: AlignedFrame['series'] | PointFrame['series'], hidden: ReadonlySet<string> | undefined, previous?: readonly boolean[],
): readonly boolean[] {
  let visible = previous?.length === series.length ? undefined : new Array<boolean>(series.length);
  for (let i = 0; i < series.length; i++) {
    const { drawable, key } = series[i]!;
    const value = drawable && !hidden?.has(key);
    if (!visible && previous![i] !== value) visible = previous!.slice();
    if (visible) visible[i] = value;
  }
  return visible ?? previous!;
}

/** What the scatter and aligned views share: visibility, cues, references and the x domains. */
function cartesianBase(
  frame: AlignedFrame | PointFrame, state: AlignedViewState | ScatterViewState, sink: DiagnosticSink,
  /** The data's x extent (the shape's own: bar bands, or scatter's points and their missing observations). */
  extent: (continuousBars: boolean) => Span,
) {
  // A previous view of the same kind (never a donut here).
  const prior = state.previous?.kind === state.kind ? state.previous as AlignedView | ScatterView : undefined;
  const sameFrame = prior?.frame === frame;
  const compact = state.kind !== 'scatter' && (state.compact ?? false);
  const visible = visibleSeries(frame.series, state.hidden, prior?.visible);
  const seriesCues = cues(frame.series.length, compact, prior, sink);
  const column = frame.shape === 'aligned' ? frame.x : { kind: frame.xKind, timeZone: frame.timeZone, categories: null };
  const readX = positionReader(column, state.xField);
  const references = compact || !state.references?.length ? (prior?.references.length === 0 ? prior.references : noReferences)
    : reuse(resolveReferences(state.references, readX, column.kind, sink), prior?.references,
    (a, b) => a.axis === b.axis && a.from === b.from && a.to === b.to && a.label === b.label);
  const category = column.kind === 'category';
  const continuousBars = state.kind === 'bar' && !category;
  const xData = extent(continuousBars);
  const spans = xExtents(xData, column.kind, readX, references, state, compact, sink);
  const xFull = keepSpan(spans.xFull, prior?.xFull);
  const xDomain = sameSpan(xFull, spans.xDomain) ? xFull : keepSpan(spans.xDomain, prior?.xDomain);
  const shared = { compact, visible, cues: seriesCues, references, revision: frame.revision, xFull, xDomain };
  const sameShared = sameFrame && prior.compact === compact && prior.visible === visible &&
    prior.cues === seriesCues && prior.references === references && prior.xFull === xFull && prior.xDomain === xDomain;
  const oldExtrema = sameFrame && prior.visible === visible ? extrema?.get(prior) : undefined;
  return { prior, sameFrame, compact, visible, references, category, continuousBars, xFull, xDomain, shared, sameShared, oldExtrema };
}

export function buildScatterView(frame: PointFrame, state: ScatterViewState, sink: DiagnosticSink): ScatterView {
  const { prior, sameFrame, visible, references, xDomain, shared, sameShared, oldExtrema } = cartesianBase(frame, state, sink, () => scatterX(frame, sink));
  const old = prior?.kind === 'scatter' ? prior : undefined;
  const visiblePoints = sameFrame && old?.xDomain === xDomain ? old.visiblePoints : reuse(
    frame.series.map(({ x }, i) => rangeOf(x, xDomain, old?.visiblePoints[i])), old?.visiblePoints, sameRange,
  );
  const data = oldExtrema && old?.visiblePoints === visiblePoints ? oldExtrema : pointExtrema(frame, visible, visiblePoints);
  const yDomain = keepSpan(yExtent(data, references, state, state.valueScale, sink).domain, old?.yDomain);
  if (sameShared && old?.visiblePoints === visiblePoints && old.yDomain === yDomain) return old;
  const view: ScatterView = { ...shared, kind: 'scatter', frame, visiblePoints, yDomain };
  (extrema ??= new WeakMap()).set(view, data);
  return view;
}

type AlignedExtras = Partial<
  { buildStack: typeof buildStack; reportStack: typeof reportStack } &
  { barExtent: typeof barExtent; barRange: typeof barRange }
>;

export function alignedViewWith(extras: AlignedExtras): typeof buildAlignedView {
  return (frame, state, sink) => buildAligned(frame, state, sink, extras);
}

const noExtras = {};

export function buildPlainAlignedView(frame: AlignedFrame, state: AlignedViewState, sink: DiagnosticSink): AlignedView {
  return buildAligned(frame, state, sink, noExtras);
}

const fullExtras = { buildStack, reportStack, barExtent, barRange };

export function buildAlignedView(frame: AlignedFrame, state: AlignedViewState, sink: DiagnosticSink): AlignedView {
  return buildAligned(frame, state, sink, fullExtras);
}

function buildAligned(frame: AlignedFrame, state: AlignedViewState, sink: DiagnosticSink, extras: AlignedExtras): AlignedView {
  const edges = frame.binEdges;
  const { prior, sameFrame, visible, references, category, continuousBars, xDomain, shared, sameShared, oldExtrema } = cartesianBase(frame, state, sink,
    bars => edges?.length ? [edges[0]!, edges[edges.length - 1]!] : bars && extras.barExtent ? extras.barExtent(frame.x.values) : [frame.x.values[0] ?? Infinity, frame.x.values[frame.length - 1] ?? -Infinity]);
  const old = prior?.kind === state.kind ? prior : undefined;
  const horizontal = state.kind === 'bar' && (state.horizontal ?? false);
  const visibleSlots = sameFrame && old?.xDomain === xDomain ? old.visibleSlots : rangeOf(frame.x.values, xDomain, old?.visibleSlots, edges);
  const stack = extras.buildStack && state.stacked && state.kind !== 'line'
    ? sameFrame && old?.visible === visible && old.stack ? old.stack : extras.buildStack(frame, visible)
    : null;
  const singlePosition = xDomain[0] === xDomain[1];
  const stackedArea = stack !== null && state.kind === 'area';
  const sameDrawWindow = sameFrame && old !== undefined && Boolean(old.stack) === Boolean(stack) &&
    (continuousBars || stackedArea ? old.xDomain === xDomain
      : old.visibleSlots === visibleSlots && (old.xDomain[0] === old.xDomain[1]) === singlePosition);
  const barSlots = continuousBars && extras.barRange ? extras.barRange(frame.x.values, visibleSlots, xDomain) : visibleSlots;
  const fill = stackedArea ? stackAreaRange(frame, visibleSlots, xDomain) : null;
  // A full line window has no outside neighbours. A one-row slide keeps the same slot bounds.
  const sameFullLine = state.kind === 'line' && old && old.visibleSlots === visibleSlots &&
    visibleSlots.start === 0 && visibleSlots.end === frame.length && frame.length === old.frame.length &&
    frame.series.length === old.drawSlots.length;
  const drawSlots = sameDrawWindow || sameFullLine ? old.drawSlots : reuse(
    frame.series.map(({ slot }) => fill ? adjacentDrawRange(slot, visibleSlots, fill)
      : state.kind === 'bar' || edges || category || singlePosition ? barSlots : drawRange(slot, visibleSlots)),
    old?.drawSlots, sameRange,
  );
  if (stack) extras.reportStack?.(stack, sink);
  const data = oldExtrema && old?.xDomain === xDomain && old.stack === stack
    ? oldExtrema : alignedExtrema(frame, visible, visibleSlots, drawSlots, xDomain, stack, state.kind);
  const scale = state.valueScale === undefined ? alignedScale(frame, visible) : state.valueScale;
  const field = state.valueField ?? (frame.yLabel === null ? undefined : frame.series[0]?.field);
  const { domain, widenedToZero } = yExtent(data, references, state, scale, sink);
  const wasWidened = old !== undefined && widenedDomains?.has(old) === true;
  const sameWidening = wasWidened === widenedToZero && (!wasWidened || widenedDomains?.get(old!) === field);
  if (widenedToZero && !sameWidening) report(sink, 'AX110', 'none', { field });
  const yDomain = keepSpan(domain, old?.yDomain);
  if (sameShared && old?.visibleSlots === visibleSlots && old.stack === stack &&
    old.yDomain === yDomain && old.horizontal === horizontal && sameWidening) return old;
  const view: AlignedView = { ...shared, kind: state.kind, frame, horizontal, visibleSlots, drawSlots, stack, yDomain };
  (extrema ??= new WeakMap()).set(view, data);
  if (widenedToZero) (widenedDomains ??= new WeakMap()).set(view, field);
  return view;
}
