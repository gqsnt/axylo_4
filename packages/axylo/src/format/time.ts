/**
 * Readouts of x positions on temporal axes (spec F4, F6):
 *  'date' – a calendar date in UTC ("Feb 24, 2026"; month unit "Feb 2026"; year unit "2026");
 *  'time' – date and time in the axis zone, with the zone's short name ("Feb 23, 2026, 4:00 PM PST");
 *  'wall' – date and time as written (stored as if UTC), with no zone name.
 * Seconds and milliseconds are shown only for positions that have them.
 */
import type { XValue } from '../public';
import { instantToWall } from '../scale/zone';
import { dateTimeFormat } from './intl';
import { once } from './number';

export type TemporalKind = 'time' | 'date' | 'wall';
export type DateFormatOption = Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | ((value: XValue) => string);

export interface TimeReadoutSpec {
  readonly kind: TemporalKind;
  /** For 'time': the resolved IANA zone. Ignored otherwise. */
  readonly timeZone?: string | null;
  readonly locale: string;
  /** For 'date': the coarsest unit every value falls on. */
  readonly dateUnit?: 'day' | 'month' | 'year' | null;
  /** The author's `format` (readouts) or `tickFormat` (ticks). Functions receive a Date. */
  readonly format?: DateFormatOption | null;
  /** Called once, the first time the author's format fails (the caller raises AX160). */
  readonly onError?: ((error: unknown) => void) | null;
}

function zoneOf(kind: TemporalKind, timeZone: string | null | undefined): string {
  return kind === 'time' && timeZone ? timeZone : 'UTC';
}

const MINUTE = 60_000;

export function defaultTimeReadout(
  position: number,
  kind: TemporalKind,
  timeZone: string | null | undefined,
  locale: string,
  dateUnit: 'day' | 'month' | 'year' | null | undefined = null,
): string {
  if (!representable(position)) return String(position);
  const zone = zoneOf(kind, timeZone);
  const wall = kind === 'time' ? instantToWall(zone, position) : position;
  // Astronomical year 0 is 1 BC, which Intl writes "1" like AD 1 unless the era is shown.
  const era: Intl.DateTimeFormatOptions = new Date(wall).getUTCFullYear() < 1 ? { era: 'short' } : {};
  if (kind === 'date') {
    const options: Intl.DateTimeFormatOptions =
      dateUnit === 'year' ? { year: 'numeric' }
        : dateUnit === 'month' ? { year: 'numeric', month: 'short' }
          : { year: 'numeric', month: 'short', day: 'numeric' };
    return dateTimeFormat(locale, { ...options, ...era, timeZone: 'UTC' }).format(position);
  }
  const withinMinute = ((wall % MINUTE) + MINUTE) % MINUTE;
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...era };
  if (withinMinute !== 0) options.second = '2-digit';
  if (withinMinute % 1000 !== 0) options.fractionalSecondDigits = 3;
  if (kind === 'time') options.timeZoneName = 'short';
  options.timeZone = zone;
  return dateTimeFormat(locale, options).format(position);
}

/** Positions a Date can hold; Intl throws on any other ("Invalid time value"), so they are written as numbers. */
function representable(position: number): boolean {
  return Number.isFinite(position) && Math.abs(position) <= 8.64e15;
}

/** The zone's name at an instant as Intl writes it ("PST", "GMT+5:30"), in the given style. */
function zoneName(locale: string, timeZone: string, position: number, style: 'short' | 'shortOffset' = 'short'): string {
  const parts = dateTimeFormat(locale, { timeZoneName: style, timeZone }).formatToParts(position);
  return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * The author's format wrapped so that a failure falls back to `fallback` and is reported once. Null when
 * there is none. With `requireZone` (readouts of instants, spec F4) the zone is always named: added to Intl
 * options that leave it out, appended where the options cannot take it (dateStyle, timeStyle), and appended
 * to a function's output that names neither the zone nor its offset.
 */
function authorTimeFormat(spec: TimeReadoutSpec, fallback: ((position: number) => string) | null, requireZone: boolean): ((position: number) => string) | null {
  const format = spec.format;
  if (format == null) return null;
  const report = once(spec.onError);
  const zone = zoneOf(spec.kind, spec.timeZone);
  const nameZone = requireZone && spec.kind === 'time';
  if (typeof format === 'function') {
    return (position: number) => {
      let out: string;
      try {
        out = String(format(new Date(position)));
      } catch (error) {
        report(error);
        if (fallback === null) throw error;
        return fallback(position);
      }
      if (!nameZone) return out;
      const name = zoneName(spec.locale, zone, position);
      if (out.includes(name) || out.includes(zoneName(spec.locale, zone, position, 'shortOffset'))) return out;
      return `${out} ${name}`;
    };
  }
  try {
    // The axis zone always wins: date and wall positions only read correctly in UTC.
    const options = { ...(format as Intl.DateTimeFormatOptions), timeZone: zone };
    let dtf = dateTimeFormat(spec.locale, options);
    dtf.format(0);
    let append = false;
    if (nameZone && !dtf.formatToParts(0).some(p => p.type === 'timeZoneName')) {
      try {
        dtf = dateTimeFormat(spec.locale, { ...options, timeZoneName: 'short' });
      } catch {
        append = true; // dateStyle and timeStyle cannot be combined with timeZoneName
      }
    }
    const write = dtf;
    return append
      ? (position: number) => `${write.format(position)} ${zoneName(spec.locale, zone, position)}`
      : (position: number) => write.format(position);
  } catch (error) {
    report(error);
    return null;
  }
}

/** Readout formatter for a temporal x axis. */
export function createTimeReadout(spec: TimeReadoutSpec): (position: number) => string {
  const fallback = (position: number): string => defaultTimeReadout(position, spec.kind, spec.timeZone, spec.locale, spec.dateUnit);
  const author = authorTimeFormat(spec, fallback, true);
  if (author === null) return fallback;
  return (position: number) => (representable(position) ? author(position) : String(position));
}

/**
 * Tick labeler from the author's `tickFormat`, for `timeTickCandidates({ label })`. Null when there is none,
 * so the built-in context-aware labels apply. A failure is reported once and rethrown, and the tick
 * generator then uses its built-in label for that tick. Ticks do not repeat the zone; the readouts and the
 * description name it.
 */
export function createTimeTickLabel(spec: TimeReadoutSpec): ((position: number) => string) | null {
  const author = authorTimeFormat(spec, null, false);
  if (author === null) return null;
  return (position: number) => (representable(position) ? author(position) : String(position));
}
