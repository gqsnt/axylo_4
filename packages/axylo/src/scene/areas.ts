import {
  SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE, type AlignedView, type AreaMark, type IndexRange, type PathMark, type PointMark, type StackView,
} from '../core/contracts';
import { buildPoints, simplifyArea, simplifyLine, type AreaBoundary, type JoinedRuns, type LineInput } from '../simplify';
import { seriesPaint, token } from './geometry';
import { addLine, type Drawing } from './lines';

export function addArea(
  input: LineInput & Drawing, view: AlignedView, series: number, compact: boolean,
  areas: AreaMark[], paths: PathMark[], points: PointMark[],
): void {
  let geometry: Pick<AreaMark, 'upper' | 'lower' | 'runs'>;
  let selection: JoinedRuns;
  if (input.y instanceof Float64Array) {
    const area = simplifyArea({ ...input, upper: input.y, lower: 0 });
    const { upper, lower, runs } = area;
    geometry = { upper, lower, runs };
    selection = area.upperBoundary.selection;
  } else {
    // The area helper takes Float64Array. A constant lower edge can share the upper selection
    // instead of widening a borrowed Float32Array of values.
    selection = simplifyLine(input);
    const { indexes, breaks } = selection;
    const runs = new Uint32Array(indexes.length ? (breaks.length + 1) * 4 : 0);
    let start = 0;
    for (let i = 0; i < runs.length; i += 4) {
      const end = breaks[i / 4] ?? indexes.length;
      runs[i] = runs[i + 2] = start;
      runs[i + 1] = runs[i + 3] = end - start;
      start = end;
    }
    geometry = { upper: buildPoints(indexes, input), lower: buildPoints(indexes, { ...input, y: 0 }), runs };
  }
  areas.push({ type: 'area', series, ...geometry, fill: seriesPaint(series), opacity: 0.25 });
  addLine(input, view, series, view.visibleSlots, compact, paths, points, selection);
}

function boundaryIndex(boundary: AreaBoundary, slot: number): number {
  const { indexes } = boundary.selection;
  let start = 0;
  let end = indexes.length;
  while (start < end) {
    const middle = start + Math.floor((end - start) / 2);
    if (indexes[middle]! < slot) start = middle + 1;
    else end = middle;
  }
  return start;
}

function addRun(
  runs: number[], upper: AreaBoundary, lower: AreaBoundary, range: IndexRange,
  upperOffset: number, lowerOffset: number,
): void {
  if (upper === lower) return;
  const upperStart = boundaryIndex(upper, range.start);
  const upperCount = boundaryIndex(upper, range.end) - upperStart;
  const lowerStart = boundaryIndex(lower, range.start);
  const lowerCount = boundaryIndex(lower, range.end) - lowerStart;
  if (upperCount >= 2 && lowerCount >= 2) {
    runs.push(upperStart + upperOffset, upperCount, lowerStart + lowerOffset, lowerCount);
  }
}

function packEdges(positive: AreaBoundary | null, negative: AreaBoundary | null): Float32Array {
  if (!positive) return negative!.xy;
  if (!negative) return positive.xy;
  const xy = new Float32Array(positive.xy.length + negative.xy.length);
  xy.set(positive.xy);
  xy.set(negative.xy, positive.xy.length);
  return xy;
}

function addSeam(
  paths: PathMark[], edge: AreaBoundary, range: IndexRange, series: number, width: number,
  below: (slot: number) => boolean, above: (slot: number) => boolean,
  changed: (slot: number) => boolean,
): void {
  const start = boundaryIndex(edge, range.start);
  const end = boundaryIndex(edge, range.end);
  if (end - start < 2) return;
  const { indexes } = edge.selection;
  let xy: Float32Array | undefined;
  let count = 0;
  let continuing = false;
  for (let i = start + 1; i < end; i++) {
    const a = indexes[i - 1]!;
    const b = indexes[i]!;
    if (!(changed(a) || changed(b)) || !(below(a) || below(b)) || !(above(a) || above(b))) {
      continuing = false;
      continue;
    }
    xy ??= new Float32Array(4 * (end - start));
    if (!continuing) {
      if (count) {
        xy[count++] = NaN;
        xy[count++] = NaN;
      }
      xy[count++] = edge.xy[2 * i - 2]!;
      xy[count++] = edge.xy[2 * i - 1]!;
    }
    xy[count++] = edge.xy[2 * i]!;
    xy[count++] = edge.xy[2 * i + 1]!;
    continuing = true;
  }
  if (xy) paths.push({
    type: 'path', series, xy: xy.subarray(0, count), stroke: token('background'), strokeWidth: width,
    dash: { normal: null, contrast: null },
  });
}

