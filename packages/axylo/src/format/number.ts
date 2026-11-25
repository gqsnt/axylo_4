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
import { isPlainEnglish, numberFormat } from './intl';

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
/** Ticks of a set this far below the step need more fraction digits than an axis can show: scientific. */
const MAX_TICK_FRACTION_DIGITS = 9;

// ───────────────────────────── exact decimals ─────────────────────────────

/** A finite non-zero double as the shortest decimal that reads back as it: d.ddd × 10^e. */
type Decimal = readonly [mantissa: string, exponent: number];

function toDecimal(v: number): Decimal {
  // toExponential() without an argument gives the shortest round-trip digits.
  const text = v.toExponential();
  const e = text.indexOf('e');
  return e < 0 ? [text, 0] : [text.slice(0, e), Number(text.slice(e + 1))];
}

const decimalString = (d: Decimal, shift = 0): string => `${d[0]}e${d[1] + shift}`;
const formatExact = (nf: Intl.NumberFormat, value: string): string => (nf.format as unknown as (v: string) => string)(value);

function groupEnglishInteger(integer: string): string {
  const sign = integer[0] === '-' ? 1 : 0;
  const length = integer.length - sign;
  if (length <= 3) return integer;
  const first = sign + (length % 3 || 3);
  let grouped = integer.slice(0, first);
  for (let i = first; i < integer.length; i += 3) grouped += ',' + integer.slice(i, i + 3);
  return grouped;
}

function decimalDigits(mantissa: string): string {
  const start = mantissa[0] === '-' ? 1 : 0;
  return mantissa.length > start + 1 ? mantissa[start] + mantissa.slice(start + 2) : mantissa.slice(start);
}

/** Standard decimal and percent notation for en and en-US. Null represents a normalized zero. */
function englishDecimal(d: Decimal | null, scale: ValueScale, max: number, min = 0): string {
  return writeEnglishDecimal(d ? decimalDigits(d[0]) : '', d ? d[1] + (scale === 'ratio' ? 3 : 1) : 0,
    d?.[0][0] === '-', scale, max, min);
}

function writeEnglishDecimal(digits: string, point: number, negative: boolean, scale: ValueScale, max: number, min = 0): string {
  const keep = point + max;
  if (keep < digits.length) {
    if (keep >= 0 && digits.charCodeAt(keep) >= 53) {
      // Intl's halfExpand rounds the magnitude up on a tie. Carry exactly even past 2^53.
      const prefix = digits.slice(0, keep);
      digits = keep <= 15 ? String(Number(prefix) + 1) : String(BigInt(prefix) + 1n);
      point += digits.length - keep;
    } else digits = digits.slice(0, Math.max(0, keep));
  }
  const int = digits && point > 0 ? digits.slice(0, point).padEnd(point, '0') : '0';
  const start = Math.max(0, point);
  let end = digits.length;
  while (end > start && digits.charCodeAt(end - 1) === 48) end--;
  const fraction = end > start ? (point < 0 ? '0'.repeat(-point) : '') + digits.slice(start, end) : '';
  const frac = fraction.padEnd(min, '0');
  return (negative ? '-' : '') + groupEnglishInteger(int) + (frac ? '.' + frac : '') + (scale ? '%' : '');
}

function englishReadout(value: number): string | undefined {
  // Fixed Number#toString uses the same shortest decimal digits as toExponential.
  const text = String(value);
  if (text.includes('e')) return;
  const dot = text.indexOf('.');
  if (dot < 0) return groupEnglishInteger(text);
  let first = dot + 1;
  while (text.charCodeAt(first) === 48) first++;
  const end = first + SIGNIFICANT_FRACTION_DIGITS;
  if (end >= text.length) return groupEnglishInteger(text.slice(0, dot)) + text.slice(dot);
  const negative = value < 0;
  const start = negative ? 1 : 0;
  const leadingZero = text[start] === '0';
  const digits = leadingZero ? text.slice(first) : text.slice(start, dot) + text.slice(dot + 1);
  const point = leadingZero ? dot + 1 - first : dot - start;
  return writeEnglishDecimal(digits, point, negative, null, end - dot - 1);
}

// ───────────────────────────── readouts ─────────────────────────────

