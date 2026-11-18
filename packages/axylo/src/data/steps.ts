import type { XColumn } from '../core/contracts';
import { instantToWall, utcFields, wallToInstant } from '../scale/zone';
import { DAY, HOUR, dailyDelta } from './x';

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
  return axis.kind === 'number' || axis.kind === 'date' || axis.kind === 'time' || axis.kind === 'wall';
}

export function stepMultiple(delta: number, step: number): number {
  const ratio = delta / step;
  const whole = Math.round(ratio);
  return whole >= 1 && Number.isFinite(whole) && Math.abs(ratio - whole) < 1e-9 ? whole : 0;
}

function numberGap(a: number, b: number, step: number, steps: number): number {
  const position = a + steps * step;
  if (Number.isInteger(a) && Number.isInteger(step)) return position;
  const noise = Math.min(step * 1e-9, 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)));
  // Round at the precision of the input positions, since subtraction can lose more digits than the step has.
  const factor = 10 ** Math.floor(-Math.log10(noise));
  const units = Math.round(position * factor);
  const rounded = units === 0 ? 0 : units / factor;
  if (Number.isSafeInteger(units) && Math.abs(position - rounded) <= noise) return rounded;
  return position;
}

export function gapPosition(axis: Axis, a: number, b: number, step: number, steps: number, span: number): number {
  if (axis.kind === 'number') return numberGap(a, b, step, steps);
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

export function snapGap(
  gap: number, a: number, b: number, step: number, count: number, at: (index: number) => number,
): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (at(mid) < gap) lo = mid + 1;
    else hi = mid;
  }
  const before = lo ? at(lo - 1) : -Infinity;
  const after = lo < count ? at(lo) : Infinity;
  const nearest = gap - before < after - gap ? before : after;
  const roundingError = 4 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(gap - nearest) <= Math.min(roundingError, step / 4) ? nearest : gap;
}

export function tooSparse(gaps: number, observations: number): boolean {
  return gaps > 1000 && gaps > 2 * observations;
}

export function inferGaps(
  axis: Axis, count: number, xAt: (i: number) => number,
  snap: (gap: number, a: number, b: number, step: number) => number,
  sparse?: (gaps: number) => void,
): Float64Array | null {
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
  if (tooSparse(gaps, count)) {
    sparse?.(gaps);
    return null;
  }

  const positions = new Float64Array(gaps);
  let next = 0;
  a = xAt(0);
  for (let i = 1; i < count; i++) {
    const b = xAt(i);
    const multiple = stepMultiple(stepDelta(axis, a, b), min);
    for (let j = 1; j < multiple; j++) {
      const gap = gapPosition(axis, a, b, min, j, multiple);
      positions[next++] = axis.kind === 'number' ? snap(gap, a, b, min) : gap;
    }
    a = b;
  }
  return positions;
}

export function calendarIntervals(a: number, b: number, zone: string): number {
  const delta = b - a;
  const utc = delta % DAY === 0 ? 1 : 0;
  if (zone === 'UTC' || delta < DAY - HOUR || Math.abs(delta - Math.round(delta / DAY) * DAY) > HOUR) return utc;
  return (instantToWall(zone, b) - instantToWall(zone, a)) % DAY === 0 ? utc | 2 : utc;
}
