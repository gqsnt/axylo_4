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
import { MAX_DATE, firstInstantAtOrAfterWall, firstInstantWithOffset, instantToWall, utcFields, zoneOffset } from './zone';
import { dateTimeFormat } from '../format/intl';

// Literals rather than computed values throughout: the module does no work at import time, so a bundler
// can drop it where it is not used (the same values as scale/zone.ts's TIME).
const SECOND = 1000;
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/**
 * Upper bound on boundaries generated for one interval. Intervals are only generated when about
 * MAX_TICKS + 2 of them fit the domain, so this is never reached; it keeps every loop finite regardless.
 */
const MAX_BOUNDARIES = 1000;

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
  week: 604_800_000, // 7 days
  month: 2_629_746_000, // 30.436875 days
  year: 31_556_952_000, // 365.2425 days
};

function iv(unit: TimeUnit, n: number): Interval {
  return { unit, n, approx: n * UNIT_MS[unit] };
}

let subYear: readonly Interval[] | null = null;

/** Calendar intervals finer than a year, finest first. Multiples divide the next unit, so ticks stay aligned. */
const subYearIntervals = (): readonly Interval[] => subYear ??= [
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
  // Ticks only exist where a Date can represent the position.
  const lo = Math.max(Math.min(domain[0], domain[1]), -MAX_DATE);
  const hi = Math.min(Math.max(domain[0], domain[1]), MAX_DATE);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return [];
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
    // Go on while there is a tick: a coarser interval with as many ticks replaces the finer set, so a lone
    // tick ends up on the roundest boundary in the domain (midnight rather than 00:00:00.000).
    return values.length > 0;
  };

  for (const interval of subYearIntervals()) if (!consider(interval)) return finish(sets, lo, zone, options);
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
    // Bounded: callers only ask for intervals with a few ticks in the domain.
    for (let t = Math.ceil(lo / interval.n) * interval.n, k = 0; t <= hi && k < MAX_BOUNDARIES; t += interval.n, k++) out.push(t);
    return out;
  }
  if (isFixed(interval.unit)) return clockBoundaries(interval.n * UNIT_MS[interval.unit], lo, hi, zone);
  // Wall time of an instant moves back by at most the size of a fold (two hours in any zone in use), so a
  // three-hour margin covers every boundary whose instant lies in [lo, hi]. Day and coarser units have at
  // most one boundary in the margin, so it costs nothing.
  const wallLo = Math.max(instantToWall(zone, lo) - 3 * HOUR, -MAX_DATE);
  const wallHi = Math.min(instantToWall(zone, hi) + 3 * HOUR, MAX_DATE);
  const out: number[] = [];
  for (const w of wallBoundaries(interval, wallLo, wallHi, locale)) {
    // A calendar boundary is the first instant of its day, also where midnight falls in a gap.
    const t = firstInstantAtOrAfterWall(zone, w);
    if (t >= lo && t <= hi) out.push(t);
  }
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || t !== out[i - 1]);
}

/**
 * Seconds, minutes and hours: instants whose local clock is a multiple of `size`. Within a stretch of
 * constant offset that is plain arithmetic, so the domain is cut at its offset change, if any. A clock time
 * that happens twice (fold) gives two ticks; one that never happens (gap) gives none.
 */
function clockBoundaries(size: number, lo: number, hi: number, zone: string): number[] {
  const out: number[] = [];
  const push = (from: number, to: number, offset: number): void => {
    for (let t = Math.ceil((from + offset) / size) * size - offset, k = 0; t <= to && k < MAX_BOUNDARIES; t += size, k++) out.push(t);
  };
  const offLo = zoneOffset(zone, lo);
  const offHi = zoneOffset(zone, hi);
  if (offLo === offHi) {
    // Clock ticks are only asked for spans of a few days at most, and no zone changes its offset twice
    // and back within that.
    push(lo, hi, offLo);
    return out;
  }
  const change = firstInstantWithOffset(zone, lo, hi, offHi);
  push(lo, change - 1, offLo);
  push(change, hi, offHi);
  return out;
}

