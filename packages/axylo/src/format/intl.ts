/**
 * Cached Intl formatters. Constructing one costs far more than formatting with it, and the same few
 * option sets are used for every tick and every readout.
 */

const LIMIT = 256;
const NEGATIVE_ZERO = Symbol();

class Path<T> extends Map<unknown, Path<T>> {
  formatter?: T;
}

class Formats<T> extends Path<T> {
  count = 0;
}

const numberFormats = new Formats<Intl.NumberFormat>();
const dateFormats = new Formats<Intl.DateTimeFormat>();

function cached<O extends object, T>(cache: Formats<T>, Format: new (locale: string, options: O) => T, locale: string, options: O): T {
  const proto = Object.getPrototypeOf(options);
  if (proto !== Object.prototype && proto !== null) return new Format(locale, options);

  // Intl also reads non-enumerable options. Descriptors let it be the first to invoke any getters.
  const names: PropertyKey[] = Object.getOwnPropertyNames(options);
  const symbols = Object.getOwnPropertySymbols(options);
  const count = names.length + symbols.length;
  if (count > 32) return new Format(locale, options);
  if (symbols.length) names.push(...symbols);
  // Reuse the key list to keep the validated values for insertion on a miss.
  const keys: unknown[] = names;
  let path = cache.get(locale);
  for (let i = 0; i < count; i++) {
    const name = names[i]!;
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return new Format(locale, options);
    const value: unknown = descriptor.value;
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') return new Format(locale, options);
    // Map keys preserve types, but SameValueZero would merge the two signed zeros.
    const key = Object.is(value, -0) ? NEGATIVE_ZERO : value;
    keys[count + i] = key;
    path = path?.get(name)?.get(key);
  }
  if (path?.formatter !== undefined) return path.formatter;

  const formatter = new Format(locale, options);
  // Drop the paths as well as the formatters, and only grow the trie after successful construction.
  if (cache.count >= LIMIT) {
    cache.clear();
    cache.count = 0;
  }
  path = descend(cache, locale);
  for (let i = 0; i < count; i++) path = descend(descend(path, keys[i]), keys[count + i]);
  path.formatter = formatter;
  cache.count++;
  return formatter;
}

function descend<T>(path: Path<T>, key: unknown): Path<T> {
  let child = path.get(key);
  if (!child) path.set(key, child = new Path());
  return child;
}

export function numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cached(numberFormats, Intl.NumberFormat, locale, options);
}

export function dateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(dateFormats, Intl.DateTimeFormat, locale, options);
}
