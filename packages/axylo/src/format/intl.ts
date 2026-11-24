/**
 * Cached Intl formatters. Constructing one costs far more than formatting with it, and the same few
 * option sets are used for every tick and every readout.
 */

const LIMIT = 256;
const NEGATIVE_ZERO = Symbol();

class Path<T> extends Map<unknown, Path<T>> {
  f?: T;
  n = 0;
}

let numberFormats: Path<Intl.NumberFormat> | undefined;
let dateFormats: Path<Intl.DateTimeFormat> | undefined;

function cached<O extends object, T>(cache: Path<T>, Format: new (locale: string, options?: O) => T, locale: string, options: O | undefined, literal: boolean): T {
  let path = cache.get(locale);
  if (options === undefined && path?.f !== undefined) return path.f;
  const proto = options === undefined ? null : Object.getPrototypeOf(options);
  if (proto !== Object.prototype && proto !== null) return new Format(locale, options);

  // Only our own option literals are known to have enumerable string data properties.
  // An author's object can have getters even when its prototype is Object.prototype.
  const plain = literal && proto === Object.prototype;
  const keys: unknown[] = options === undefined ? []
    : plain ? Object.keys(options)
    : [...Object.getOwnPropertyNames(options), ...Object.getOwnPropertySymbols(options)];
  const count = keys.length;
  if (count > 32) return new Format(locale, options);
  for (let i = 0; i < count; i++) {
    const name = keys[i] as PropertyKey;
    let value: unknown;
    if (plain) value = options![name as keyof O];
    else {
      const d = Object.getOwnPropertyDescriptor(options, name);
      if (!d || !Object.hasOwn(d, 'value')) return new Format(locale, options);
      value = d.value;
    }
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') return new Format(locale, options);
    // Map keys preserve types, but SameValueZero would merge the two signed zeros.
    const key = Object.is(value, -0) ? NEGATIVE_ZERO : value;
    keys[count + i] = key;
    path = path?.get(name)?.get(key);
  }
  if (path?.f !== undefined) return path.f;

  const formatter = new Format(locale, options);
  // Drop the paths as well as the formatters, and only grow the trie after successful construction.
  if (cache.n >= LIMIT) { cache.clear(); cache.n = 0; }
  path = descend(cache, locale);
  for (let i = 0; i < count; i++) path = descend(descend(path, keys[i]), keys[count + i]);
  path.f = formatter;
  cache.n++;
  return formatter;
}

function descend<T>(path: Path<T>, key: unknown): Path<T> {
  let child = path.get(key);
  if (!child) path.set(key, child = new Path());
  return child;
}

export function numberFormat(locale: string, options?: Intl.NumberFormatOptions, literal = false): Intl.NumberFormat {
  return cached(numberFormats ??= new Path(), Intl.NumberFormat, locale, options, literal);
}

export function dateTimeFormat(locale: string, options?: Intl.DateTimeFormatOptions, literal = false): Intl.DateTimeFormat {
  return cached(dateFormats ??= new Path(), Intl.DateTimeFormat, locale, options, literal);
}

export function isPlainEnglish(locale: string): boolean {
  return locale === 'en' || locale === 'en-US';
}

export const enum DateParts {
  Year = 1, Month = 2, Day = 4, Clock = 8, Seconds = 16, Milliseconds = 32, Zone = 64, Era = 128, Offset = 256,
  MonthDay = Month | Day,
  Date = Year | MonthDay,
}

// Bits follow DateParts order, so a numeric offset replaces a short zone name when both are set.
const dateFields = [
  { year: 'numeric' }, { month: 'short' }, { day: 'numeric' }, { hour: 'numeric', minute: '2-digit' },
  { second: '2-digit' }, { fractionalSecondDigits: 3 }, { timeZoneName: 'short' },
  { era: 'short' }, { timeZoneName: 'shortOffset' },
] satisfies Intl.DateTimeFormatOptions[];

const MONTHS = 'JanFebMarAprMayJunJulAugSepOctNovDec';
const utcFormats: ((value: number) => string)[] = [];
let utcOffset: string | undefined;

const pad = (n: number, len = 2): string => String(n).padStart(len, '0');

function englishUtcFormat(parts: number): (value: number) => string {
  const dp = parts & DateParts.Date;
  const hasClock = (parts & DateParts.Clock) !== 0;
  const hasFrac = (parts & DateParts.Milliseconds) !== 0;
  const hasSec = (parts & DateParts.Seconds) !== 0 || (hasClock && hasFrac);
  const hasTime = hasClock || hasSec || hasFrac;
  return value => {
    const date = new Date(value);
    const rawYear = date.getUTCFullYear();
    if (Number.isNaN(rawYear)) throw new RangeError('Invalid time value');
    const y = rawYear > 0 ? rawYear : 1 - rawYear;
    const m = date.getUTCMonth(), d = date.getUTCDate();
    const mon = MONTHS.slice(m * 3, m * 3 + 3);
    let text = !dp ? (hasTime ? '' : `${m + 1}/${d}/${y}`)
      : dp === 1 ? `${y}`
      : dp === 2 ? mon
      : dp === 3 ? `${mon} ${y}`
      : dp === 4 ? `${d}`
      : dp === 5 ? `${y} (day: ${d})`
      : dp === 6 ? `${mon} ${d}`
      : `${mon} ${d}, ${y}`;
    if (hasTime) {
      if (text) text += ', ';
      if (hasClock) {
        const h = date.getUTCHours();
        // Intl.format emits an ASCII space before AM/PM on V8/Chromium without waking ICU.
        text += `${h % 12 || 12}:${pad(date.getUTCMinutes())}${hasSec ? ':' + pad(date.getUTCSeconds()) : ''}${hasFrac ? '.' + pad(date.getUTCMilliseconds(), 3) : ''}${h < 12 ? ' AM' : ' PM'}`;
      } else {
        if (hasSec) text += date.getUTCSeconds();
        if (hasFrac) text += (hasSec ? '.' : '') + pad(date.getUTCMilliseconds(), 3);
      }
    }
    const zone = parts & DateParts.Offset
      ? (utcOffset ??= (() => {
        const s = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset' }).format(0);
        return s.slice(s.indexOf('AM') + 3);
      })())
      : parts & DateParts.Zone ? 'UTC' : '';
    return zone ? text + (hasTime ? ' ' : ', ') + zone : text;
  };
}

/** Only built-in labels use these fields. Author options always go through dateTimeFormat. */
export function builtInDateFormat(locale: string, timeZone: string, parts: number): (value: number) => string {
  if (timeZone === 'UTC' && !(parts & DateParts.Era) && isPlainEnglish(locale)) {
    const mask = parts & (DateParts.Offset | (DateParts.Era - 1));
    return utcFormats[mask] ??= englishUtcFormat(mask);
  }
  return dateTimeFormat(locale, Object.assign({ timeZone }, ...dateFields.filter((_, i) => parts & (1 << i))), true).format;
}
