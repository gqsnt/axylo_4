/**
 * Single projection authority for multi-axis Cartesian charts (RFC C4.1 §3).
 * Scene building, pointer hit-testing, keyboard focus rings, overlays, and references all resolve
 * a series's value scale exclusively through `axisScaleOf`.
 */
import type { ContinuousScale, Projection } from '../core/contracts';

export function axisScaleOf(projection: Projection, axisIndex = 0): ContinuousScale {
  // A Cartesian layout projects onto xy or bands (layout.ts); a ring, which has no value axis, never reaches here.
  const p = projection as Exclude<Projection, { kind: 'ring' }>;
  return p.yAxes?.[axisIndex] ?? (p.kind === 'xy' ? p.y : p.value);
}
