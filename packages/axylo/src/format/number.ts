/**
 * Number formatting (spec F6). Readouts (tooltip, table, announcements) and ticks are formatted apart:
 * readouts keep the full integer part and six significant digits; ticks are as short as their step allows.
 */
import type { TickContext, TickLabeler } from '../scale/linear';
import { numberFormat } from './intl';

export type ValueScale = 'percent' | 'ratio' | null;
export type NumberFormatOption = Intl.NumberFormatOptions | ((value: number) => string);

export interface NumberReadoutSpec {
  readonly locale: string;
  /** 'percent': the value is 0–100 and gets a percent sign. 'ratio': the value is 0–1 and is shown as a percentage. */
  readonly scale?: ValueScale;
  /** Appended after a space ("12 ms"). */
  readonly unit?: string | null;
  /** The author's `format`; replaces the default. */
  readonly format?: NumberFormatOption | null;
  /** Called once, the first time the author's format fails (the caller raises AX160). */
  readonly onError?: ((error: unknown) => void) | null;
}

export interface NumberTickSpec {
  readonly locale: string;
  readonly scale?: ValueScale;
  /** The author's `tickFormat`; replaces the default. */
  readonly tickFormat?: NumberFormatOption | null;
  readonly onError?: ((error: unknown) => void) | null;
}

const MAX_FRACTION_DIGITS = 6;
const SIGNIFICANT_DIGITS = 6;

/**
 * Fraction digits a readout shows: enough for six significant digits, at most six, none when the integer
 * part already has six or more digits.
 */
export function readoutFractionDigits(abs: number): number {
  if (abs === 0 || !Number.isFinite(abs)) return 0;
  const leading = Math.floor(Math.log10(abs)); // power of ten of the first significant digit
  return Math.min(Math.max(SIGNIFICANT_DIGITS - 1 - leading, 0), MAX_FRACTION_DIGITS);
}

/** The value as the percent style of Intl expects it (a fraction), or the value itself. */
function asIntlValue(v: number, scale: ValueScale): number {
  return scale === 'percent' ? v / 100 : v;
}

/** The number the reader sees before any sign or symbol (a ratio is shown ×100). */
function shown(v: number, scale: ValueScale): number {
  return scale === 'ratio' ? v * 100 : v;
}

/** The default readout of spec F6, without the unit. */
export function defaultReadoutNumber(v: number, locale: string, scale: ValueScale = null): string {
  if (!Number.isFinite(v)) return numberFormat(locale, {}).format(v);
  const digits = readoutFractionDigits(Math.abs(shown(v, scale)));
  // A value that rounds to zero is written "0", not "-0".
  const value = Math.abs(shown(v, scale)) < 0.5 * 10 ** -digits ? 0 : v;
  const options: Intl.NumberFormatOptions = scale
    ? { style: 'percent', maximumFractionDigits: digits }
    : { maximumFractionDigits: digits };
  return numberFormat(locale, options).format(asIntlValue(value, scale));
}

function withUnit(text: string, unit: string | null | undefined): string {
  return unit ? `${text} ${unit}` : text;
}

/** Calls `report` the first time only. */
function once(report: ((error: unknown) => void) | null | undefined): (error: unknown) => void {
  let done = false;
  return (error: unknown) => {
    if (done || !report) return;
    done = true;
    report(error);
  };
}

/**
 * An author's Intl options, with the declared scale applied: a percent or ratio field without an explicit
 * `style` is still written as a percentage.
 */
function authorIntl(locale: string, options: Intl.NumberFormatOptions, scale: ValueScale): { format: (v: number) => string; appendUnit: boolean } {
  const merged: Intl.NumberFormatOptions = scale && options.style === undefined ? { ...options, style: 'percent' } : options;
  const nf = numberFormat(locale, merged);
  const divide = scale === 'percent' && merged.style === 'percent';
  return {
    format: (v: number) => nf.format(divide ? v / 100 : v),
    // Currency and unit styles already carry their own symbol.
    appendUnit: merged.style !== 'currency' && merged.style !== 'unit',
  };
}

/** Readout formatter for one value field: tooltip, table and announcements. */
export function createNumberReadout(spec: NumberReadoutSpec): (v: number) => string {
  const { locale, unit } = spec;
  const scale = spec.scale ?? null;
  const fallback = (v: number): string => withUnit(defaultReadoutNumber(v, locale, scale), unit);
  const report = once(spec.onError);
  const format = spec.format;
  if (format == null) return fallback;
  if (typeof format === 'function') {
    return (v: number) => {
      try {
        return String(format(v));
      } catch (error) {
        report(error);
        return fallback(v);
      }
    };
  }
  let author: ReturnType<typeof authorIntl>;
  try {
    author = authorIntl(locale, format, scale);
    author.format(0); // options are validated on use in some engines
  } catch (error) {
    report(error);
    return fallback;
  }
  const { format: write, appendUnit } = author;
  return (v: number) => (appendUnit ? withUnit(write(v), unit) : write(v));
}

/** Power of ten of a nice step (1, 2 or 5 × 10^k gives k). */
function stepExponent(step: number): number {
  return Math.floor(Math.log10(step) + 1e-9);
}

/**
 * The default tick label: locale grouping, as many fraction digits as the step needs (the same for every
 * tick of a set, so they line up), and compact notation when the largest tick is at least a million.
 */
export function defaultTickNumber(value: number, context: TickContext, locale: string, scale: ValueScale = null): string {
  const v = value === 0 ? 0 : value;
  const display = Math.abs(shown(v, scale));
  const maxAbs = Math.abs(shown(context.maxAbs, scale));
  const step = Math.abs(shown(context.step, scale));
  const style: Intl.NumberFormatOptions = scale ? { style: 'percent' } : {};
  if (maxAbs >= 1e6) {
    if (display === 0) return numberFormat(locale, { ...style, maximumFractionDigits: 0 }).format(0);
    // Significant digits that write this tick exactly at the set's step: 10.2M at a 200K step needs three.
    const k = step > 0 ? stepExponent(step) : Math.floor(Math.log10(display)) - 5;
    const significant = Math.min(Math.max(Math.floor(Math.log10(display)) - k + 1, 1), 21);
    return numberFormat(locale, { ...style, notation: 'compact', maximumSignificantDigits: significant }).format(asIntlValue(v, scale));
  }
  const digits = step > 0 ? Math.min(Math.max(-stepExponent(step), 0), 20) : readoutFractionDigits(display);
  return numberFormat(locale, { ...style, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(asIntlValue(v, scale));
}

/** Tick labeler for a value axis (or a numeric x axis). */
export function createNumberTickLabeler(spec: NumberTickSpec): TickLabeler {
  const { locale } = spec;
  const scale = spec.scale ?? null;
  const fallback: TickLabeler = (value, context) => defaultTickNumber(value, context, locale, scale);
  const report = once(spec.onError);
  const format = spec.tickFormat;
  if (format == null) return fallback;
  if (typeof format === 'function') {
    return (value, context) => {
      try {
        return String(format(value));
      } catch (error) {
        report(error);
        return fallback(value, context);
      }
    };
  }
  try {
    const author = authorIntl(locale, format, scale);
    author.format(0);
    return value => author.format(value);
  } catch (error) {
    report(error);
    return fallback;
  }
}
