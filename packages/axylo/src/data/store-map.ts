// A preparation only edits its delta. Publishing applies it in insertion order so a
// retained-window scan can still stop as soon as it reaches rows it should keep.
const noKey = Symbol();

function sameKey(a: unknown, b: unknown): boolean { return a === b || a !== a && b !== b; }

// Committed reads and writes are ordinary Map operations. Only a preparation needs an overlay.
export interface StoreMap<K, V> extends Iterable<[K, V]> {
  readonly size: number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): void;
  delete(key: K): void;
  keys(): IterableIterator<K>;
  fork(): StoreMap<K, V>;
  commit(): StoreMap<K, V>;
}
export const StoreMap = class<K, V> extends Map<K, V> implements StoreMap<K, V> {
  fork(): StoreMap<K, V> { return new DraftMap(this); }
  commit(): this { return this; }
};

class DraftMap<K, V> implements StoreMap<K, V> {
  #key: K | typeof noKey = noKey;
  #value: V | undefined;
  #deleted: K | typeof noKey = noKey;
  #changes: Map<K, V> | null = null;
  #removed: Set<K> | null = null;
  size: number;

  readonly #data: StoreMap<K, V>;
  constructor(data: StoreMap<K, V>) { this.#data = data; this.size = data.size; }

  fork(): StoreMap<K, V> { return this.#data.fork(); }

  commit(): StoreMap<K, V> {
    if (this.#deleted !== noKey) this.#data.delete(this.#deleted);
    if (this.#removed) for (const key of this.#removed) this.#data.delete(key);
    if (this.#key !== noKey) this.#data.set(this.#key, this.#value!);
    if (this.#changes) for (const [key, value] of this.#changes) this.#data.set(key, value);
    return this.#data;
  }

  #changed(key: K): boolean {
    return sameKey(key, this.#key) || !!this.#changes?.has(key);
  }

  #isRemoved(key: K): boolean {
    return sameKey(key, this.#deleted) || !!this.#removed?.has(key);
  }

  get(key: K): V | undefined {
    if (sameKey(key, this.#key)) return this.#value;
    if (this.#changes?.has(key)) return this.#changes.get(key);
    if (this.#isRemoved(key)) return;
    return this.#data.get(key);
  }

  has(key: K): boolean {
    return this.#changed(key) || !this.#isRemoved(key) && this.#data.has(key);
  }

  set(key: K, value: V): void {
    if (!this.has(key)) this.size++;
    // The first write and first removal fit inline for a sliding single-row window.
    // Spill subsequent writes in insertion order, including reinsertion after deletion.
    if (sameKey(key, this.#key) || this.#key === noKey && !this.#changes?.size) {
      this.#key = key;
      this.#value = value;
    } else (this.#changes ??= new Map()).set(key, value);
  }

  delete(key: K): void {
    if (!this.has(key)) return;
    this.size--;
    if (sameKey(key, this.#key)) {
      this.#key = noKey;
      this.#value = undefined;
    } else this.#changes?.delete(key);
    if (this.#data.has(key) && !this.#isRemoved(key)) {
      if (this.#deleted === noKey) this.#deleted = key;
      else (this.#removed ??= new Set()).add(key);
    }
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    for (const [key, value] of this.#data) {
      if (!this.#isRemoved(key)) yield [key, this.#changed(key) ? this.get(key)! : value];
    }
    const key = this.#key;
    if (key !== noKey && (!this.#data.has(key) || this.#isRemoved(key))) yield [key === 0 ? 0 as K : key, this.#value!];
    if (this.#changes) for (const entry of this.#changes) {
      if (!this.#data.has(entry[0]) || this.#isRemoved(entry[0])) yield entry;
    }
  }

  *keys(): IterableIterator<K> {
    for (const [key] of this) yield key;
  }
}

/** Keep the keys and insertion order when a draft needs its own values. */
export function mapValues<K, V, T>(source: ReadonlyMap<K, V>, copy: (value: V) => T): Map<K, T> {
  const result = new Map<K, T>();
  for (const [key, value] of source) result.set(key, copy(value));
  return result;
}