/**
 * Fraction digits a readout shows for a shown value: enough for six significant digits of the fraction,
 * not counting its leading zeros (123456.75 → 2, 0.000123456 → 9, 0.30000000000000004 → 6).
 */
export function readoutFractionDigits(abs: number): number {
  if (!abs || !Number.isFinite(abs)) return 0;
  const [mantissa, exponent] = toDecimal(abs);
  return fractionDigitsOf(decimalDigits(mantissa), exponent + 1);
}

function fractionDigitsOf(digits: string, point: number): number {
  for (let i = Math.max(0, point); i < digits.length; i++) {
    if (digits.charCodeAt(i) !== 48) return i - point + SIGNIFICANT_FRACTION_DIGITS;
  }
  return 0;
}

/** The default readout of spec F6, without the unit. */
export function defaultReadoutNumber(v: number, locale: string, scale: ValueScale = null): string {
  const english = isPlainEnglish(locale);
  if (!scale && Number.isSafeInteger(v)) return english ? groupEnglishInteger(String(v)) : numberFormat(locale).format(v || 0);
  if (english && v === 0) return '0%';
  const finite = Number.isFinite(v);
  if (english && finite && !scale) {
    const text = englishReadout(v);
    if (text !== undefined) return text;
  }
  const d = finite && v !== 0 ? toDecimal(v) : null;
  const point = d ? d[1] + (scale === 'ratio' ? 3 : 1) : 0;
  const mantissa = d ? decimalDigits(d[0]) : '';
  const digits = fractionDigitsOf(mantissa, point);
  if (english && d && digits <= MAX_INTL_FRACTION_DIGITS) return writeEnglishDecimal(mantissa, point, v < 0, scale, digits);

  const style: Intl.NumberFormatOptions = scale ? { style: 'percent' } : {};
  if (!finite) return numberFormat(locale, style, true).format(v);
  if (!d) return numberFormat(locale, { ...style, maximumFractionDigits: 0 }, true).format(0); // no "-0"
  const value = decimalString(d, scale === 'percent' ? -2 : 0);
  if (digits > MAX_INTL_FRACTION_DIGITS) {
    // Below about 1e-94 fixed notation cannot reach the significant digits.
    return formatExact(numberFormat(locale, { ...style, notation: 'scientific', maximumSignificantDigits: SIGNIFICANT_FRACTION_DIGITS }, true), value);
  }
  try {
    return formatExact(numberFormat(locale, { ...style, maximumFractionDigits: digits }, true), value);
  } catch {
    // Engines before ES2023 allow at most 20 fraction digits.
    return formatExact(numberFormat(locale, { ...style, maximumFractionDigits: Math.min(digits, 20) }, true), value);
  }
}

/** A share (0–1) as a percentage (at most one fraction digit, spec F8). */
export function shareText(ratio: number, locale: string): string {
  if (isPlainEnglish(locale) && Number.isFinite(ratio)) return englishDecimal(ratio ? toDecimal(ratio) : null, 'ratio', 1);
  const nf = numberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }, true);
  return !Number.isFinite(ratio) || !ratio ? nf.format(ratio === 0 ? 0 : ratio) : formatExact(nf, decimalString(toDecimal(ratio)));
}

/** Appends the unit after a space unless percent/ratio already carries '%' or text already ends with it. */
function withUnit(text: string, unit: string | null | undefined, scale: ValueScale): string {
  return !unit || (scale && unit.trim() === '%') || text.endsWith(unit) ? text : `${text} ${unit}`;
}

/** Calls `report` the first time only. */
export function once(report: ((error: unknown) => void) | null | undefined): (error: unknown) => void {
  let done = false;
  return error => {
    if (done || !report) return;
    done = true;
    report(error);
  };
}

