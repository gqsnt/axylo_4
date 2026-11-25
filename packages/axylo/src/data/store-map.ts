// A preparation only edits its delta. Publishing applies it in insertion order so a
// retained-window scan can still stop as soon as it reaches rows it should keep.
const noKey = Symbol();

function sameKey(a: unknown, b: unknown): boolean { return a === b || a !== a && b !== b; }

export class StoreMap<K, V> {
  #key: K | typeof noKey = noKey;
  #value: V | undefined;
  #deleted: K | typeof noKey = noKey;
  #changes: Map<K, V> | null = null;
  #removed: Set<K> | null = null;
  #count = -1;

  constructor(private readonly data = new Map<K, V>()) {}

  fork(): StoreMap<K, V> {
    const draft = new StoreMap(this.data);
    draft.#count = this.data.size;
    return draft;
  }

  commit(): void {
    if (this.#count < 0) return;
    if (this.#removed) {
      for (const key of this.#removed) this.data.delete(key);
    } else if (this.#deleted !== noKey) this.data.delete(this.#deleted);
    if (this.#changes) {
      for (const [key, value] of this.#changes) this.data.set(key, value);
    } else if (this.#key !== noKey) this.data.set(this.#key, this.#value!);
    this.#count = -1;
    this.#key = this.#deleted = noKey;
    this.#value = undefined;
    this.#changes = this.#removed = null;
  }

  get size(): number { return this.#count < 0 ? this.data.size : this.#count; }

  #hasChange(key: K): boolean {
    return this.#changes ? this.#changes.has(key) : sameKey(key, this.#key);
  }

  #isRemoved(key: K): boolean {
    return this.#removed ? this.#removed.has(key) : sameKey(key, this.#deleted);
  }

  get(key: K): V | undefined {
    if (this.#count < 0) return this.data.get(key);
    if (this.#changes) {
      if (this.#changes.has(key)) return this.#changes.get(key);
    } else if (sameKey(key, this.#key)) return this.#value;
    return this.#isRemoved(key) ? undefined : this.data.get(key);
  }

  has(key: K): boolean {
    return this.#count < 0 ? this.data.has(key)
      : this.#hasChange(key) || !this.#isRemoved(key) && this.data.has(key);
  }

  set(key: K, value: V): void {
    if (this.#count < 0) {
      this.data.set(key, value);
      return;
    }
    if (!this.has(key)) this.#count++;
    if (this.#changes) this.#changes.set(key, value);
    else if (this.#key === noKey || sameKey(key, this.#key)) {
      this.#key = key;
      this.#value = value;
    } else {
      this.#changes = new Map<K, V>();
      this.#changes.set(this.#key, this.#value!);
      this.#changes.set(key, value);
      this.#key = noKey;
      this.#value = undefined;
    }
  }

  delete(key: K): void {
    if (this.#count < 0) {
      this.data.delete(key);
      return;
    }
    const existing = this.data.has(key);
    if (this.#changes) {
      if (!this.#changes.delete(key) && (!existing || this.#isRemoved(key))) return;
    } else if (sameKey(key, this.#key)) {
      this.#key = noKey;
      this.#value = undefined;
    } else if (!existing || this.#isRemoved(key)) return;
    this.#count--;
    if (!existing) return;
    if (this.#removed) this.#removed.add(key);
    else if (this.#deleted === noKey) this.#deleted = key;
    else if (!sameKey(key, this.#deleted)) {
      this.#removed = new Set<K>().add(this.#deleted).add(key);
      this.#deleted = noKey;
    }
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    if (this.#count < 0) {
      yield* this.data;
      return;
    }
    for (const [key, value] of this.data) {
      if (this.#isRemoved(key)) continue;
      yield [key, this.#hasChange(key) ? this.get(key)! : value];
    }
    if (this.#changes) {
      for (const [key, value] of this.#changes) {
        if (!this.data.has(key) || this.#isRemoved(key)) yield [key, value];
      }
    } else {
      const key = this.#key;
      if (key !== noKey && (!this.data.has(key) || this.#isRemoved(key))) yield [key === 0 ? 0 as K : key, this.#value!];
    }
  }

  *keys(): IterableIterator<K> {
    if (this.#count < 0) yield* this.data.keys();
    else for (const [key] of this) yield key;
  }
}

/** Keep the keys and insertion order when a draft needs its own values. */
export function mapValues<K, V, T>(source: ReadonlyMap<K, V>, copy: (value: V) => T): Map<K, T> {
  const result = new Map<K, T>();
  for (const [key, value] of source) result.set(key, copy(value));
  return result;
}
