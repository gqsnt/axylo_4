import { BufferWindow } from './labels';

export { BufferWindow, Labels } from './labels';

type NumericArray = Float64Array | Int32Array | Uint8Array;

export class Column<T extends NumericArray> {
  private data: T;
  #range: BufferWindow;
  #allocate: (size: number) => T;

  constructor(allocate: (size: number) => T, input: T, range?: BufferWindow) {
    this.#allocate = allocate;
    if (range) {
      this.data = input;
      this.#range = range;
      return;
    }
    this.#range = new BufferWindow(0, input.length);
    // The store opens on the first append to a static chart (spec P7 measures that copy): a large
    // column gets a small tail. Later growth doubles the window.
    this.data = allocate(input.length + Math.max(16, Math.min(Math.ceil(input.length / 8), 4096)));
    this.data.set(input);
  }

  view(): T {
    return this.data.subarray(this.#range.start, this.#range.end) as T;
  }

  fork(): Column<T> {
    return new Column(this.#allocate, this.data, this.#range.fork());
  }

  append(values: T): void {
    const capacity = this.#range.reserve(values.length, this.data.length);
    if (capacity) this.#resize(capacity, values.length);
    this.data.set(values, this.#range.end);
    this.#range.end += values.length;
  }

  drop(count: number): void {
    this.#range.start += count;
    const capacity = this.#range.compact(this.data.length);
    if (capacity) this.#resize(capacity, 0);
  }

  #resize(capacity: number, extra: number): void {
    const next = this.#allocate(capacity);
    next.set(this.view());
    this.data = next;
    this.#range.rebase(extra);
  }
}
