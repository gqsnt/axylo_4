import type { XColumn } from '../core/contracts';
import { instantToWall, utcFields, wallToInstant } from '../scale/zone';
import { DAY, dailyDelta } from './x';

type Axis = Pick<XColumn, 'kind' | 'dateUnit' | 'timeZone'>;

export function stepDelta(axis: Axis, a: number, b: number): number {
  if (axis.kind === 'time') return dailyDelta(b - a);
  if (axis.kind !== 'date') return b - a;
  if (axis.dateUnit === 'day') return (b - a) / DAY;
  const from = new Date(a);
  const to = new Date(b);
  const years = to.getUTCFullYear() - from.getUTCFullYear();
  return axis.dateUnit === 'year' ? years : 12 * years + to.getUTCMonth() - from.getUTCMonth();
}

export function supportsSteps(axis: Axis): boolean {
  return axis.kind === 'number' || axis.kind === 'date' || axis.kind === 'time';
}

export function stepMultiple(delta: number, step: number): number {
  const ratio = delta / step;
  const whole = Math.round(ratio);
  return whole >= 1 && Number.isSafeInteger(whole) && Math.abs(ratio - whole) < 1e-9 ? whole : 0;
}

export function gapPosition(axis: Axis, a: number, b: number, step: number, steps: number): number {
  if (axis.kind === 'date') {
    if (axis.dateUnit === 'day') return a + steps * step * DAY;
    const from = new Date(a);
    return axis.dateUnit === 'year'
      ? utcFields(from.getUTCFullYear() + steps * step, 0, 1)
      : utcFields(from.getUTCFullYear(), from.getUTCMonth() + steps * step, 1);
  }
  if (axis.kind === 'time' && axis.timeZone !== null && step % DAY === 0 && axis.timeZone !== 'UTC') {
    const wall = instantToWall(axis.timeZone, a);
    if (instantToWall(axis.timeZone, b) - wall === dailyDelta(b - a)) {
      return wallToInstant(axis.timeZone, wall + steps * step);
    }
  }
  return a + steps * step;
}

export function inferGaps(axis: Axis, count: number, xAt: (i: number) => number): Float64Array | null {
  if (!supportsSteps(axis) || count < 3) return null;
  let a = xAt(0);
  let min = Infinity;
  let max = 0;
  for (let i = 1; i < count; i++) {
    const b = xAt(i);
    const delta = stepDelta(axis, a, b);
    if (delta < min) min = delta;
    if (delta > max) max = delta;
    a = b;
  }
  if (stepMultiple(max, min) === 1 || !(min > 0)) return null;
  let gaps = 0;
  let consecutive = 0;
  a = xAt(0);
  for (let i = 1; i < count; i++) {
    const b = xAt(i);
    const multiple = stepMultiple(stepDelta(axis, a, b), min);
    if (!multiple) return null;
    if (multiple === 1) consecutive++;
    gaps += multiple - 1;
    a = b;
  }
  if (consecutive * 2 < count - 1 || !gaps) return null;

  const positions = new Float64Array(gaps);
  let next = 0;
  a = xAt(0);
  for (let i = 1; i < count; i++) {
    const b = xAt(i);
    const multiple = stepMultiple(stepDelta(axis, a, b), min);
    for (let j = 1; j < multiple; j++) positions[next++] = gapPosition(axis, a, b, min, j);
    a = b;
  }
  return positions;
}
