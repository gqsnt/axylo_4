import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedFrame, type AlignedView, type DiagnosticSink, type DonutFrame,
  type DonutView, type Frame, type IndexRange, type MarkerShape, type PointFrame, type ResolvedReference,
  type ScatterView, type SeriesCue, type StackView, type View, type XColumn,
} from '../core/contracts';
import type { ResolvedXField } from '../data';
import { report } from '../diagnostics';
import type { Reference, ValueFieldOptions, XValue } from '../public';
import { valueDomain } from '../scale';
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
const extrema = new WeakMap<AlignedView | ScatterView, Span>();

function reuse<T>(values: readonly T[], previous: readonly T[] | undefined, same: (a: T, b: T) => boolean): readonly T[] {
  if (!previous || previous.length !== values.length) return values;
  return values.every((value, i) => same(value, previous[i]!)) ? previous : values;
}

function sameSpan(a: Span, b: Span): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function sameRange(a: IndexRange, b: IndexRange): boolean {
  return a.start === b.start && a.end === b.end;
}

function cues(count: number, compact: boolean, previous: AlignedView | ScatterView | undefined, sink: DiagnosticSink): readonly SeriesCue[] {
  if (count > SHAPES.length) report(sink, 'AX130', 'none');
  if (compact && count > 1) report(sink, 'AX131', 'none');
  if (previous?.compact === compact && previous.cues.length === count) return previous.cues;
  return Array.from({ length: count }, (_, i) => {
    const contrast = i === 0 ? null : [2 + i, 3];
    return {
      marker: SHAPES[i % SHAPES.length]!,
      dash: { normal: compact || i >= SHAPES.length ? contrast : null, contrast },
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

function alignedExtrema(frame: AlignedFrame, visible: readonly boolean[], range: IndexRange, stack: StackView | null): Span {
  let min = Infinity;
  let max = -Infinity;
  if (stack) {
    const negative = stack.negative.at(-1);
    const positive = stack.positive.at(-1);
    if (negative && positive) {
      for (let i = range.start; i < range.end; i++) {
        min = Math.min(min, negative[i]!);
        max = Math.max(max, positive[i]!);
      }
    }
  } else {
    for (let i = 0; i < frame.series.length; i++) {
      if (!visible[i]) continue;
      const { y, slot } = frame.series[i]!;
      for (let j = range.start; j < range.end; j++) {
        if (slot[j] !== SLOT_VALUE) continue;
        min = Math.min(min, y[j]!);
        max = Math.max(max, y[j]!);
      }
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
  for (const { x, drawable } of frame.series) {
    if (!x.length) continue;
    min = Math.min(min, x[0]!);
    max = Math.max(max, x[x.length - 1]!);
    if (drawable) count += x.length;
  }
  if (count > 50_000) report(sink, 'AX133', 'none');
  return [min, max];
}

function xExtents(
  data: Span, column: Pick<XColumn, 'kind' | 'categories' | 'timeZone'>, readX: (value: XValue) => number,
  state: AlignedViewState | ScatterViewState, compact: boolean, sink: DiagnosticSink,
): { xFull: Span; xDomain: Span } {
  const category = column.kind === 'category';
  const author = category ? null : readSpan(state.xDomain ?? state.xField?.domain, readX, 'x.domain', sink);
  const min = Math.min(data[0], author?.[0] ?? Infinity);
  const max = Math.max(data[1], author?.[1] ?? -Infinity);
  const xFull: Span = min <= max ? [min, max] : category ? [0, 0] : [0, 1];
  const zoom = compact || category && state.kind === 'bar' ? null : readSpan(state.zoom, readX, 'zoom', sink);
  const clamp = (value: number) => Math.max(xFull[0], Math.min(value, xFull[1]));
  return { xFull, xDomain: zoom ? [clamp(zoom[0]), clamp(zoom[1])] : xFull };
}

function yExtent(
  data: Span, references: readonly ResolvedReference[], state: AlignedViewState | ScatterViewState,
  scale: CartesianState['valueScale'], field: string | undefined, sink: DiagnosticSink,
): Span {
  const positions = references.flatMap(r => r.axis === 'y' ? [r.from, r.to] : []);
  if (state.valueDomain && !state.valueDomain.every(Number.isFinite)) {
    report(sink, 'AX103', 'none', { field: 'y.domain' });
  }
  const { domain, widenedToZero } = valueDomain({
    min: data[0], max: data[1], includeZero: state.kind === 'bar' || state.kind === 'area',
    authorDomain: state.valueDomain, valueScale: scale, references: positions,
  });
  if (widenedToZero) report(sink, 'AX110', 'none', { field });
  return domain;
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
  const xData: Span = frame.shape === 'aligned'
    ? [frame.x.values[0] ?? Infinity, frame.x.values[frame.length - 1] ?? -Infinity]
    : scatterX(frame, sink);
  const spans = xExtents(xData, column, readX, state, compact, sink);
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
    const yDomain = keepSpan(yExtent(data, references, state, state.valueScale, state.valueField, sink), old?.yDomain);
    if (sameShared && old?.visiblePoints === visiblePoints && old.yDomain === yDomain) return old;
    const view: ScatterView = { ...shared, kind: 'scatter', frame, visiblePoints, yDomain };
    extrema.set(view, data);
    return view;
  }

  if (frame.shape !== 'aligned' || state.kind === 'scatter') throw new TypeError('Expected an aligned chart.');
  const old = prior?.kind === state.kind ? prior : undefined;
  const horizontal = state.kind === 'bar' && (state.horizontal ?? false);
  const visibleSlots = sameFrame && old?.xDomain === xDomain ? old.visibleSlots : rangeOf(frame.x.values, xDomain, old?.visibleSlots);
  const drawSlots = sameFrame && old?.visibleSlots === visibleSlots ? old.drawSlots : reuse(
    frame.series.map(({ slot }) => state.kind === 'bar' ? visibleSlots : drawRange(slot, visibleSlots)), old?.drawSlots, sameRange,
  );
  const stack = state.stacked && state.kind !== 'line'
    ? sameFrame && old?.visible === visible && old.stack ? old.stack : buildStack(frame, visible)
    : null;
  if (stack) reportStack(stack, sink);
  const data = oldExtrema && old?.visibleSlots === visibleSlots && old.stack === stack
    ? oldExtrema : alignedExtrema(frame, visible, visibleSlots, stack);
  const scale = state.valueScale === undefined ? alignedScale(frame, visible) : state.valueScale;
  const field = state.valueField ?? (frame.yLabel === null ? undefined : frame.series[0]?.field);
  const yDomain = keepSpan(yExtent(data, references, state, scale, field, sink), old?.yDomain);
  if (sameShared && old?.visibleSlots === visibleSlots && old.stack === stack && old.yDomain === yDomain && old.horizontal === horizontal) {
    return old;
  }
  const view: AlignedView = { ...shared, kind: state.kind, frame, horizontal, visibleSlots, drawSlots, stack, yDomain };
  extrema.set(view, data);
  return view;
}
