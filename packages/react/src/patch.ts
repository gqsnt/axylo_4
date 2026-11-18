/**
 * Props to options, and options to the patch `chart.update` receives (plan 1.7). Pure, so it runs in Node.
 */
import type { Diagnostic } from 'axylo';

export type Options = Record<string, unknown>;

/**
 * Props that belong to the component and never reach the core: the container's attributes and the event
 * props. `aria-*` is deliberately not among them: the chart names itself through `title` or `labelledBy`, so
 * an `aria-label` reaches core validation and the author is told it is not an option (AX150).
 */
const OWN = new Set(['id', 'className', 'style', 'onHover', 'onSelect', 'onZoom', 'children']);

/** Props rendered on the container <div>. */
export const isHostProp = (key: string): boolean => key === 'id' || key === 'style' || key.startsWith('data-');

const isContainerProp = (key: string): boolean => OWN.has(key) || key.startsWith('data-');

const has = (o: object, key: PropertyKey): boolean => Object.hasOwn(o, key);

/** Sets an own property without going through setters, so a key named `__proto__` stays a key. */
const put = (o: Options, key: string, value: unknown): void => {
  Object.defineProperty(o, key, { value, enumerable: true, writable: true, configurable: true });
};

/**
 * The options a set of props stands for. A given `onDiagnostic` is replaced by the component's own stable
 * forwarder, so a new handler function is not a change the chart needs to hear about.
 */
export function optionsOf(props: Options, onDiagnostic: (diagnostic: Diagnostic) => void): Options {
  const options: Options = {};
  for (const key of Object.keys(props)) {
    if (!isContainerProp(key)) put(options, key, key === 'onDiagnostic' && props[key] ? onDiagnostic : props[key]);
  }
  return options;
}

/**
 * What changed from `previous` to `next`, or null. `data` is compared by identity (comparing rows would cost
 * as much as normalizing them); everything else structurally, so inline objects and arrays do not count as
 * changes. Presence counts as well as value (plan 1.5): a key that is gone, or that appears set to
 * `undefined`, is sent as an own `undefined`, which the core reads as "back to the default". Option values
 * are assumed immutable: a value changed in place under the same reference is not seen.
 */
export function diff(previous: Options, next: Options): Options | null {
  let patch: Options | null = null;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const a = has(previous, key) ? previous[key] : undefined;
    const b = has(next, key) ? next[key] : undefined;
    const same = has(previous, key) === has(next, key) && (key === 'data' ? a === b : equal(a, b));
    if (!same) put(patch ??= {}, key, b);
  }
  return patch;
}

/**
 * Structural equality over plain objects (own keys, enumerable or not), arrays (holes count) and dates.
 * Functions, React elements, class instances and anything else by identity. Never throws. A cycle is not an
 * option shape: once one is found (an object met again inside itself) it is compared by identity, so two
 * distinct cyclic values are a change. A getter that throws makes the values unequal.
 */
export function equal(a: unknown, b: unknown): boolean {
  try {
    return same(a, b, new Set(), new Set());
  } catch {
    return false;
  }
}

function same(a: unknown, b: unknown, insideA: Set<object>, insideB: Set<object>): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  const arrays = Array.isArray(a);
  if (arrays !== Array.isArray(b) || (!arrays && (!plain(a) || !plain(b)))) return false;
  // Already being compared further up: a cycle, and these are not the same object.
  if (insideA.has(a) || insideB.has(b)) return false;
  insideA.add(a);
  insideB.add(b);
  let result: boolean;
  if (arrays) {
    const x = a as unknown as unknown[];
    const y = b as unknown as unknown[];
    result = x.length === y.length;
    for (let i = 0; result && i < x.length; i++) result = has(x, i) === has(y, i) && same(x[i], y[i], insideA, insideB);
  } else {
    const keys = Reflect.ownKeys(a);
    result = keys.length === Reflect.ownKeys(b).length && keys.every(k => has(b, k) && same(a[k as string], b[k as string], insideA, insideB));
  }
  insideA.delete(a);
  insideB.delete(b);
  return result;
}

/** The fields the options plot: what the memoization hint samples. */
export function fieldsOf(options: Options): string[] {
  const names: string[] = [];
  const add = (spec: unknown): void => {
    if (typeof spec === 'string') names.push(spec);
    else if (Array.isArray(spec)) spec.forEach(add);
    else if (isObject(spec) && typeof spec.field === 'string') names.push(spec.field);
  };
  for (const key of ['x', 'y', 'series', 'label', 'value']) if (has(options, key)) add(options[key]);
  return names;
}

/**
 * Whether new data is probably the old data rebuilt, judged from a sample of the plotted fields: same
 * length and the same first and last values. A cheap guess for a development hint, never for behavior; the
 * hint says that is all it checked. Best effort: a value that cannot be read means "not the same".
 */
export function looksSame(a: unknown, b: unknown, fields: readonly string[]): boolean {
  try {
    if (Array.isArray(a) && Array.isArray(b)) {
      const n = a.length;
      return n === b.length && (n === 0 || fields.every(f => endpointsMatch(a[0], b[0], f) && endpointsMatch(a[n - 1], b[n - 1], f)));
    }
    if (!isObject(a) || !isObject(b) || !isObject(a.columns) || !isObject(b.columns)) return false;
    const x = a.columns;
    const y = b.columns;
    return fields.every(f => column(x[f], y[f]));
  } catch {
    return false;
  }
}

function endpointsMatch(a: unknown, b: unknown, field: string): boolean {
  return isObject(a) && isObject(b) && scalar(a[field], b[field]);
}

function scalar(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || (a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime()));
}

function column(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const x = a as ArrayLike<unknown> | null;
  const y = b as ArrayLike<unknown> | null;
  return !!x && !!y && x.length === y.length && scalar(x[0], y[0]) && scalar(x[x.length - 1], y[y.length - 1]);
}

function isObject(value: unknown): value is Options {
  return typeof value === 'object' && value !== null;
}

/** A plain object literal. React elements are plain too, but they are never options: they stay opaque. */
function plain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && !has(value, '$$typeof');
}
