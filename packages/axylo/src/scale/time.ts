/**
 * Time axes for the three temporal kinds of the contracts:
 *  'time' – instants, ticks on calendar boundaries of `timeZone`;
 *  'date' – calendar dates stored at 00:00 UTC, ticks on UTC calendar boundaries, never finer than a day
 *           (or than the date unit when it is month or year);
 *  'wall' – date-times as written, stored as if UTC, ticks on UTC calendar boundaries.
 */
import type { ContinuousScale, Tick, TickCandidates } from '../core/contracts';
import { continuous, pushCandidate } from './linear';
import { MAX_TICKS } from './nice';
import { TIME, instantToWall, utcFields, wallToInstant, wallToInstants } from './zone';
import { dateTimeFormat } from '../format/intl';

const { MINUTE, HOUR, DAY } = TIME;
const SECOND = 1000;

export function timeScale(domain: readonly [number, number], range: readonly [number, number]): ContinuousScale {
  return continuous('time', domain, range);
}

export type TimeUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

interface Interval {
  readonly unit: TimeUnit;
  readonly n: number;
  /** Typical length in ms, for estimating tick counts before generating. */
  readonly approx: number;
}

const UNIT_MS: Record<TimeUnit, number> = {
  millisecond: 1,
  second: SECOND,
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  week: 7 * DAY,
  month: 30.436875 * DAY,
  year: 365.2425 * DAY,
};

function iv(unit: TimeUnit, n: number): Interval {
  return { unit, n, approx: n * UNIT_MS[unit] };
}

/** Calendar intervals finer than a year, finest first. Multiples divide the next unit, so ticks stay aligned. */
const SUB_YEAR: readonly Interval[] = [
  iv('millisecond', 1), iv('millisecond', 2), iv('millisecond', 5), iv('millisecond', 10), iv('millisecond', 20),
  iv('millisecond', 50), iv('millisecond', 100), iv('millisecond', 200), iv('millisecond', 500),
  iv('second', 1), iv('second', 2), iv('second', 5), iv('second', 10), iv('second', 15), iv('second', 30),
  iv('minute', 1), iv('minute', 2), iv('minute', 5), iv('minute', 10), iv('minute', 15), iv('minute', 30),
  iv('hour', 1), iv('hour', 2), iv('hour', 3), iv('hour', 6), iv('hour', 12),
  iv('day', 1), iv('day', 2),
  iv('week', 1),
  iv('month', 1), iv('month', 2), iv('month', 3), iv('month', 6),
];

const UNIT_ORDER: readonly TimeUnit[] = ['millisecond', 'second', 'minute', 'hour', 'day', 'week', 'month', 'year'];

export interface TimeTickOptions {
  readonly kind: 'time' | 'date' | 'wall';
  /** For 'time': the IANA zone of the axis. Ignored otherwise (always UTC). */
  readonly timeZone?: string | null;
  readonly locale: string;
  /** For 'date': the coarsest unit every value falls on. */
  readonly dateUnit?: 'day' | 'month' | 'year' | null;
  /** Replaces the built-in context-aware labels (the author's `tickFormat`). Where it throws, the built-in label is used. */
  readonly label?: ((position: number) => string) | null;
}

/** The zone ticks are computed and labeled in. */
function axisZone(options: TimeTickOptions): string {
  return options.kind === 'time' && options.timeZone ? options.timeZone : 'UTC';
}

/** The finest unit allowed on this axis. */
function finestUnit(options: TimeTickOptions): TimeUnit {
  if (options.kind !== 'date') return 'millisecond';
  if (options.dateUnit === 'year') return 'year';
  if (options.dateUnit === 'month') return 'month';
  return 'day';
}

/**
 * Calendar-aware tick sets, densest first. Positions are instants (epoch ms) on natural boundaries of the
 * axis zone: day and coarser ticks fall on local midnight, so a "day" may be 23 or 25 hours long.
 */
