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

let numberFormats: Formats<Intl.NumberFormat> | undefined;
let dateFormats: Formats<Intl.DateTimeFormat> | undefined;

function cached<O extends object, T>(cache: Formats<T>, Format: new (locale: string, options?: O) => T, locale: string, options: O | undefined, literal: boolean): T {
  let path = cache.get(locale);
  if (options === undefined && path?.formatter !== undefined) return path.formatter;
  const proto = options === undefined ? null : Object.getPrototypeOf(options);
  if (proto !== Object.prototype && proto !== null) return new Format(locale, options);

  // Only our own option literals are known to have enumerable string data properties.
  // An author's object can have getters even when its prototype is Object.prototype.
  const plain = literal && proto === Object.prototype;
  const names: PropertyKey[] = options === undefined ? [] : plain ? Object.keys(options) : Object.getOwnPropertyNames(options);
  const symbols = options !== undefined && !plain ? Object.getOwnPropertySymbols(options) : [];
  const count = names.length + symbols.length;
  if (count > 32) return new Format(locale, options);
  if (symbols.length) names.push(...symbols);
  // Reuse the key list to keep the validated values for insertion on a miss.
  const keys: unknown[] = names;
  for (let i = 0; i < count; i++) {
    const name = names[i]!;
    let value: unknown;
    if (plain) value = options![name as keyof O];
    else {
      const descriptor = Object.getOwnPropertyDescriptor(options, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return new Format(locale, options);
      value = descriptor.value;
    }
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

export function numberFormat(locale: string, options?: Intl.NumberFormatOptions, literal = false): Intl.NumberFormat {
  return cached(numberFormats ??= new Formats(), Intl.NumberFormat, locale, options, literal);
}

export function dateTimeFormat(locale: string, options?: Intl.DateTimeFormatOptions, literal = false): Intl.DateTimeFormat {
  return cached(dateFormats ??= new Formats(), Intl.DateTimeFormat, locale, options, literal);
}
