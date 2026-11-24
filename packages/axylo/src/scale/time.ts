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
import { builtInDateFormat, DateParts } from '../format/intl';
import { zoneOf } from '../format/time';

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

const enum Unit {
  Millisecond, Second, Minute, Hour, Day, Week, Month, Year,
}

interface Interval {
  readonly unit: Unit;
  readonly n: number;
  /** Typical length in ms, for estimating tick counts before generating. */
  readonly approx: number;
}

const UNIT_MS = [1, SECOND, MINUTE, HOUR, DAY, 604_800_000, 2_629_746_000, 31_556_952_000];

function interval(unit: Unit, n: number): Interval {
  return { unit, n, approx: n * UNIT_MS[unit]! };
}

let subYear: readonly Interval[] | undefined;
const clockSteps = [1, 2, 5, 10, 15, 30];
// Finest first. Multiples divide the next unit so that clock ticks stay aligned.
const subYearSteps = [
  [1, 2, 5, 10, 20, 50, 100, 200, 500], clockSteps, clockSteps,
  [1, 2, 3, 6, 12], [1, 2], [1], [1, 2, 3, 6],
];

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

interface Candidate {
  readonly length: number;
  ticks(): Tick[];
}

/** The finest unit allowed on this axis. */
function finestUnit(options: TimeTickOptions): Unit {
  if (options.kind !== 'date') return Unit.Millisecond;
  return options.dateUnit === 'year' ? Unit.Year : options.dateUnit === 'month' ? Unit.Month : Unit.Day;
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
  const zone = zoneOf(options.kind, options.timeZone);
  const finest = finestUnit(options);
  const span = hi - lo;

  const sets: Candidate[] = [];
  const consider = (interval: Interval): boolean => {
    if (interval.unit < finest) return true;
    // Skip intervals that would obviously give far too many ticks, before paying for generation.
    if (span / interval.approx > MAX_TICKS + 2) return true;
    const values = boundaries(interval, lo, hi, zone, options.locale);
    if (values.length >= 1 && values.length <= MAX_TICKS) {
      const build = () => label(values, interval.unit, zone, options);
      // Author callbacks run in interval order, even for a density a later interval replaces.
      const eager = options.label ? build() : null;
      pushCandidate(sets, { length: values.length, ticks: eager ? () => eager : build });
    }
    // Go on while there is a tick: a coarser interval with as many ticks replaces the finer set, so a lone
    // tick ends up on the roundest boundary in the domain (midnight rather than 00:00:00.000).
    return values.length > 0;
  };

  subYear ??= subYearSteps.flatMap((steps, unit) => steps.map(n => interval(unit, n)));
  // Years keep the 1, 2, 5 progression at each power of ten.
  if (subYear.every(consider)) {
    years: for (let power = 1; power <= 1e8; power *= 10) {
      for (const step of [1, 2, 5]) {
        if (!consider(interval(Unit.Year, step * power))) break years;
      }
    }
  }
  return finish(sets, lo, zone, options);
}

/** A domain too short to hold any boundary still gets one labeled tick at its start. */
function finish(sets: Candidate[], lo: number, zone: string, options: TimeTickOptions): TickCandidates {
  if (sets.length > 0) return sets.map(set => set.ticks());
  let unit = finestUnit(options);
  if (unit === Unit.Millisecond) {
    // Show the clock only as precisely as the instant needs.
    const wall = instantToWall(zone, lo);
    const ms = modulo(wall, DAY);
    unit = ms % SECOND !== 0 ? Unit.Millisecond : ms % MINUTE !== 0 ? Unit.Second : Unit.Minute;
  }
  return [label([lo], unit, zone, options)];
}

// ───────────────────────────── boundaries ─────────────────────────────

function appendBoundaries(out: number[], first: number, last: number, step: number): void {
  for (let t = first, k = 0; t <= last && k < MAX_BOUNDARIES; t += step, k++) out.push(t);
}

function regularBoundaries(lo: number, hi: number, step: number): number[] {
  const out: number[] = [];
  appendBoundaries(out, Math.ceil(lo / step) * step, hi, step);
  return out;
}

/** Instants in [lo, hi] on the interval's boundaries in `zone`, ascending, without duplicates. */
function boundaries(interval: Interval, lo: number, hi: number, zone: string, locale: string): number[] {
  if (interval.unit === Unit.Millisecond) return regularBoundaries(lo, hi, interval.n);
  if (interval.unit <= Unit.Hour) return clockBoundaries(interval.approx, lo, hi, zone);
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
    appendBoundaries(out, Math.ceil((from + offset) / size) * size - offset, to, size);
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
  const { unit, n } = interval;
  // Days count from 1970-01-01 so their spacing survives month ends.
  if (unit === Unit.Day) return regularBoundaries(wallLo, wallHi, interval.approx);
  const out: number[] = [];
  if (unit === Unit.Week) {
    const first = weekStart(locale);
    const day = Math.ceil(wallLo / DAY);
    // 1970-01-01 was a Thursday (weekday 4, Sunday = 0).
    appendBoundaries(out, (day + modulo(first - day - 4, 7)) * DAY, wallHi, interval.approx);
    return out;
  }
  // Month and year loops run over the years of the range, so they end even where a boundary is not
  // representable (utcFields gives NaN past the Date range).
  const yLo = new Date(wallLo).getUTCFullYear();
  const yHi = new Date(wallHi).getUTCFullYear();
  if (!Number.isFinite(yLo) || !Number.isFinite(yHi)) return out;
  const months = unit === Unit.Month ? n : 12;
  const years = unit === Unit.Month ? 1 : n;
  for (let y = yLo - modulo(yLo, years), k = 0; y <= yHi && k < MAX_BOUNDARIES; y += years, k++) {
    for (let m = 0; m < 12; m += months) {
      const wall = utcFields(y, m, 1);
      if (wall >= wallLo && wall <= wallHi) out.push(wall);
    }
  }
  return out;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

interface WeekInfoLocale { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } }

