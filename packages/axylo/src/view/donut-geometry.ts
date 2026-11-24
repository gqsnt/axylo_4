import type { DonutSlice, Projection } from '../core/contracts';

// 2π and 2⁻²⁰ as literals, so the module does no work at import time.
const TURN = 6.283185307179586;
const PRECISION = 9.5367431640625e-7;
export const DONUT_GAP = 1;

export function donutGeometry(slices: readonly DonutSlice[], ring: Extract<Projection, { kind: 'ring' }>) {
  if (!(ring.r1 > 0 && ring.r1 > ring.r0)) return { drawn: [], angles: new Float32Array(0) };
  const drawn = slices.filter(slice => slice.angles !== null);
  const angles = new Float32Array(2 * drawn.length);
  if (drawn.length < 2) {
    if (drawn.length === 1) angles.set(drawn[0]!.angles!);
    return { drawn, angles };
  }

  const inner = Math.max(0, ring.r0);
  const mid = inner + (ring.r1 - inner) / 2;
  const gapAngle = 2 * Math.asin(Math.min(1, DONUT_GAP / (2 * mid)));
  // Keep one CSS pixel of fill at mid-radius after the renderer insets both sides.
  // Leave room for Float32 rounding and for the renderer's 1e-4-radian full-turn tolerance.
  const minimum = Math.max(gapAngle + 1 / mid, 1e-4) + PRECISION;
  const spans = drawn.map(slice => slice.angles![1] - slice.angles![0]);
  let sweep = TURN;
  let weight = TURN;
  let scale = 1;
  if (minimum * drawn.length < TURN) {
    // Fix the smallest slices first, then give the remaining sweep to the others in their original proportions.
    for (const span of spans.slice().sort((a, b) => a - b)) {
      if (span * scale >= minimum) break;
      sweep -= minimum;
      weight -= span;
      scale = sweep / weight;
    }
  }

  // Rounding the final Float32 edge down preserves the separator at twelve o'clock.
  const lastEdge = TURN - 2 ** -22;
  let start = 0;
  for (let i = 0; i < drawn.length; i++) {
    const end = scale === 1 ? drawn[i]!.angles![1] : start + Math.max(minimum, spans[i]! * scale);
    angles[2 * i] = start;
    start = i === drawn.length - 1 ? lastEdge : Math.min(end, lastEdge);
    angles[2 * i + 1] = start;
  }
  return { drawn, angles };
}