function extendBoundary(
  input: Drawing & { range: IndexRange; slot: Uint8Array }, lower: AreaBoundary | null,
  values: Float64Array, base: number, end: number,
): AreaBoundary | null {
  if (!lower) return null;
  const upper = values.subarray(base, end);
  if (upper.every((value, i) => value === lower.values[i])) return lower;
  return simplifyArea({ ...input, upper, lower }).upperBoundary;
}

export function addStackedAreas(
  input: Drawing, view: AlignedView, stack: StackView, compact: boolean,
  areas: AreaMark[], seams: PathMark[], paths: PathMark[], points: PointMark[],
): void {
  if (!stack.order.length) return;
  let start = view.visibleSlots.start;
  let end = view.visibleSlots.end;
  for (const series of stack.order) {
    start = Math.min(start, view.drawSlots[series]!.start);
    end = Math.max(end, view.drawSlots[series]!.end);
  }
  const size = end - start;
  const source = { ...input, x: input.x.subarray(start, end) };
  const range = { start: 0, end: size };
  // A missing stack component pinches to the preceding edge. Use a common set of x slots
  // for the fills so both bands use the same edge, while each stroke retains its own gaps.
  const fillInput = { ...source, range, slot: new Uint8Array(size) };
  const zero = simplifyArea({ ...fillInput, upper: new Float64Array(size), lower: 0 }).upperBoundary;
  const positiveTotal = stack.positive.at(-1)!.subarray(start, end);
  const negativeTotal = stack.negative.at(-1)!.subarray(start, end);
  let positive = positiveTotal.some(value => value > 0) ? zero : null;
  let negative = negativeTotal.some(value => value < 0) ? zero : null;
  let lower = positive || negative ? packEdges(positive, negative) : zero.xy;

  if (positive && negative) {
    addSeam(seams, zero, range, stack.order[0]!, 2, i => negativeTotal[i]! < 0, i => positiveTotal[i]! > 0, () => true);
  }

  for (let k = 0; k < stack.order.length; k++) {
    const series = stack.order[k]!;
    const { y, slot } = view.frame.series[series]!;
    const draw = view.drawSlots[series]!;
    const local = { start: draw.start - start, end: draw.end - start };
    const pos = extendBoundary(fillInput, positive, stack.positive[k]!, start, end);
    const neg = extendBoundary(fillInput, negative, stack.negative[k]!, start, end);
    const upper = pos === positive && neg === negative ? lower : packEdges(pos, neg);
    const runs: number[] = [];
    if (pos && positive) {
      addRun(runs, pos, positive, local, 0, 0);
      if (pos !== positive) addSeam(seams, pos, local, series, 4,
        i => pos.values[i]! > 0, i => pos.values[i]! < positiveTotal[i]!,
        i => pos.values[i] !== positive!.values[i]);
    }
    if (neg && negative) {
      addRun(runs, neg, negative, local, (pos?.xy.length ?? 0) / 2, (positive?.xy.length ?? 0) / 2);
      if (neg !== negative) addSeam(seams, neg, local, series, 4,
        i => neg.values[i]! < 0, i => neg.values[i]! > negativeTotal[i]!,
        i => neg.values[i] !== negative!.values[i]);
    }
    areas.push({ type: 'area', series, upper, lower, runs: Uint32Array.from(runs), fill: seriesPaint(series), opacity: 0.8 });
    positive = pos;
    negative = neg;
    lower = upper;

    const positiveLine = stack.positive[k]!;
    const negativeLine = stack.negative[k]!;
    const length = draw.end - draw.start;
    let hasNegative = false;
    let hasNonNegative = false;
    for (let i = draw.start; i < draw.end && !(hasNegative && hasNonNegative); i++) {
      if (y[i]! < 0) hasNegative = true;
      else if (y[i]! >= 0) hasNonNegative = true;
    }
    const line = hasNegative && hasNonNegative
      ? Float64Array.from(y.subarray(draw.start, draw.end), (value, i) =>
        (value < 0 ? negativeLine : positiveLine)[draw.start + i]!)
      : (hasNegative ? negativeLine : positiveLine).subarray(draw.start, draw.end);
    // The line follows its band (F10): a slot the series has no row for is a missing component in a stack,
    // so the line is not joined across it as it would be outside one (F5). Outside the view, only a value next
    // to a value inside it is drawn, as the segment that reaches the edge.
    const { start: first, end: after } = view.visibleSlots;
    addLine({
      ...input, x: input.x.subarray(draw.start, draw.end), y: line,
      slot: slot.subarray(draw.start, draw.end).map((state, i) => {
        const at = draw.start + i;
        const joins = at >= first && at < after || at === first - 1 && slot[first] === SLOT_VALUE || at === after && slot[after - 1] === SLOT_VALUE;
        return state === SLOT_NO_ROW || !joins ? SLOT_NULL : state;
      }),
      range: { start: 0, end: length },
    }, view, series, {
      start: view.visibleSlots.start - draw.start, end: view.visibleSlots.end - draw.start,
    }, compact, paths, points);
  }
}
