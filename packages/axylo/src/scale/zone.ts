/**
 * Time zone arithmetic with nothing but `Intl`.
 *
 * A "wall" value is a local date-time written as if it were UTC: the epoch milliseconds whose UTC fields
 * equal the local fields. Calendar arithmetic (next day, next month) is done on wall values with the UTC
 * methods of Date, which never see a daylight-saving change, and converted to instants at the end.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Largest |epoch ms| a Date can hold. */
export const MAX_DATE = 8.64e15;

const fieldFormatters = new Map<string, Intl.DateTimeFormat>();

function fieldFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = fieldFormatters.get(timeZone);
  if (f === undefined) {
    // en-US with numeric fields and h23 is the one combination whose parts are plain integers in every engine.
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    fieldFormatters.set(timeZone, f);
  }
  return f;
}

function isUtc(timeZone: string): boolean {
  return timeZone === 'UTC' || timeZone === 'Etc/UTC' || timeZone === 'Etc/GMT' || timeZone === 'GMT';
}

/** Epoch ms of the given UTC fields. Unlike Date.UTC, years 0–99 are not moved to the 1900s. */
export function utcFields(year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  d.setUTCHours(hour, minute, second, ms);
  return d.getTime();
}

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds (positive east of Greenwich).
 * Paris in winter gives 3,600,000; Los Angeles in summer gives -25,200,000.
 */
export function zoneOffset(timeZone: string, instant: number): number {
  if (isUtc(timeZone) || !Number.isFinite(instant)) return 0;
  // Offsets change on whole seconds, and Intl drops milliseconds, so compare at the whole second. Outside
  // the Date range Intl throws; the offset at the nearest representable second stands in.
  const second = Math.min(Math.max(Math.floor(instant / 1000) * 1000, -MAX_DATE + DAY), MAX_DATE - DAY);
  let year = 0, month = 0, day = 0, hour = 0, minute = 0, sec = 0;
  let bc = false;
  for (const part of fieldFormatter(timeZone).formatToParts(second)) {
    switch (part.type) {
      case 'year': year = Number(part.value); break;
      case 'month': month = Number(part.value); break;
      case 'day': day = Number(part.value); break;
      // Some older engines write midnight as 24 even with h23.
      case 'hour': hour = Number(part.value) % 24; break;
      case 'minute': minute = Number(part.value); break;
      case 'second': sec = Number(part.value); break;
      case 'era': bc = part.value === 'BC' || part.value === 'B'; break;
      default: break;
    }
  }
  if (bc) year = 1 - year;
  return utcFields(year, month - 1, day, hour, minute, sec) - second;
}

/** The wall value (local fields read as UTC) of an instant in a zone. */
export function instantToWall(timeZone: string, instant: number): number {
  return instant + zoneOffset(timeZone, instant);
}

/**
 * Every instant at which the zone's clocks show `wall`, ascending: none in a daylight-saving gap,
 * two in a fold, one otherwise.
 */
export function wallToInstants(timeZone: string, wall: number): number[] {
  if (isUtc(timeZone)) return [wall];
  // The offsets a day either side are the offsets on each side of any transition near this wall time
  // (zones do not change offset twice within two days).
  const before = zoneOffset(timeZone, wall - DAY);
  const after = zoneOffset(timeZone, wall + DAY);
  const out: number[] = [];
  const tryOffset = (offset: number): void => {
    const t = wall - offset;
    if (zoneOffset(timeZone, t) === offset && !out.includes(t)) out.push(t);
  };
  tryOffset(before);
  if (after !== before) tryOffset(after);
  if (out.length === 0 && after === before) {
    // Same offset on both sides but no match: the offset changed and changed back within the window.
    // Fall back to the offset at the first guess, which is right everywhere except inside that change.
    const guess = wall - before;
    tryOffset(zoneOffset(timeZone, guess));
  }
  return out.sort((a, b) => a - b);
}

export type Disambiguation = 'compatible' | 'earlier' | 'later';

/**
 * The instant at which the zone's clocks show `wall`.
 *  - In a fold, 'compatible' and 'earlier' give the first occurrence, 'later' the second.
 *  - In a gap, 'compatible' and 'later' move forward by the length of the gap (02:30 on a spring-forward
 *    night in Los Angeles gives 03:30 PDT), 'earlier' moves back (01:30 PST). This is what JavaScript
 *    Date and Temporal do.
 */
export function wallToInstant(timeZone: string, wall: number, disambiguation: Disambiguation = 'compatible'): number {
  const found = wallToInstants(timeZone, wall);
  if (found.length === 1) return found[0] as number;
  if (found.length > 1) return disambiguation === 'later' ? (found[found.length - 1] as number) : (found[0] as number);
  const before = zoneOffset(timeZone, wall - DAY);
  const after = zoneOffset(timeZone, wall + DAY);
  // In a gap the offset grows (before < after). Reading the wall time with the earlier offset lands after
  // the transition, with the later offset before it.
  return disambiguation === 'earlier' ? wall - after : wall - before;
}

/**
 * The first instant whose local wall time is at or after `wall`: the instant of `wall` itself, or, when
 * `wall` falls in a gap, the moment the clocks jump past it. This is the start of a calendar day whose
 * midnight does not exist (Toronto, 31 March 1919: clocks went from 23:30 to 00:30 at 04:30Z).
 */
export function firstInstantAtOrAfterWall(timeZone: string, wall: number): number {
  const found = wallToInstants(timeZone, wall);
  if (found.length > 0) return found[0] as number;
  const before = zoneOffset(timeZone, wall - DAY);
  const after = zoneOffset(timeZone, wall + DAY);
  // wall - after reads earlier than `wall` (still before the jump); wall - before reads later (after it).
  return firstInstantWithOffset(timeZone, wall - after, wall - before, after);
}

/** The first whole second in (lo, hi] at which the zone's offset is `offset`, by bisection (offset differs at lo). */
export function firstInstantWithOffset(timeZone: string, lo: number, hi: number, offset: number): number {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return hi;
  let a = Math.floor(lo / 1000);
  let b = Math.ceil(hi / 1000);
  // 64 halvings cover any range of whole seconds a Date can hold; the bound keeps the loop finite regardless.
  for (let k = 0; k < 64 && b - a > 1; k++) {
    const m = Math.floor((a + b) / 2);
    if (zoneOffset(timeZone, m * 1000) === offset) b = m;
    else a = m;
  }
  return Math.max(b * 1000, lo);
}

export const TIME = { MINUTE, HOUR, DAY } as const;