export function timeTickCandidates(domain: readonly [number, number], options: TimeTickOptions): TickCandidates {
  const lo = Math.min(domain[0], domain[1]);
  const hi = Math.max(domain[0], domain[1]);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [];
  const zone = axisZone(options);
  const finest = UNIT_ORDER.indexOf(finestUnit(options));
  const span = hi - lo;

  const sets: Tick[][] = [];
  const consider = (interval: Interval): boolean => {
    if (UNIT_ORDER.indexOf(interval.unit) < finest) return true;
    // Skip intervals that would obviously give far too many ticks, before paying for generation.
    if (span / interval.approx > MAX_TICKS + 2) return true;
    const values = boundaries(interval, lo, hi, zone, options.locale);
    if (values.length >= 1 && values.length <= MAX_TICKS) pushCandidate(sets, label(values, interval.unit, zone, options));
    return values.length > 1;
  };

  for (const interval of SUB_YEAR) if (!consider(interval)) return finish(sets, lo, zone, options);
  // Years: 1, 2, 5, 10, 20, 50, … until a single tick or none remains.
  for (let k = 0; k < 9; k++) {
    for (const m of [1, 2, 5]) {
      if (!consider(iv('year', m * 10 ** k))) return finish(sets, lo, zone, options);
    }
  }
  return finish(sets, lo, zone, options);
}

/** A domain too short to hold any boundary still gets one labeled tick at its start. */
function finish(sets: Tick[][], lo: number, zone: string, options: TimeTickOptions): TickCandidates {
  if (sets.length > 0) return sets;
  let unit = finestUnit(options);
  if (unit === 'millisecond') {
    // Show the clock only as precisely as the instant needs.
    const wall = instantToWall(zone, lo);
    const ms = ((wall % DAY) + DAY) % DAY;
    unit = ms % SECOND !== 0 ? 'millisecond' : ms % MINUTE !== 0 ? 'second' : 'minute';
  }
  return [label([lo], unit, zone, options)];
}

// ───────────────────────────── boundaries ─────────────────────────────

function isFixed(unit: TimeUnit): boolean {
  return unit === 'millisecond' || unit === 'second' || unit === 'minute' || unit === 'hour';
}

/** Instants in [lo, hi] on the interval's boundaries in `zone`, ascending, without duplicates. */
function boundaries(interval: Interval, lo: number, hi: number, zone: string, locale: string): number[] {
  if (interval.unit === 'millisecond') {
    // Zone offsets are whole seconds, so millisecond boundaries are the same in every zone.
    const out: number[] = [];
    for (let t = Math.ceil(lo / interval.n) * interval.n; t <= hi; t += interval.n) out.push(t);
    return out;
  }
  // Wall time of an instant moves back by at most the size of a fold (two hours in any zone in use), so a
  // three-hour margin covers every boundary whose instant lies in [lo, hi].
  const wallLo = instantToWall(zone, lo) - 3 * HOUR;
  const wallHi = instantToWall(zone, hi) + 3 * HOUR;
  const walls = wallBoundaries(interval, wallLo, wallHi, locale);
  const out: number[] = [];
  const fixed = isFixed(interval.unit);
  for (const w of walls) {
    if (fixed) {
      // A clock time that happens twice (fold) is two ticks; one that never happens (gap) is none.
      for (const t of wallToInstants(zone, w)) if (t >= lo && t <= hi) out.push(t);
    } else {
      // Midnight inside a gap (zones that change at 00:00) moves to the first instant of that day.
      const t = wallToInstant(zone, w, 'compatible');
      if (t >= lo && t <= hi) out.push(t);
    }
  }
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || t !== out[i - 1]);
}

/** Wall values (local fields read as UTC) on the interval's boundaries in [wallLo, wallHi]. */
function wallBoundaries(interval: Interval, wallLo: number, wallHi: number, locale: string): number[] {
  const out: number[] = [];
  const { unit, n } = interval;
  if (isFixed(unit) || unit === 'day') {
    // n divides the next unit (60 s, 60 min, 24 h), so multiples of n·unit from the epoch fall on the
    // same clock values every day. Days count from 1970-01-01, which keeps 2-day ticks evenly spaced.
    const size = n * UNIT_MS[unit];
    for (let w = Math.ceil(wallLo / size) * size; w <= wallHi; w += size) out.push(w);
    return out;
  }
  if (unit === 'week') {
    const first = weekStart(locale);
    let day = Math.ceil(wallLo / DAY);
    // 1970-01-01 was a Thursday (weekday 4, Sunday = 0).
    while ((((day + 4) % 7) + 7) % 7 !== first) day++;
    for (let w = day * DAY; w <= wallHi; w += 7 * DAY) out.push(w);
    return out;
  }
  const start = new Date(wallLo);
  if (unit === 'month') {
    let y = start.getUTCFullYear();
    let m = start.getUTCMonth() - (start.getUTCMonth() % n);
    for (;;) {
      const w = utcFields(y, m, 1);
      if (w > wallHi) break;
      if (w >= wallLo) out.push(w);
      m += n;
      if (m >= 12) { y += 1; m -= 12; }
    }
    return out;
  }
  // year
  const y0 = start.getUTCFullYear();
  for (let y = y0 - (((y0 % n) + n) % n); ; y += n) {
    const w = utcFields(y, 0, 1);
    if (w > wallHi) break;
    if (w >= wallLo) out.push(w);
  }
  return out;
}