function authorFormat<A extends unknown[]>(
  locale: string,
  scale: ValueScale,
  format: NumberFormatOption | null | undefined,
  onError: ((error: unknown) => void) | null | undefined,
  fallback: (v: number, ...rest: A) => string,
  unit?: string | null,
): (v: number, ...rest: A) => string {
  if (format == null) return fallback;
  const report = once(onError);
  if (typeof format === 'function') {
    return (v, ...rest) => {
      try {
        const text = String(format(v));
        return unit ? withUnit(text, unit, scale) : text;
      } catch (error) {
        report(error);
        return fallback(v, ...rest);
      }
    };
  }
  try {
    const merged: Intl.NumberFormatOptions = scale && format.style === undefined ? { ...format, style: 'percent' } : format;
    const nf = numberFormat(locale, merged);
    const shift = scale === 'percent' && merged.style === 'percent' ? -2 : 0;
    const write = (v: number) => (Number.isFinite(v) && v !== 0 ? formatExact(nf, decimalString(toDecimal(v), shift)) : nf.format(v === 0 ? 0 : v));
    write(1); // options are validated on use in some engines
    const addUnit = Boolean(unit && merged.style !== 'currency' && merged.style !== 'unit');
    const pct: ValueScale = merged.style === 'percent' ? 'percent' : null;
    return (v: number, ..._rest: A) => { void _rest; return addUnit ? withUnit(write(v), unit, pct) : write(v); };
  } catch (error) {
    report(error);
    return fallback;
  }
}

/** Readout formatter for one value field: tooltip, table and announcements. */
export function createNumberReadout(spec: NumberReadoutSpec): (v: number) => string {
  const { locale, unit, format, onError } = spec, scale = spec.scale ?? null;
  return authorFormat(locale, scale, format, onError, v => withUnit(defaultReadoutNumber(v, locale, scale), unit, scale), unit);
}

// ───────────────────────────── ticks ─────────────────────────────

/**
 * The default tick label: locale grouping, as many fraction digits as the step needs (the same for every
 * tick of a set, so they line up); compact notation when the largest tick is at least a million; scientific
 * notation when the largest tick is at least 10^15 or the step needs more than nine fraction digits. In
 * every notation each tick gets enough significant digits for the step, so neighbours never read the same.
 */
export function defaultTickNumber(value: number, context: TickContext, locale: string, scale: ValueScale = null): string {
  const v = value === 0 ? 0 : value;
  if (!scale && Number.isSafeInteger(v) && context.step >= 1 && Number.isFinite(context.step) && context.maxAbs > 0 && context.maxAbs < 1e6) {
    return defaultReadoutNumber(v, locale);
  }
  const shift = scale === 'ratio' ? 2 : 0;
  const decimal = v === 0 ? null : toDecimal(v);
  const exp = (x: number) => toDecimal(x)[1] + shift;
  const valueExp = decimal ? decimal[1] + shift : 0;
  const stepExp = context.step > 0 && Number.isFinite(context.step) ? exp(context.step) : valueExp - (SIGNIFICANT_FRACTION_DIGITS - 1);
  const maxExp = context.maxAbs > 0 && Number.isFinite(context.maxAbs) ? exp(context.maxAbs) : valueExp;
  const fractionDigits = Math.max(0, -stepExp);
  const fixed = maxExp < 6 && fractionDigits <= MAX_TICK_FRACTION_DIGITS;
  if (isPlainEnglish(locale)) {
    if (fixed && Number.isFinite(v)) return englishDecimal(decimal, scale, fractionDigits, fractionDigits);
    if (!decimal) return scale ? '0%' : '0';
  }
  const options: Intl.NumberFormatOptions = scale ? { style: 'percent' } : {};
  if (fixed) options.minimumFractionDigits = options.maximumFractionDigits = fractionDigits;
  else if (decimal) {
    options.notation = maxExp >= 15 || fractionDigits > MAX_TICK_FRACTION_DIGITS ? 'scientific' : 'compact';
    options.maximumSignificantDigits = Math.min(Math.max(valueExp - stepExp + 1, 1), 21);
  } else options.maximumFractionDigits = 0;
  return formatExact(numberFormat(locale, options, true), decimal ? decimalString(decimal, scale === 'percent' ? -2 : 0) : '0');
}

/** Tick labeler for a value axis (or a numeric x axis). */
export function createNumberTickLabeler(spec: NumberTickSpec): TickLabeler {
  const { locale, tickFormat, onError } = spec, scale = spec.scale ?? null;
  return authorFormat(locale, scale, tickFormat, onError, (v, ctx) => defaultTickNumber(v, ctx, locale, scale));
}
