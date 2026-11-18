// A preparation only edits its delta. Publishing applies it in insertion order so a
// retained-window scan can still stop as soon as it reaches rows it should keep.
export class StoreMap<K, V> {
  private changes: Map<K, V> | null = null;
  private removed: Set<K> | null = null;
  private count = 0;

  constructor(private readonly data = new Map<K, V>()) {}

  fork(): StoreMap<K, V> {
    const draft = new StoreMap(this.data);
    draft.changes = new Map();
    draft.removed = new Set();
    draft.count = this.data.size;
    return draft;
  }

  commit(): void {
    if (!this.changes) return;
    for (const key of this.removed!) this.data.delete(key);
    for (const [key, value] of this.changes) this.data.set(key, value);
    this.changes = this.removed = null;
  }

  get size(): number { return this.changes ? this.count : this.data.size; }

  get(key: K): V | undefined {
    const value = this.changes?.get(key);
    if (value !== undefined || this.changes?.has(key) || this.removed?.has(key)) return value;
    return this.data.get(key);
  }

  has(key: K): boolean {
    return Boolean(this.changes?.has(key) || !this.removed?.has(key) && this.data.has(key));
  }

  set(key: K, value: V): void {
    if (!this.changes) {
      this.data.set(key, value);
      return;
    }
    if (!this.has(key)) this.count++;
    this.changes.set(key, value);
  }

  delete(key: K): void {
    if (!this.changes) {
      this.data.delete(key);
      return;
    }
    if (!this.has(key)) return;
    this.count--;
    this.changes.delete(key);
    if (this.data.has(key)) this.removed!.add(key);
  }

  *[Symbol.iterator](): IterableIterator<[K, V]> {
    if (!this.changes) {
      yield* this.data;
      return;
    }
    for (const [key, value] of this.data) {
      if (this.removed!.has(key)) continue;
      yield [key, this.changes.has(key) ? this.changes.get(key)! : value];
    }
    for (const [key, value] of this.changes) {
      if (!this.data.has(key) || this.removed!.has(key)) yield [key, value];
    }
  }

  *keys(): IterableIterator<K> {
    if (!this.changes) yield* this.data.keys();
    else for (const [key] of this) yield key;
  }
}
