import { BufferWindow } from './labels';

export { BufferWindow, Labels } from './labels';

type NumericArray = Float64Array | Int32Array | Uint8Array;

// Spare slots when storage opens. The store opens on the first append to a static chart, so the copy
// made here is what P7 measures: a large chart gets only a small tail. Later growth doubles the window.
export function openingCapacity(length: number): number {
  return length + Math.max(16, Math.min(Math.ceil(length / 8), 4096));
}

export function copyWindow<T extends Float64Array | Uint8Array | Int32Array>(
  source: T, start: number, end: number, capacity: number, offset = 0,
): T {
  const copy = new (source.constructor as new (length: number) => T)(capacity);
  copy.set(source.subarray(start, end), offset);
  return copy;
}

// Point, sample and observation windows differ in how they are opened, but grow and slide identically.
export class Column<T extends NumericArray> extends BufferWindow {
  protected data: T;

  constructor(input: T, previous?: Column<T>, empty = false) {
    super(previous ?? input.length);
    if (previous || empty) this.data = input;
    else {
      const capacity = openingCapacity(input.length);
      // Open on an ordinary owned array even when a caller supplies a typed-array subclass.
      this.data = (input instanceof Float64Array ? new Float64Array(capacity)
        : input instanceof Int32Array ? new Int32Array(capacity) : new Uint8Array(capacity)) as T;
      this.data.set(input);
    }
  }

  get capacity(): number { return this.data.length; }
  get last(): number | undefined { return this.end > this.start ? this.data[this.end - 1] : undefined; }

  at(index: number): number | undefined {
    return this.start + index < this.end ? this.data[this.start + index] : undefined;
  }

  view(): T { return this.data.subarray(this.start, this.end) as T; }
  fork(): Column<T> { return new Column(this.data, this); }

  extend(values?: T): Column<T> {
    if (!values?.length && !this.length) return this;
    const draft = this.fork();
    if (values) draft.append(values);
    return draft;
  }

  append(values: T): void {
    this.#reserve(values.length);
    this.data.set(values, this.end);
    this.end += values.length;
  }

  push(value: number): void {
    this.#reserve(1);
    this.data[this.end++] = value;
  }

  #reserve(extra: number): void {
    const capacity = this.growth(extra, this.data.length);
    if (capacity) this.#resize(capacity, extra);
  }

  drop(count: number): void {
    this.start += count;
    const capacity = this.compact(this.data.length);
    if (capacity) this.#resize(capacity, 0);
  }

  #resize(capacity: number, extra: number): void {
    this.data = copyWindow(this.data, this.start, this.end, capacity);
    this.rebase(extra);
  }
}
