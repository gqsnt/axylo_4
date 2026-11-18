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
const extrema = new WeakMap<AlignedView | ScatterView, Span>();
const widenedDomains = new WeakMap<AlignedView, string | undefined>();

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
  return Array.from({ length: count }, (_, i) => {
    if (existing && i < existing.length) return existing[i]!;
    const cycle = Math.floor(i / SHAPES.length);
    const contrast = CONTRAST_DASHES[i % CONTRAST_DASHES.length]!;
    return {
      marker: SHAPES[(i + cycle) % SHAPES.length]!,
      dash: { normal: cycle ? [2 + i, 3] : compact ? contrast : null, contrast },
    };
  });
}

function positionIndex(values: Float64Array, x: number, upper: boolean): number {
  let start = 0;
  let end = values.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    const value = values[middle]!;
    if (value < x || upper && value === x) start = middle + 1;
    else end = middle;
  }
  return start;
}

function rangeOf(values: Float64Array, domain: Span, previous?: IndexRange): IndexRange {
  const range = { start: positionIndex(values, domain[0], false), end: positionIndex(values, domain[1], true) };
  return previous && sameRange(range, previous) ? previous : range;
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

function interpolated(x: Float64Array, edge: number, left: number, right: number, a: number, b: number): number {
  const start = x[left]!;
  const end = x[right]!;
  if (edge === start || a === b) return a;
  if (edge === end) return b;
  const width = end - start;
  const t = Number.isFinite(width) ? (edge - start) / width : (edge / 2 - start / 2) / (end / 2 - start / 2);
  const delta = b - a;
  const value = Number.isFinite(delta) ? a + delta * t : a * (1 - t) + b * t;
  return Math.max(Math.min(a, b), Math.min(value, Math.max(a, b)));
}

function alignedExtrema(
  frame: AlignedFrame, visible: readonly boolean[], range: IndexRange, draws: readonly IndexRange[],
  domain: Span, stack: StackView | null, kind: AlignedView['kind'],
): Span {
  let min = Infinity;
  let max = -Infinity;
  const x = frame.x.values;
  const { start, end } = kind === 'bar' ? draws[0] ?? range : range;
  const negative = stack?.negative.at(-1);
  const positive = stack?.positive.at(-1);
  if (negative && positive) {
    for (let i = start; i < end; i++) {
      min = Math.min(min, negative[i]!);
      max = Math.max(max, positive[i]!);
    }
  }
  const include = (value: number) => {
    min = Math.min(min, value);
    max = Math.max(max, value);
  };
  let reachesLeft = false;
  let reachesRight = false;

  for (let series = 0, k = 0; series < frame.series.length; series++) {
    if (!visible[series]) continue;
    const { y, slot } = frame.series[series]!;
    if (!stack) {
      for (let j = start; j < end; j++) {
        if (slot[j] === SLOT_VALUE) include(y[j]!);
      }
    }
    if (kind === 'bar') continue;

    const draw = draws[series]!;
    const below = stack?.negative[k];
    const above = stack?.positive[k++];
    const stroke = (index: number) => (y[index]! < 0 ? below : above)?.[index] ?? y[index]!;
    if (draw.start < start) {
      const right = nextObservation(slot, start, draw.end, 1);
      include(interpolated(x, domain[0], draw.start, right, stroke(draw.start), stroke(right)));
      reachesLeft = true;
    }
    if (draw.end > end) {
      const left = nextObservation(slot, end - 1, draw.start - 1, -1);
      const right = draw.end - 1;
      include(interpolated(x, domain[1], left, right, stroke(left), stroke(right)));
      reachesRight = true;
    }
  }
  if (negative && positive) {
    // Stacked fills use adjacent frame slots even when their component strokes join across NO_ROW.
    if (reachesLeft) {
      include(interpolated(x, domain[0], start - 1, start, negative[start - 1]!, negative[start]!));
      include(interpolated(x, domain[0], start - 1, start, positive[start - 1]!, positive[start]!));
    }
    if (reachesRight) {
      include(interpolated(x, domain[1], end - 1, end, negative[end - 1]!, negative[end]!));
      include(interpolated(x, domain[1], end - 1, end, positive[end - 1]!, positive[end]!));
    }
  }
  return [min, max];
}

function pointExtrema(frame: PointFrame, visible: readonly boolean[], ranges: readonly IndexRange[]): Span {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < frame.series.length; i++) {
    if (!visible[i]) continue;
    const { y } = frame.series[i]!;
    const { start, end } = ranges[i]!;
    for (let j = start; j < end; j++) {
      min = Math.min(min, y[j]!);
      max = Math.max(max, y[j]!);
    }
  }
  return [min, max];
}