interface WeekInfoLocale { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }

/** First day of the week for the locale, Sunday = 0. Monday (ISO) when the engine cannot say. */
export function weekStart(locale: string): number {
  try {
    const l = new Intl.Locale(locale) as unknown as WeekInfoLocale;
    const info = typeof l.getWeekInfo === 'function' ? l.getWeekInfo() : l.weekInfo;
    if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7;
  } catch {
    // An invalid tag is reported by whoever resolved the locale; fall through to ISO.
  }
  return 1;
}

// ───────────────────────────── labels ─────────────────────────────

/** The author's label, or null when there is none or it failed (the failure is reported by the labeler's owner). */
function customLabel(custom: ((position: number) => string) | null | undefined, value: number): string | null {
  if (!custom) return null;
  try {
    return custom(value);
  } catch {
    return null;
  }
}

type Level = 'year' | 'month' | 'day' | 'minute' | 'second' | 'millisecond';

function levelOf(unit: TimeUnit): Level {
  switch (unit) {
    case 'year': return 'year';
    case 'month': return 'month';
    case 'week':
    case 'day': return 'day';
    case 'hour':
    case 'minute': return 'minute';
    case 'second': return 'second';
    default: return 'millisecond';
  }
}

/** Options for the short label, and for the label that adds the context (year, or date) it depends on. */
function labelOptions(level: Level): { short: Intl.DateTimeFormatOptions; context: Intl.DateTimeFormatOptions | null } {
  const clock: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  switch (level) {
    case 'year': return { short: { year: 'numeric' }, context: null };
    case 'month': return { short: { month: 'short' }, context: { month: 'short', year: 'numeric' } };
    case 'day': return { short: { month: 'short', day: 'numeric' }, context: { month: 'short', day: 'numeric', year: 'numeric' } };
    case 'minute': return { short: clock, context: { month: 'short', day: 'numeric', ...clock } };
    case 'second': {
      const o: Intl.DateTimeFormatOptions = { ...clock, second: '2-digit' };
      return { short: o, context: { month: 'short', day: 'numeric', ...o } };
    }
    default: {
      const o: Intl.DateTimeFormatOptions = { ...clock, second: '2-digit', fractionalSecondDigits: 3 };
      return { short: o, context: { month: 'short', day: 'numeric', ...o } };
    }
  }
}

/**
 * Labels a tick set. The context (year for month and day ticks, date for clock ticks) is written on the
 * first tick and wherever it changes, so every label is unambiguous with its left neighbours.
 */
function label(values: readonly number[], unit: TimeUnit, zone: string, options: TimeTickOptions): Tick[] {
  const level = levelOf(unit);
  const { short, context } = labelOptions(level);
  const ticks: Tick[] = [];
  const used: Intl.DateTimeFormatOptions[] = [];
  let previous = NaN;
  for (const value of values) {
    const wall = new Date(instantToWall(zone, value));
    // Year for calendar ticks, calendar day for clock ticks.
    const key = level === 'month' || level === 'day'
      ? wall.getUTCFullYear()
      : wall.getUTCFullYear() * 10000 + wall.getUTCMonth() * 100 + wall.getUTCDate();
    const fields = context !== null && key !== previous ? context : short;
    previous = key;
    used.push(fields);
    ticks.push({ value, label: customLabel(options.label, value) ?? dateTimeFormat(options.locale, { ...fields, timeZone: zone }).format(value) });
  }
  if (!options.label && zone !== 'UTC') {
    // In a fold the same clock time comes twice ("1:00 AM", "1:00 AM"); the zone abbreviation tells them apart.
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i]!.label !== ticks[i - 1]!.label) continue;
      for (const j of [i - 1, i]) {
        const named = dateTimeFormat(options.locale, { ...used[j], timeZoneName: 'short', timeZone: zone });
        ticks[j] = { value: ticks[j]!.value, label: named.format(ticks[j]!.value) };
      }
    }
  }
  return ticks;
}