const WEEK_START_CACHE_LIMIT = 64;
let weekStarts: Map<string, number> | undefined;

/** First day of the week for the locale, Sunday = 0. Monday (ISO) when the engine cannot say. */
export function weekStart(locale: string): number {
  if (locale === 'en-GB') return 1;
  if (locale === 'en' || locale === 'en-US') {
    // Bare English resolves to the US for week rules. Keep the ISO fallback on engines without week info.
    const prototype = Intl.Locale?.prototype;
    return prototype && ('getWeekInfo' in prototype || 'weekInfo' in prototype) ? 0 : 1;
  }

  const cache = weekStarts ??= new Map();
  const cached = cache.get(locale);
  if (cached !== undefined) return cached;
  let first = 1;
  try {
    const l = new Intl.Locale(locale) as unknown as WeekInfoLocale;
    const info = typeof l.getWeekInfo === 'function' ? l.getWeekInfo() : l.weekInfo;
    if (info && Number.isInteger(info.firstDay)) first = info.firstDay % 7;
  } catch {
    // An invalid tag is reported by whoever resolved the locale.
  }
  if (cache.size >= WEEK_START_CACHE_LIMIT) cache.clear();
  cache.set(locale, first);
  return first;
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

const tickParts = [
  DateParts.Clock | DateParts.Seconds | DateParts.Milliseconds, DateParts.Clock | DateParts.Seconds,
  DateParts.Clock, DateParts.Clock, DateParts.MonthDay, DateParts.MonthDay, DateParts.Month, DateParts.Year,
];

// Try the zone abbreviation and offset first in a fold, then the era for labels such as 1 BC and AD 1.
const disambiguators = [
  DateParts.Zone, DateParts.Offset, DateParts.Era, DateParts.Era | DateParts.Year | DateParts.Offset,
];

/**
 * Labels a tick set. The context (year for month and day ticks, date for clock ticks) is written on the
 * first tick and wherever it changes, so every label is unambiguous with its left neighbours. A set that
 * reaches before year 1 carries the era on every label, and labels that would still read the same are
 * told apart (see `disambiguators`).
 */
function label(values: readonly number[], unit: Unit, zone: string, options: TimeTickOptions): Tick[] {
  const short = tickParts[unit]!;
  const context = short === DateParts.Year ? 0 : short & DateParts.Clock ? DateParts.MonthDay : DateParts.Year;
  const walls = values.map(v => instantToWall(zone, v));
  // An offset can move the local day beyond Date's limits, but never across a year at either limit.
  const year = (wall: number) => new Date(Math.max(-MAX_DATE, Math.min(wall, MAX_DATE))).getUTCFullYear();
  // Astronomical year 0 is 1 BC: Intl writes it as "1", like AD 1, unless the era is shown.
  const base = short | (walls.some(w => year(w) < 1) ? DateParts.Era : 0);
  const formatter = (parts: number) => builtInDateFormat(options.locale, zone, parts);
  let shortFormat: Intl.DateTimeFormat['format'] | undefined;
  let contextFormat: Intl.DateTimeFormat['format'] | undefined;
  const ticks = values.map((t, i) => {
    const value = t === 0 ? 0 : t;
    const wall = walls[i]!;
    // The context a label is read in: the year for calendar ticks, the calendar day for clock ticks, the
    // whole set for year ticks.
    const key = !context ? 0 : context === DateParts.Year ? year(wall) : Math.floor(wall / DAY);
    const custom = customLabel(options.label, value);
    // A custom label has no built-in fields to disambiguate or contextualize.
    return { value, key, parts: custom === null ? base : null, label: custom ?? (shortFormat ??= formatter(base))(value) };
  });
  for (const extra of zone === 'UTC' ? disambiguators.slice(2) : disambiguators) {
    // Candidate sets are capped at MAX_TICKS, so comparing labels avoids building a frequency map.
    const repeated = ticks.filter(tick => tick.parts !== null && ticks.some(other =>
      other !== tick && other.key === tick.key && other.label === tick.label));
    if (!repeated.length) break;
    for (const tick of repeated) {
      tick.parts = tick.parts! | extra;
      tick.label = formatter(tick.parts)(tick.value);
    }
  }
  // Add the date or year only after comparing short labels within their local day or year.
  return ticks.map(({ value, label, key, parts }, i) => {
    if (context && parts !== null && key !== ticks[i - 1]?.key) {
      const format = parts === base ? contextFormat ??= formatter(base | context) : formatter(parts | context);
      label = format(value);
    }
    return { value, label };
  });
}
