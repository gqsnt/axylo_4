import {
  SLOT_VALUE, type AlignedView, type AreaMark, type PathMark, type PointMark, type StackView,
} from '../core/contracts';
import { buildPath, buildPoints, simplifyArea, simplifyLine, stackIndexes, type JoinedRuns, type LineInput } from '../simplify';
import { interpolated, stackAreaRange } from '../view';
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

/** Each accepted interval belongs to this edge. A rejected interval lifts the pen. */
function segments(vertices: Uint32Array, accepts: (a: number, b: number) => boolean) {
  const indexes = new Uint32Array(vertices.length);
  const breaks = new Uint32Array(vertices.length >>> 1);
  let count = 0;
  let lifts = 0;
  let continuing = false;
  for (let j = 1; j < vertices.length; j++) {
    const a = vertices[j - 1]!;
    const b = vertices[j]!;
    if (accepts(a, b)) {
      if (!continuing) {
        if (count) breaks[lifts++] = count;
        indexes[count++] = a;
      }
      indexes[count++] = b;
      continuing = true;
    } else continuing = false;
  }
  return { indexes: indexes.subarray(0, count), breaks: breaks.subarray(0, lifts) };
}

function addStackLine(
  input: Drawing, view: AlignedView, series: number, positive: Float64Array, negative: Float64Array,
  vertices: Uint32Array, start: number, compact: boolean, paths: PathMark[], points: PointMark[],
): void {
  const component = view.frame.series[series]!;
  const end = start + input.x.length;
  const slot = component.slot.subarray(start, end);
  const draw = view.drawSlots[series]!;
  const range = { start: draw.start - start, end: draw.end - start };
  const visible = { start: view.visibleSlots.start - start, end: view.visibleSlots.end - start };
  const y = component.y.subarray(start, end);
  let values = positive;
  if (y.some(value => value < 0)) {
    values = y.some(value => value >= 0)
      ? Float64Array.from(y, (value, i) => (value < 0 ? negative : positive)[i]!)
      : negative;
  }
  const selection = segments(vertices, (a, b) =>
    a >= range.start && b < range.end && slot[a] === SLOT_VALUE && slot[b] === SLOT_VALUE);
  const isolated = vertices.filter(i => i >= visible.start && i < visible.end && slot[i] === SLOT_VALUE &&
    (i === range.start || slot[i - 1] !== SLOT_VALUE) && (i + 1 === range.end || slot[i + 1] !== SLOT_VALUE));
  addLine({ ...input, range, slot, y: values },
    view, series, visible, compact, paths, points, { ...selection, isolated });
}

export function addStackedAreas(
  input: Drawing, view: AlignedView, stack: StackView, compact: boolean,
  areas: AreaMark[], seams: PathMark[], paths: PathMark[], points: PointMark[],
): void {
  if (!stack.order.length) return;
  const range = stackAreaRange(view.frame, view.visibleSlots, view.xDomain);
  const { start, end } = range;
  const vertices = stackIndexes(input, view.frame, stack, range);
  const source = { ...input, x: input.x.subarray(start, end) };
  const positive = stack.positive.at(-1)!.subarray(start, end);
  const negative = stack.negative.at(-1)!.subarray(start, end);
  const hasPositive = positive.some(value => value > 0);
  const hasNegative = negative.some(value => value < 0);
  // Clip shared edges once from their source values, including when both cuts use the same interval.
  function clipEnds(xy: Float32Array, indexes: Uint32Array, y: Float64Array | 0) {
    const last = source.x.length - 1;
    const clip = (offset: number, edge: number, left: number) => {
      xy[offset] = source.mapX(edge);
      xy[offset + 1] = source.mapY(y === 0 ? 0 : interpolated(source.x, edge, left, left + 1, y));
    };
    if (start < view.visibleSlots.start && indexes[0] === 0) clip(0, view.xDomain[0], 0);
    if (end > view.visibleSlots.end && indexes.at(-1) === last) clip(xy.length - 2, view.xDomain[1], last - 1);
  }

  function addSeam(y: Float64Array | 0, series: number, width: number, accepts: (a: number, b: number) => boolean) {
    const { indexes, breaks } = segments(vertices, accepts);
    if (!indexes.length) return;
    const xy = buildPath(indexes, breaks, { ...source, y });
    clipEnds(xy, indexes, y);
    seams.push({
      type: 'path', series, xy, stroke: token('background'), strokeWidth: width, dash: { normal: null, contrast: null },
    });
  }

  const zero = buildPoints(vertices, { ...source, y: 0 });
  clipEnds(zero, vertices, 0);
  let lower = zero;
  if (hasPositive && hasNegative) {
    lower = new Float32Array(zero.length * 2);
    lower.set(zero);
    lower.set(zero, zero.length);
    addSeam(0, stack.order[0]!, 2,
      (a, b) => (negative[a]! < 0 || negative[b]! < 0) && (positive[a]! > 0 || positive[b]! > 0));
  }
  for (let k = 0; k < stack.order.length; k++) {
    const series = stack.order[k]!;
    const runs: number[] = [];
    let upper = lower;
    for (const below of [false, true]) {
      const edges = below ? stack.negative : stack.positive;
      const values = edges[k]!.subarray(start, end);
      if (!(below ? hasNegative : hasPositive) || vertices.length < 2) continue;
      const base = edges[k - 1]?.subarray(start, end);
      const changed = (i: number) => values[i] !== (base?.[i] ?? 0);
      if (!vertices.some(changed)) continue;
      const offset = below && hasPositive ? vertices.length : 0;
      if (upper === lower) upper = lower.slice();
      for (let j = 0; j < vertices.length; j++) upper[2 * (offset + j) + 1] = source.mapY(values[vertices[j]!]!);
      clipEnds(upper.subarray(offset * 2, (offset + vertices.length) * 2), vertices, values);
      runs.push(offset, vertices.length, offset, vertices.length);
      const total = below ? negative : positive;
      addSeam(values, series, 4, (a, b) =>
        (changed(a) || changed(b)) && (values[a] !== 0 || values[b] !== 0) &&
        (values[a] !== total[a] || values[b] !== total[b]));
    }
    areas.push({ type: 'area', series, upper, lower, runs: Uint32Array.from(runs), fill: seriesPaint(series), opacity: 0.8 });
    lower = upper;
    addStackLine(source, view, series, stack.positive[k]!.subarray(start, end), stack.negative[k]!.subarray(start, end),
      vertices, start, compact, paths, points);
  }
}
