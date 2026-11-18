/**
 * Number formatting (spec F6). Readouts (tooltip, table, announcements) and ticks are formatted apart:
 * readouts keep the full integer part and the fraction to six significant digits; ticks are as short as
 * their step allows while neighbours stay distinct.
 *
 * Numbers reach Intl as exact decimal strings ("1.0000005e-1"), never through a binary rescale such as
 * v / 100: Intl.NumberFormat formats a string as the decimal it spells, so a declared percentage rounds as
 * the decimal it is, and a ratio's ×100 is done by Intl's percent style in decimal.
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

const SIGNIFICANT_FRACTION_DIGITS = 6;
/** Intl's limit for fraction digits (ES2023). Smaller values need scientific notation. */
const MAX_INTL_FRACTION_DIGITS = 100;

// ───────────────────────────── exact decimals ─────────────────────────────

/** A finite non-zero double as the shortest decimal that reads back as it: d.ddd × 10^exponent. */
interface Decimal {
  readonly negative: boolean;
  /** Significant digits, first one non-zero. */
  readonly digits: string;
  /** Power of ten of the first digit. */
  readonly exponent: number;
}

function toDecimal(v: number): Decimal {
  // toExponential() without an argument gives the shortest round-trip digits.
  const [mantissa = '0', exp = '0'] = Math.abs(v).toExponential().split('e');
  return { negative: v < 0, digits: mantissa.replace('.', ''), exponent: Number(exp) };
}

/** The decimal × 10^shift as a string Intl formats exactly. */
function decimalString(d: Decimal, shift = 0): string {
  const rest = d.digits.slice(1);
  return `${d.negative ? '-' : ''}${d.digits[0]}${rest ? '.' + rest : ''}e${d.exponent + shift}`;
}

/** Intl.NumberFormat#format for an exact decimal string (typed for numbers only in the ES2022 lib). */
function formatExact(nf: Intl.NumberFormat, value: string): string {
  return (nf.format as unknown as (v: string) => string)(value);
}

/** Power of ten by which the shown number differs from the stored one: a ratio is shown ×100. */
function shownShift(scale: ValueScale): number {
  return scale === 'ratio' ? 2 : 0;
}

/** Power of ten to apply before handing a value to Intl: the percent style multiplies by 100 itself. */
function intlShift(scale: ValueScale): number {
  return scale === 'percent' ? -2 : 0;
}

// ───────────────────────────── readouts ─────────────────────────────

/**
 * Fraction digits a readout shows for a shown value: enough for six significant digits of the fraction,
 * not counting its leading zeros (123456.75 → 2, 0.000123456 → 9, 0.30000000000000004 → 6).
 */
export function readoutFractionDigits(abs: number): number {
  if (abs === 0 || !Number.isFinite(abs)) return 0;
  return fractionDigitsOf(toDecimal(abs), 0);
}

function fractionDigitsOf(d: Decimal, shift: number): number {
  const e = d.exponent + shift;
  // Digit i has power e - i; the fraction starts where that power is negative.
  for (let i = Math.max(0, e + 1); i < d.digits.length; i++) {
    if (d.digits[i] !== '0') return (i - e - 1) + SIGNIFICANT_FRACTION_DIGITS;
  }
  return 0; // an integer
}

/** The default readout of spec F6, without the unit. */
export function defaultReadoutNumber(v: number, locale: string, scale: ValueScale = null): string {
  const style: Intl.NumberFormatOptions = scale ? { style: 'percent' } : {};
  if (!Number.isFinite(v)) return numberFormat(locale, style).format(v);
  if (v === 0) return numberFormat(locale, { ...style, maximumFractionDigits: 0 }).format(0); // no "-0"
  const d = toDecimal(v);
  const digits = fractionDigitsOf(d, shownShift(scale));
  const value = decimalString(d, intlShift(scale));
  if (digits > MAX_INTL_FRACTION_DIGITS) {
    // Below about 1e-94 fixed notation cannot reach the significant digits.
    return formatExact(numberFormat(locale, { ...style, notation: 'scientific', maximumSignificantDigits: SIGNIFICANT_FRACTION_DIGITS }), value);
  }
  try {
    return formatExact(numberFormat(locale, { ...style, maximumFractionDigits: digits }), value);
  } catch {
    // Engines before ES2023 allow at most 20 fraction digits.
    return formatExact(numberFormat(locale, { ...style, maximumFractionDigits: Math.min(digits, 20) }), value);
  }
}

/** Shares of a whole (donut slices): at most one fraction digit (spec F8), rounded as the decimal they are. */
const SHARE_FRACTION_DIGITS = 1;

/** A share (0–1) as a percentage. Values on a percent or ratio scale are readouts (F6), not shares. */
export function shareText(ratio: number, locale: string): string {
  const style: Intl.NumberFormatOptions = { style: 'percent', maximumFractionDigits: SHARE_FRACTION_DIGITS };
  if (!Number.isFinite(ratio) || ratio === 0) return numberFormat(locale, style).format(ratio === 0 ? 0 : ratio);
  return formatExact(numberFormat(locale, style), decimalString(toDecimal(ratio)));
}

