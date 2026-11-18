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

/**
 * The options a set of props stands for. A given `onDiagnostic` is replaced by the component's own stable
 * forwarder, so a new handler function is not a change the chart needs to hear about.
 */
export function optionsOf(props: Options, onDiagnostic: (diagnostic: Diagnostic) => void): Options {
  const options: Options = {};
  for (const key of Object.keys(props)) {
    if (!isContainerProp(key)) options[key] = key === 'onDiagnostic' && props[key] ? onDiagnostic : props[key];
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
    if (!same) (patch ??= {})[key] = b;
  }
  return patch;
}

/**
 * Structural equality over plain objects (own keys, enumerable or not), arrays (holes count) and dates.
 * Functions, React elements, class instances and anything else by identity. Never throws: a cycle is
 * cut by the pairs already being compared, and a getter that throws makes the values unequal.
 */
export function equal(a: unknown, b: unknown): boolean {
  try {
    return same(a, b, new Map());
  } catch {
    return false;
  }
}

function same(a: unknown, b: unknown, open: Map<object, Set<object>>): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  const arrays = Array.isArray(a);
  if (arrays !== Array.isArray(b) || (!arrays && (!plain(a) || !plain(b)))) return false;
  // A pair already under comparison further up: equal unless something else differs.
  let seen = open.get(a);
  if (seen?.has(b)) return true;
  if (!seen) open.set(a, seen = new Set());
  seen.add(b);
  if (arrays) {
    const x = a as unknown as unknown[];
    const y = b as unknown as unknown[];
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if ((i in x) !== (i in y) || !same(x[i], y[i], open)) return false;
    return true;
  }
  const keys = Reflect.ownKeys(a);
  if (keys.length !== Reflect.ownKeys(b).length) return false;
  return keys.every(k => has(b, k) && same(a[k as string], b[k as string], open));
}

/**
 * Whether new data is probably the old data rebuilt, judged from a sample: same length and the same first
 * and last rows (or columns with the same length and endpoints). A cheap guess for a development hint,
 * never for behavior; the hint says that is all it checked.
 */
export function looksSame(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && shallow(a[0], b[0], scalar) && shallow(a[a.length - 1], b[b.length - 1], scalar);
  }
  return isObject(a) && isObject(b) && isObject(a.columns) && isObject(b.columns) && shallow(a.columns, b.columns, column);
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

function shallow(a: unknown, b: unknown, eq: (x: unknown, y: unknown) => boolean): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => has(b, k) && eq(a[k], b[k]));
}

function isObject(value: unknown): value is Options {
  return typeof value === 'object' && value !== null;
}

/** A plain object literal. React elements are plain too, but they are never options: they stay opaque. */
function plain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && !has(value, '$$typeof');
}
