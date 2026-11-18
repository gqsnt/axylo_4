/**
 * Props to options, and options to the patch `chart.update` receives (plan 1.7). Pure, so it runs in Node.
 */
import type { Diagnostic } from 'axylo';

export type Options = Record<string, unknown>;

/** Props that belong to the component and never reach the core. */
const OWN = new Set(['className', 'style', 'onHover', 'onSelect', 'onZoom', 'children']);

/**
 * The options a set of props stands for. A given `onDiagnostic` is replaced by the component's own stable
 * forwarder, so a new handler function is not a change the chart needs to hear about.
 */
export function optionsOf(props: Options, onDiagnostic: (diagnostic: Diagnostic) => void): Options {
  const options: Options = {};
  for (const key in props) {
    if (!OWN.has(key)) options[key] = key === 'onDiagnostic' && props[key] ? onDiagnostic : props[key];
  }
  return options;
}

/**
 * What changed from `previous` to `next`, or null. `data` is compared by identity (comparing rows would cost
 * as much as normalizing them); everything else structurally, so inline objects and arrays do not count as
 * changes. A key that is gone is sent as `undefined`, which the core reads as "back to the default".
 */
export function diff(previous: Options, next: Options): Options | null {
  let patch: Options | null = null;
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const a = previous[key];
    const b = next[key];
    if (key === 'data' ? a !== b : !equal(a, b)) (patch ??= {})[key] = b;
  }
  return patch;
}

/** Structural equality over plain objects, arrays and dates. Functions and other objects by identity. */
export function equal(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (a instanceof Date) return b instanceof Date && Object.is(a.getTime(), b.getTime());
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (!plain(a) || !plain(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

/**
 * Whether new data is probably the old data rebuilt: same length and shallow-equal first and last rows, or
 * the same typed columns in a new wrapper. A cheap guess for a development hint, never for behavior.
 */
export function looksSame(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && shallow(a[0], b[0]) && shallow(a[a.length - 1], b[b.length - 1]);
  }
  return isObject(a) && isObject(b) && isObject(a.columns) && shallow(a.columns, b.columns);
}

function shallow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
}

function isObject(value: unknown): value is Options {
  return typeof value === 'object' && value !== null;
}

function plain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