/**
 * Appends the unit after a space. A percent or ratio field already shows its percent sign, so a unit of
 * '%' adds nothing; text that already ends with the unit (an author function's output) gets nothing either.
 */
function withUnit(text: string, unit: string | null | undefined, scale: ValueScale): string {
  if (!unit) return text;
  if (scale && unit.trim() === '%') return text;
  if (text.endsWith(unit)) return text;
  return `${text} ${unit}`;
}

/** Calls `report` the first time only. */
export function once(report: ((error: unknown) => void) | null | undefined): (error: unknown) => void {
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
function authorIntl(locale: string, options: Intl.NumberFormatOptions, scale: ValueScale): { format: (v: number) => string; appendUnit: boolean; percent: boolean } {
  const merged: Intl.NumberFormatOptions = scale && options.style === undefined ? { ...options, style: 'percent' } : options;
  const nf = numberFormat(locale, merged);
  const shift = scale === 'percent' && merged.style === 'percent' ? -2 : 0;
  return {
    format: (v: number) => (Number.isFinite(v) && v !== 0 ? formatExact(nf, decimalString(toDecimal(v), shift)) : nf.format(v === 0 ? 0 : v)),
    // Currency and unit styles already carry their own symbol.
    appendUnit: merged.style !== 'currency' && merged.style !== 'unit',
    percent: merged.style === 'percent',
  };
}

/** Readout formatter for one value field: tooltip, table and announcements. */
export function createNumberReadout(spec: NumberReadoutSpec): (v: number) => string {
  const { locale, unit } = spec;
  const scale = spec.scale ?? null;
  const fallback = (v: number): string => withUnit(defaultReadoutNumber(v, locale, scale), unit, scale);
  const report = once(spec.onError);
  const format = spec.format;
  if (format == null) return fallback;
  if (typeof format === 'function') {
    return (v: number) => {
      try {
        return withUnit(String(format(v)), unit, scale);
      } catch (error) {
        report(error);
        return fallback(v);
      }
    };
  }
  let author: ReturnType<typeof authorIntl>;
  try {
    author = authorIntl(locale, format, scale);
    author.format(1); // options are validated on use in some engines
  } catch (error) {
    report(error);
    return fallback;
  }
  const { format: write, appendUnit, percent } = author;
  return (v: number) => (appendUnit ? withUnit(write(v), unit, percent ? 'percent' : null) : write(v));
}

// ───────────────────────────── ticks ─────────────────────────────

/** Ticks of a set this far below the step need more fraction digits than an axis can show: scientific. */
const MAX_TICK_FRACTION_DIGITS = 9;

/**
 * The default tick label: locale grouping, as many fraction digits as the step needs (the same for every
 * tick of a set, so they line up); compact notation when the largest tick is at least a million; scientific
 * notation when the largest tick is at least 10^15 or the step needs more than nine fraction digits. In
 * every notation each tick gets enough significant digits for the step, so neighbours never read the same.
 */
export function defaultTickNumber(value: number, context: TickContext, locale: string, scale: ValueScale = null): string {
  const style: Intl.NumberFormatOptions = scale ? { style: 'percent' } : {};
  const shift = shownShift(scale);
  const v = value === 0 ? 0 : value;
  const exponentOf = (x: number): number => toDecimal(x).exponent + shift;
  const valueExp = v === 0 ? null : exponentOf(v);
  const stepExp = context.step > 0 && Number.isFinite(context.step)
    ? exponentOf(context.step)
    : (valueExp ?? 0) - (SIGNIFICANT_FRACTION_DIGITS - 1);
  const maxExp = context.maxAbs > 0 && Number.isFinite(context.maxAbs) ? exponentOf(context.maxAbs) : (valueExp ?? 0);
  const fractionDigits = Math.max(0, -stepExp);
  const exact = v === 0 ? '0' : decimalString(toDecimal(v), intlShift(scale));
  if (maxExp < 6 && fractionDigits <= MAX_TICK_FRACTION_DIGITS) {
    return formatExact(numberFormat(locale, { ...style, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }), exact);
  }
  if (valueExp === null) return numberFormat(locale, { ...style, maximumFractionDigits: 0 }).format(0);
  // Significant digits that write this tick exactly at the set's step: 10.2M at a 200K step needs three.
  const significant = Math.min(Math.max(valueExp - stepExp + 1, 1), 21);
  const notation: Intl.NumberFormatOptions['notation'] = maxExp >= 15 || fractionDigits > MAX_TICK_FRACTION_DIGITS ? 'scientific' : 'compact';
  return formatExact(numberFormat(locale, { ...style, notation, maximumSignificantDigits: significant }), exact);
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
    author.format(1);
    return value => author.format(value);
  } catch (error) {
    report(error);
    return fallback;
  }
}
