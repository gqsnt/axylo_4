import { barHalfWidth } from '../view/bar-bands';
import type { AlignedFrame, ContinuousScale, Paint, PaintToken, Projection, Rect, ResolvedReference, RuleMark, XScale } from '../core/contracts';

/** 2¹²⁰, as a literal so the module does no work at import time. */
export const COORDINATE_LIMIT = 1.329227995784916e+36;

export const token = (name: PaintToken): Paint => ({ kind: 'token', name });
export const seriesPaint = (index: number): Paint => ({ kind: 'series', index });

export function position(scale: XScale, value: number): number {
  if (scale.type === 'band') return scale.center(value);
  const pixel = scale.map(value);
  // Far outside an author domain, extrapolation can overflow the packed Float32 geometry.
  if (Number.isNaN(pixel)) {
    const [start, end] = scale.range;
    if (start === end) return start;
    return (value < scale.domain[0]) === (start < end) ? -COORDINATE_LIMIT : COORDINATE_LIMIT;
  }
  return clamp(pixel, -COORDINATE_LIMIT, COORDINATE_LIMIT);
}

export interface AffineProjection {
  readonly slope: number;
  readonly offset: number;
  readonly exact?: {
    readonly scale: ContinuousScale;
    readonly start: number;
    readonly end: number;
    readonly origin: number;
    readonly edge: number;
    readonly span: number;
    readonly extent: number;
    readonly bounded: boolean;
  };
}

export function exactProjection(scale: XScale, bounded = false): AffineProjection['exact'] {
  if (scale.type !== 'linear' && scale.type !== 'time') return;
  const [start, end] = scale.domain;
  const [origin, edge] = scale.range;
  const span = end - start;
  const extent = edge - origin;
  if (!span || !extent || !Number.isFinite(span) || !Number.isFinite(extent)) return;
  if (Math.max(Math.abs(origin), Math.abs(edge), Math.abs(origin + extent)) > COORDINATE_LIMIT) return;
  return { scale, start, end, origin, edge, span, extent, bounded };
}

export function affineProjection(scale: XScale, bounds?: readonly [number, number]): AffineProjection | undefined {
  const exact = exactProjection(scale, bounds !== undefined);
  if (!exact) return;
  const { start, end, origin, edge, span, extent } = exact;
  const slope = extent / span;
  const offset = origin - start * slope;
  if (!slope || !Number.isFinite(slope) || !Number.isFinite(offset)) return;
  // The sorted x column's endpoints also bound any samples used to extend a run past the viewport.
  const fits = (value: number) => Math.abs((value - start) / span * extent + origin) <= COORDINATE_LIMIT &&
    Math.abs(slope * value + offset) <= COORDINATE_LIMIT;
  if (!fits(start) || !fits(end) || (bounds && (!fits(bounds[0]) || !fits(bounds[1])))) return;
  return { slope, offset, exact };
}

export function affinePosition(affine: AffineProjection, value: number): number {
  const { exact } = affine;
  if (!exact) return affine.slope * value + affine.offset;
  const { start, end, origin, edge, span, extent, bounded } = exact;
  if (value === start) return origin;
  if (value === end) return edge;
  if (!bounded && !(span > 0 ? value > start && value < end : value > end && value < start)) {
    return position(exact.scale, value);
  }
  // Reassociation can move a sample across a device column or a marker spacing threshold.
  return origin + (value - start) / span * extent;
}

function writeBin(out: Float64Array, offset: number, left: number, right: number): void {
  out[offset] = left;
  out[offset + 1] = right - (right - left > 2 ? 1 : 0);
}

export function projectBands(frame: AlignedFrame, scale: XScale, start: number, end: number, spanPixels: number): Float64Array {
  const bounds = new Float64Array((end - start) * 2);
  const edges = frame.binEdges;
  if (edges?.length === frame.length + 1 && start < end) {
    // Adjacent bins share an edge even when the viewport starts inside a bin.
    let left = position(scale, edges[start]!);
    for (let i = start, offset = 0; i < end; i++, offset += 2) {
      const right = position(scale, edges[i + 1]!);
      writeBin(bounds, offset, left, right);
      left = right;
    }
  } else {
    for (let i = start, offset = 0; i < end; i++, offset += 2) projectBand(frame, scale, i, spanPixels, bounds, offset);
  }
  return bounds;
}

/** The mark and its focus outline use the same projected band, including the inter-bin separator. */
export function projectBand(frame: AlignedFrame, scale: XScale, i: number, spanPixels: number, out: Float64Array, offset: number): void {
  const edges = frame.binEdges;
  if (edges?.length === frame.length + 1) {
    const left = position(scale, edges[i]!);
    const right = position(scale, edges[i + 1]!);
    writeBin(out, offset, left, right);
    return;
  }
  const values = frame.x.values;
  const center = position(scale, values[i]!);
  let half: number;
  if (scale.type === 'band') half = scale.bandwidth / 2;
  else {
    const [lo, hi] = scale.domain;
    const width = barHalfWidth(values, i);
    const pixels = Math.abs(scale.range[1] - scale.range[0]);
    const proportion = Number.isFinite(hi - lo) ? width / (hi - lo) : (width / 2) / (hi / 2 - lo / 2);
    half = lo === hi ? spanPixels * 0.4 : pixels === 0 ? 0 : Math.min(proportion * pixels, COORDINATE_LIMIT);
  }
  out[offset] = center - half;
  out[offset + 1] = center + half;
}

export function clamp(value: number, from: number, to: number): number {
  return Math.max(from, Math.min(to, value));
}

const EPSILON = 1e-7; // Same pixel tolerance as layout/labels.

export function boundaryPixel(pixel: number, start: number, end: number): number | null {
  return pixel >= start - EPSILON && pixel <= end + EPSILON ? clamp(pixel, start, end) : null;
}

/** Use the same visible edges for reference marks and their labels. */
export function projectReference(
  reference: ResolvedReference, projection: Exclude<Projection, { kind: 'ring' }>, plot: Rect,
  xDomain?: readonly [number, number],
) {
  const { axis, from, to } = reference;
  const xAxis = axis === 'x';
  const vertical = xAxis !== (projection.kind === 'bands' && projection.horizontal);
  const scale = projection.kind === 'xy' ? projection[axis] : xAxis ? projection.band : projection.value;
  const start = vertical ? plot.x : plot.y;
  const end = start + (vertical ? plot.width : plot.height);
  const domain: readonly [number, number] = xAxis && xDomain ? xDomain : scale.type === 'band' ? [0, scale.count - 1] : scale.domain;
  if (to < domain[0] || from > domain[1]) return null;
  const a = position(scale, Math.max(from, domain[0]));
  if (from === to) {
    const pixel = boundaryPixel(a, start, end);
    return pixel === null ? null : { vertical, low: pixel, high: pixel };
  }
  const b = position(scale, Math.min(to, domain[1]));
  const low = clamp(Math.min(a, b), start, end);
  const high = clamp(Math.max(a, b), start, end);
  return low < high ? { vertical, low, high } : null;
}

export function rule(
  role: RuleMark['role'], paint: Paint, x1: number, y1: number, x2: number, y2: number,
): RuleMark {
  return { type: 'rule', role, x1, y1, x2, y2, stroke: paint, strokeWidth: 1, dash: null };
}
