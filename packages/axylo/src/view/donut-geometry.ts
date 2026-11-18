import type { DonutSlice, Projection } from '../core/contracts';

// 2π and 2⁻²⁰ as literals, so the module does no work at import time.
const TURN = 6.283185307179586;
const PRECISION = 9.5367431640625e-7;
export const DONUT_GAP = 1;

export function donutGeometry(slices: readonly DonutSlice[], ring: Extract<Projection, { kind: 'ring' }>) {
  const drawn = slices.filter(slice => slice.angles !== null);
  const angles = new Float32Array(2 * drawn.length);
  if (drawn.length < 2) {
    if (drawn.length === 1) angles.set(drawn[0]!.angles!);
    return { drawn, angles };
  }

  const mid = ring.r0 + (ring.r1 - ring.r0) / 2;
  const gapAngle = 2 * Math.asin(DONUT_GAP / (2 * mid));
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

  let start = 0;
  for (let i = 0; i < drawn.length; i++) {
    const end = scale === 1 ? drawn[i]!.angles![1] : start + Math.max(minimum, spans[i]! * scale);
    angles[2 * i] = start;
    angles[2 * i + 1] = end;
    start = end;
  }
  // A Float32 rounded above a full turn would narrow the separator at twelve o'clock.
  angles[angles.length - 1] = TURN - 2 ** -22;
  return { drawn, angles };
}