function scatterX(frame: PointFrame, sink: DiagnosticSink): Span {
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
  if (count > 50_000) report(sink, 'AX133', 'none');
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

function xExtents(
  data: Span, kind: XKind, readX: ReturnType<typeof positionReader>, references: readonly ResolvedReference[],
  state: AlignedViewState | ScatterViewState, compact: boolean, sink: DiagnosticSink,
): { xFull: Span; xDomain: Span } {
  const authorInput = state.xDomain === undefined ? state.xField?.domain : state.xDomain;
  const author = readSpan(authorInput, readX, 'x.domain', sink);
  let [min, max] = data;
  for (const reference of references) {
    if (reference.axis !== 'x') continue;
    min = Math.min(min, reference.from);
    max = Math.max(max, reference.to);
  }
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
  const positions = references.flatMap(r => r.axis === 'y' ? [r.from, r.to] : []);
  if (state.valueDomain && !state.valueDomain.every(Number.isFinite)) {
    report(sink, 'AX103', 'none', { field: 'y.domain' });
  }
  return valueDomain({
    min: data[0], max: data[1], includeZero: state.kind === 'bar' || state.kind === 'area',
    authorDomain: state.valueDomain, valueScale: scale, references: positions,
  });
}

function alignedScale(frame: AlignedFrame, visible: readonly boolean[]): CartesianState['valueScale'] {
  const scale = frame.series.find((_, i) => visible[i])?.valueScale;
  return frame.series.every((series, i) => !visible[i] || series.valueScale === scale) ? scale : null;
}

function keepSpan(span: Span, previous?: Span): Span {
  return previous && sameSpan(span, previous) ? previous : span;
}

export function buildView(frame: AlignedFrame, state: AlignedViewState, sink: DiagnosticSink): AlignedView;
export function buildView(frame: PointFrame, state: ScatterViewState, sink: DiagnosticSink): ScatterView;
export function buildView(frame: DonutFrame, state: DonutViewState, sink: DiagnosticSink): DonutView;
export function buildView(frame: Frame, state: ViewState, sink: DiagnosticSink): View;
export function buildView(frame: Frame, state: ViewState, sink: DiagnosticSink): View {
  const previous = state.previous?.kind === state.kind ? state.previous : undefined;
  if (frame.shape === 'donut' && state.kind === 'donut') {
    return buildDonut(frame, state.otherLabel, previous?.kind === 'donut' ? previous : undefined, sink);
  }
  if (frame.shape === 'donut' || state.kind === 'donut' || (frame.shape === 'points') !== (state.kind === 'scatter')) {
    throw new TypeError('The view kind must match the frame shape.');
  }

  const prior = previous?.kind !== 'donut' ? previous : undefined;
  const sameFrame = prior?.frame === frame;
  const compact = state.kind !== 'scatter' && (state.compact ?? false);
  const visible = reuse(frame.series.map(series => series.drawable && !state.hidden?.has(series.key)), prior?.visible, (a, b) => a === b);
  const seriesCues = cues(frame.series.length, compact, prior, sink);
  const column = frame.shape === 'aligned' ? frame.x : { kind: frame.xKind, timeZone: frame.timeZone, categories: null };
  const readX = positionReader(column, state.xField);
  const references = reuse(resolveReferences(state.references ?? [], readX, column.kind, sink), prior?.references,
    (a, b) => a.axis === b.axis && a.from === b.from && a.to === b.to && a.label === b.label);
  const category = column.kind === 'category';
  const continuousBars = state.kind === 'bar' && !category;
  const xData: Span = frame.shape === 'aligned'
    ? continuousBars ? barExtent(frame.x.values) : [frame.x.values[0] ?? Infinity, frame.x.values[frame.length - 1] ?? -Infinity]
    : scatterX(frame, sink);
  const spans = xExtents(xData, column.kind, readX, references, state, compact, sink);
  const xFull = keepSpan(spans.xFull, prior?.xFull);
  const xDomain = sameSpan(xFull, spans.xDomain) ? xFull : keepSpan(spans.xDomain, prior?.xDomain);
  const shared = { compact, visible, cues: seriesCues, references, revision: frame.revision, xFull, xDomain };
  const sameShared = sameFrame && prior.compact === compact && prior.visible === visible &&
    prior.cues === seriesCues && prior.references === references && prior.xFull === xFull && prior.xDomain === xDomain;
  const oldExtrema = sameFrame && prior.visible === visible ? extrema.get(prior) : undefined;

  if (frame.shape === 'points' && state.kind === 'scatter') {
    const old = prior?.kind === 'scatter' ? prior : undefined;
    const visiblePoints = sameFrame && old?.xDomain === xDomain ? old.visiblePoints : reuse(
      frame.series.map(({ x }, i) => rangeOf(x, xDomain, old?.visiblePoints[i])), old?.visiblePoints, sameRange,
    );
    const data = oldExtrema && old?.visiblePoints === visiblePoints ? oldExtrema : pointExtrema(frame, visible, visiblePoints);
    const yDomain = keepSpan(yExtent(data, references, state, state.valueScale, sink).domain, old?.yDomain);
    if (sameShared && old?.visiblePoints === visiblePoints && old.yDomain === yDomain) return old;
    const view: ScatterView = { ...shared, kind: 'scatter', frame, visiblePoints, yDomain };
    extrema.set(view, data);
    return view;
  }

  if (frame.shape !== 'aligned' || state.kind === 'scatter') throw new TypeError('Expected an aligned chart.');
  const old = prior?.kind === state.kind ? prior : undefined;
  const horizontal = state.kind === 'bar' && (state.horizontal ?? false);
  const visibleSlots = sameFrame && old?.xDomain === xDomain ? old.visibleSlots : rangeOf(frame.x.values, xDomain, old?.visibleSlots);
  const singlePosition = xDomain[0] === xDomain[1];
  const sameDrawWindow = sameFrame && old !== undefined && (continuousBars ? old.xDomain === xDomain
    : old.visibleSlots === visibleSlots && (old.xDomain[0] === old.xDomain[1]) === singlePosition);
  const barSlots = continuousBars ? barRange(frame.x.values, visibleSlots, xDomain) : visibleSlots;
  const drawSlots = sameDrawWindow ? old.drawSlots : reuse(
    frame.series.map(({ slot }) => state.kind === 'bar' || category || singlePosition ? barSlots : drawRange(slot, visibleSlots)),
    old?.drawSlots, sameRange,
  );
  const stack = state.stacked && state.kind !== 'line'
    ? sameFrame && old?.visible === visible && old.stack ? old.stack : buildStack(frame, visible)
    : null;
  if (stack) reportStack(stack, sink);
  const data = oldExtrema && old?.xDomain === xDomain && old.stack === stack
    ? oldExtrema : alignedExtrema(frame, visible, visibleSlots, drawSlots, xDomain, stack, state.kind);
  const scale = state.valueScale === undefined ? alignedScale(frame, visible) : state.valueScale;
  const field = state.valueField ?? (frame.yLabel === null ? undefined : frame.series[0]?.field);
  const { domain, widenedToZero } = yExtent(data, references, state, scale, sink);
  const wasWidened = old !== undefined && widenedDomains.has(old);
  const sameWidening = wasWidened === widenedToZero && (!wasWidened || widenedDomains.get(old!) === field);
  if (widenedToZero && !sameWidening) report(sink, 'AX110', 'none', { field });
  const yDomain = keepSpan(domain, old?.yDomain);
  if (sameShared && old?.visibleSlots === visibleSlots && old.stack === stack &&
    old.yDomain === yDomain && old.horizontal === horizontal && sameWidening) return old;
  const view: AlignedView = { ...shared, kind: state.kind, frame, horizontal, visibleSlots, drawSlots, stack, yDomain };
  extrema.set(view, data);
  if (widenedToZero) widenedDomains.set(view, field);
  return view;
}
