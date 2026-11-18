/**
 * Cached Intl formatters. Constructing one costs far more than formatting with it, and the same few
 * option sets are used for every tick and every readout.
 */

const LIMIT = 256;
const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function remember<T>(cache: Map<string, T>, key: string, make: () => T): T {
  let f = cache.get(key);
  if (f === undefined) {
    f = make();
    // A crude bound: option sets come from code and author options, so only a broken caller grows it.
    if (cache.size >= LIMIT) cache.clear();
    cache.set(key, f);
  }
  return f;
}

export function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return remember(numberFormats, locale + '\u0000' + JSON.stringify(options), () => new Intl.NumberFormat(locale, options));
}

export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return remember(dateFormats, locale + '\u0000' + JSON.stringify(options), () => new Intl.DateTimeFormat(locale, options));
}
