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
  if (!Number.isFinite(position)) return String(position);
  const zone = zoneOf(kind, timeZone);
  if (kind === 'date') {
    const options: Intl.DateTimeFormatOptions =
      dateUnit === 'year' ? { year: 'numeric' }
        : dateUnit === 'month' ? { year: 'numeric', month: 'short' }
          : { year: 'numeric', month: 'short', day: 'numeric' };
    return dateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(position);
  }
  const wall = kind === 'time' ? instantToWall(zone, position) : position;
  const withinMinute = ((wall % MINUTE) + MINUTE) % MINUTE;
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  if (withinMinute !== 0) options.second = '2-digit';
  if (withinMinute % 1000 !== 0) options.fractionalSecondDigits = 3;
  if (kind === 'time') options.timeZoneName = 'short';
  options.timeZone = zone;
  return dateTimeFormat(locale, options).format(position);
}

function once(report: ((error: unknown) => void) | null | undefined): (error: unknown) => void {
  let done = false;
  return (error: unknown) => {
    if (done || !report) return;
    done = true;
    report(error);
  };
}

/** The author's format wrapped so that a failure falls back to `fallback` and is reported once. Null when there is none. */
function authorTimeFormat(spec: TimeReadoutSpec, fallback: ((position: number) => string) | null): ((position: number) => string) | null {
  const format = spec.format;
  if (format == null) return null;
  const report = once(spec.onError);
  if (typeof format === 'function') {
    return (position: number) => {
      try {
        return String(format(new Date(position)));
      } catch (error) {
        report(error);
        if (fallback === null) throw error;
        return fallback(position);
      }
    };
  }
  try {
    // The axis zone always wins: date and wall positions only read correctly in UTC.
    const dtf = dateTimeFormat(spec.locale, { ...(format as Intl.DateTimeFormatOptions), timeZone: zoneOf(spec.kind, spec.timeZone) });
    dtf.format(0);
    return (position: number) => dtf.format(position);
  } catch (error) {
    report(error);
    return null;
  }
}

/** Readout formatter for a temporal x axis. */
export function createTimeReadout(spec: TimeReadoutSpec): (position: number) => string {
  const fallback = (position: number): string => defaultTimeReadout(position, spec.kind, spec.timeZone, spec.locale, spec.dateUnit);
  return authorTimeFormat(spec, fallback) ?? fallback;
}

/**
 * Tick labeler from the author's `tickFormat`, for `timeTickCandidates({ label })`. Null when there is none,
 * so the built-in context-aware labels apply. A failure is reported once and rethrown, and the tick
 * generator then uses its built-in label for that tick.
 */
export function createTimeTickLabel(spec: TimeReadoutSpec): ((position: number) => string) | null {
  return authorTimeFormat(spec, null);
}
