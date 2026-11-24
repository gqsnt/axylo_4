/**
 * The Formatters of a chart: how readers see values, x positions and missing slots in tooltip, table and
 * announcements (spec F2, F4, F6).
 */
import type { Environment, Formatters, SlotState, XKind } from '../core/contracts';
import { SLOT_NO_ROW, SLOT_VALUE } from '../core/contracts';
import { createNumberReadout, defaultReadoutNumber, shareText, type NumberFormatOption, type ValueScale } from './number';
import { createTimeReadout, type DateFormatOption } from './time';

export { createNumberReadout, createNumberTickLabeler, defaultReadoutNumber, defaultTickNumber, readoutFractionDigits } from './number';
export type { NumberFormatOption, NumberReadoutSpec, NumberTickSpec, ValueScale } from './number';
export { createTimeReadout, createTimeTickLabel, defaultTimeReadout } from './time';
export type { DateFormatOption, TemporalKind, TimeReadoutSpec } from './time';

/** Formatting inputs of one value series. Built from the series and its field options. */
export interface SeriesFormatSpec {
  /** Field name, passed to `onFormatterError`. */
  readonly field: string;
  readonly unit: string | null;
  readonly scale: ValueScale;
  /** The field's `format` option. */
  readonly format?: NumberFormatOption | null;
}

/** Formatting inputs of the x axis. Built from the frame's x column and the x field options. */
export interface XFormatSpec {
  readonly scale?: ValueScale;
  readonly field: string;
  readonly kind: XKind;
  readonly unit: string | null;
  /** For 'time': the zone; 'local' or null means the viewer's (Environment.timeZone). */
  readonly timeZone: string | null;
  readonly dateUnit: 'day' | 'month' | 'year' | null;
  /** For 'category': the name of each position. */
  readonly categories: readonly string[] | null;
  /** The field's `format` option. Number options apply to 'number', date-time options to the temporal kinds. */
  readonly format?: DateFormatOption | null;
}

export interface FormatSpec {
  readonly series: readonly SeriesFormatSpec[];
  readonly x: XFormatSpec;
  /** The chart's `locale` option; Environment.locale when absent. */
  readonly locale?: string | null;
  readonly messages: { readonly noData: string; readonly noObservation: string };
  /** Called once per field and formatter when an author formatter throws (the caller raises AX160 for that field). */
  readonly onFormatterError?: ((field: string, error: unknown) => void) | null;
}

export function createFormatters(spec: FormatSpec, env: Pick<Environment, 'locale' | 'timeZone'>): Formatters {
  return createFormattersWith(spec, env, createTimeReadout);
}

export function createFormattersWith(
  spec: FormatSpec,
  env: Pick<Environment, 'locale' | 'timeZone'>,
  timeReadout?: typeof createTimeReadout,
): Formatters {
  const locale = spec.locale || env.locale;
  const report = spec.onFormatterError;
  const reporter = (field: string) => (report ? (error: unknown) => report(field, error) : null);

  const values = spec.series.map(s =>
    createNumberReadout({ locale, scale: s.scale, unit: s.unit, format: s.format ?? null, onError: reporter(s.field) }),
  );
  const x = createXReadout(spec.x, locale, env, reporter(spec.x.field), timeReadout);
  const { noData, noObservation } = spec.messages;

  return {
    value(seriesIndex: number, v: number): string {
      const f = values[seriesIndex];
      return f ? f(v) : defaultReadoutNumber(v, locale);
    },
    x,
    percent(ratio: number): string {
      return shareText(ratio, locale);
    },
    count(n: number): string {
      return defaultReadoutNumber(n, locale, null);
    },
    missing(state: SlotState): string {
      if (state === SLOT_VALUE) return '';
      // No row at this x for this series is "No observation"; every other non-value (null, invalid, gap,
      // absent field) is "No data" (spec F2, I1).
      return state === SLOT_NO_ROW ? noObservation : noData;
    },
  };
}

function createXReadout(
  x: XFormatSpec,
  locale: string,
  env: Pick<Environment, 'timeZone'>,
  onError: ((error: unknown) => void) | null,
  timeReadout?: typeof createTimeReadout,
): (position: number) => string {
  switch (x.kind) {
    case 'category': {
      const names = x.categories ?? [];
      const format = x.format;
      const name = (position: number): string => names[position] ?? String(position);
      // Intl options have no meaning for a name; only an author function changes it.
      if (typeof format !== 'function') return name;
      let reported = false;
      return (position: number) => {
        try {
          return String(format(name(position)));
        } catch (error) {
          if (!reported && onError) onError(error);
          reported = true;
          return name(position);
        }
      };
    }
    case 'number': {
      const format = x.format;
      // Date-time options make no sense for a number; only a function or number options are used.
      const numberOption: NumberFormatOption | null =
        typeof format === 'function' ? (v: number) => format(v) : format != null && !isDateOptions(format) ? (format as Intl.NumberFormatOptions) : null;
      return createNumberReadout({ locale, scale: x.scale, unit: x.unit, format: numberOption, onError });
    }
    default: {
      const timeZone = x.kind === 'time' ? (x.timeZone == null || x.timeZone === 'local' ? env.timeZone : x.timeZone) : null;
      return timeReadout ? timeReadout({ kind: x.kind, timeZone, locale, dateUnit: x.dateUnit, format: x.format ?? null, onError }) : String;
    }
  }
}

const DATE_KEYS = ['dateStyle', 'timeStyle', 'year', 'month', 'day', 'weekday', 'hour', 'minute', 'second', 'era', 'timeZoneName', 'hour12', 'hourCycle', 'dayPeriod', 'fractionalSecondDigits'];

function isDateOptions(o: object): boolean {
  return DATE_KEYS.some(k => k in o);
}