/** Wall values (local fields read as UTC) on the interval's boundaries in [wallLo, wallHi]. */
function wallBoundaries(interval: Interval, wallLo: number, wallHi: number, locale: string): number[] {
  const out: number[] = [];
  const { unit, n } = interval;
  if (unit === 'day') {
    // Days count from 1970-01-01, which keeps 2-day ticks evenly spaced across month ends.
    const size = n * UNIT_MS[unit];
    for (let w = Math.ceil(wallLo / size) * size, k = 0; w <= wallHi && k < MAX_BOUNDARIES; w += size, k++) out.push(w);
    return out;
  }
  if (unit === 'week') {
    const first = weekStart(locale);
    let day = Math.ceil(wallLo / DAY);
    // 1970-01-01 was a Thursday (weekday 4, Sunday = 0).
    for (let k = 0; k < 7 && (((day + 4) % 7) + 7) % 7 !== first; k++) day++;
    for (let w = day * DAY, k = 0; w <= wallHi && k < MAX_BOUNDARIES; w += 7 * DAY, k++) out.push(w);
    return out;
  }
  // Month and year loops run over the years of the range, so they end even where a boundary is not
  // representable (utcFields gives NaN past the Date range).
  const yLo = new Date(wallLo).getUTCFullYear();
  const yHi = new Date(wallHi).getUTCFullYear();
  if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) return out;
  if (unit === 'month') {
    for (let y = yLo; y <= yHi && y - yLo < MAX_BOUNDARIES; y++) {
      for (let m = 0; m < 12; m += n) {
        const w = utcFields(y, m, 1);
        if (Number.isFinite(w) && w >= wallLo && w <= wallHi) out.push(w);
      }
    }
    return out;
  }
  // year
  for (let y = yLo - (((yLo % n) + n) % n), k = 0; y <= yHi && k < MAX_BOUNDARIES; y += n, k++) {
    const w = utcFields(y, 0, 1);
    if (Number.isFinite(w) && w >= wallLo && w <= wallHi) out.push(w);
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
 * Ways to tell apart built-in labels that still read the same in one context, tried in order: the zone abbreviation and
 * then the numeric offset (the same clock time twice in a fold), then the era (1 BC and AD 1).
 */
function disambiguators(zone: string): Intl.DateTimeFormatOptions[] {
  const named: Intl.DateTimeFormatOptions[] = zone === 'UTC' ? [] : [{ timeZoneName: 'short' }, { timeZoneName: 'shortOffset' }];
  return [...named, { era: 'short' }, { era: 'short', year: 'numeric', timeZoneName: 'shortOffset' }];
}

/**
 * Labels a tick set. The context (year for month and day ticks, date for clock ticks) is written on the
 * first tick and wherever it changes, so every label is unambiguous with its left neighbours. A set that
 * reaches before year 1 carries the era on every label, and labels that would still read the same are
 * told apart (see `disambiguators`).
 */
function label(values: readonly number[], unit: TimeUnit, zone: string, options: TimeTickOptions): Tick[] {
  const level = levelOf(unit);
  const { short, context } = labelOptions(level);
  const walls = values.map(v => new Date(instantToWall(zone, v)));
  // Astronomical year 0 is 1 BC: Intl writes it as "1", like AD 1, unless the era is shown.
  const era: Intl.DateTimeFormatOptions = walls.some(w => w.getUTCFullYear() < 1) ? { era: 'short' } : {};
  const fields: Intl.DateTimeFormatOptions[] = [];
  const builtIn: boolean[] = [];
  const ticks: Tick[] = [];
  const keys: number[] = [];
  let previous = NaN;
  values.forEach((value, i) => {
    const wall = walls[i]!;
    // The context a label is read in: the year for calendar ticks, the calendar day for clock ticks, the
    // whole set for year ticks.
    const key = level === 'year' ? 0 : level === 'month' || level === 'day'
      ? wall.getUTCFullYear()
      : wall.getUTCFullYear() * 10000 + wall.getUTCMonth() * 100 + wall.getUTCDate();
    keys.push(key);
    const f = { ...(context !== null && key !== previous ? context : short), ...era };
    previous = key;
    fields.push(f);
    const custom = customLabel(options.label, value);
    builtIn.push(custom === null);
    ticks.push({ value, label: custom ?? dateTimeFormat(options.locale, { ...f, timeZone: zone }).format(value) });
  });
  for (const extra of disambiguators(zone)) {
    const repeated = repeatedBuiltIn(ticks, builtIn, keys);
    if (repeated.length === 0) break;
    for (const j of repeated) {
      fields[j] = { ...fields[j], ...extra };
      ticks[j] = { value: ticks[j]!.value, label: dateTimeFormat(options.locale, { ...fields[j], timeZone: zone }).format(ticks[j]!.value) };
    }
  }
  return ticks;
}

/**
 * Indexes of built-in labels that equal another label read in the same context. "3:00 AM" on two different
 * days is not repeated (the date is written where the day changes); "1:00 AM" twice on one day (a fold) is.
 */
function repeatedBuiltIn(ticks: readonly Tick[], builtIn: readonly boolean[], keys: readonly number[]): number[] {
  const id = (i: number): string => `${keys[i]}\u0000${ticks[i]!.label}`;
  const count = new Map<string, number>();
  ticks.forEach((_, i) => count.set(id(i), (count.get(id(i)) ?? 0) + 1));
  const out: number[] = [];
  ticks.forEach((_, i) => {
    if (builtIn[i] && (count.get(id(i)) ?? 0) > 1) out.push(i);
  });
  return out;
}
