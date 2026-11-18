/**
 * The options a chart currently holds, and the patch rule of the commit contract (plan 1.5): a key present in
 * a patch replaces the old value whole, a key set to `undefined` returns to its default (it is removed, and
 * resolution supplies the default), and absent keys stay. No deep merging.
 */

export type OptionRecord = Readonly<Record<string, unknown>>;

/** Keys the controller reads itself and never passes to option resolution. */
export const INTERNAL_KEYS: readonly string[] = ['__renderer'];

export interface Patched {
  readonly next: OptionRecord;
  /** Keys whose value is no longer the same object or primitive. */
  readonly changed: ReadonlySet<string>;
}

/** Applies a patch to `current` without changing it. */
export function applyPatch(current: OptionRecord, patch: unknown): Patched {
  const next: Record<string, unknown> = { ...current };
  const changed = new Set<string>();
  if (patch === null || typeof patch !== 'object') return { next, changed };
  for (const key of Object.keys(patch)) {
    if (INTERNAL_KEYS.includes(key)) continue;
    const value = (patch as Record<string, unknown>)[key];
    const had = Object.hasOwn(current, key);
    if (value === undefined) {
      if (had) {
        delete next[key];
        changed.add(key);
      }
      continue;
    }
    if (!had || !Object.is(current[key], value)) changed.add(key);
    next[key] = value;
  }
  return { next, changed };
}

/** Holds the accepted options. A rejected call never reaches `commit`, so the store stays on the last valid state. */
export class OptionsStore {
  private value: OptionRecord;

  constructor(initial: unknown) {
    this.value = applyPatch({}, initial).next;
  }

  get current(): OptionRecord {
    return this.value;
  }

  /** What `patch` would give, without accepting it. */
  preview(patch: unknown): Patched {
    return applyPatch(this.value, patch);
  }

  commit(next: OptionRecord): void {
    this.value = next;
  }
}

/**
 * Structural equality for option values that describe encoding (field specs, domains, references): plain
 * objects and arrays by content, functions and everything else by identity. Data is never compared this way.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (isPlain(a) && isPlain(b)) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(key => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  return false;
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
