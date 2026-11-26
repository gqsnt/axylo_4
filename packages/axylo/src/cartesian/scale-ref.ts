/**
 * Single projection authority for multi-axis Cartesian charts (RFC C4.1 §3).
 * Scene building, pointer hit-testing, keyboard focus rings, overlays, and references all resolve
 * a series's value scale exclusively through `axisScaleOf`.
 */
import type { ContinuousScale, Projection } from '../core/contracts';

export function axisScaleOf(projection: Projection, axisIndex = 0): ContinuousScale {
  if (projection.kind === 'ring') throw new TypeError('Ring projection has no y-axis.');
  const fallback = projection.kind === 'xy' ? projection.y : projection.value;
  return projection.yAxes?.[axisIndex] ?? fallback;
}
