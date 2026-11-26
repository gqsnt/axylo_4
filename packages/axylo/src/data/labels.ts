// Category names and the buffer window they share with the stores' columns. Normalization reads categories
// through these, so they live apart from the streaming storage that `axylo/static` leaves out.
// An inspected preparation can outlive the next one. It owns the spare slots it
// wrote, so a competing writer must open a new buffer before reusing those indexes.
export class BufferWindow {
  #written: { end: number };

  constructor(public start = 0, public end = 0, written = { end }) {
    this.#written = written;
  }

  fork(): BufferWindow {
    return new BufferWindow(this.start, this.end, this.#written);
  }

  get hasCompetingWrites(): boolean { return this.end < this.#written.end; }

  reserve(extra: number, capacity: number): number {
    if (this.end + extra > capacity || extra > 0 && this.hasCompetingWrites) {
      return Math.max(16, 2 * (this.end - this.start + extra));
    }
    this.#written.end = Math.max(this.#written.end, this.end + extra);
    return 0;
  }

  /**
   * After eviction, a buffer more than 2.25 times its window is cut to the window and an eighth. Growth
   * doubles (2 × (window + appended)), so a window that slides by small appends stays below the threshold and
   * is never cut and regrown in turn; a cut costs one copy of the window, paid for by the evictions that
   * shrank it below 1/2.25 of the buffer.
   */
  compact(capacity: number): number {
    const length = this.end - this.start;
    return capacity > Math.max(32, 2.25 * length) ? length + Math.max(16, Math.ceil(length / 8)) : 0;
  }

  rebase(extra: number): void {
    this.end -= this.start;
    this.start = 0;
    this.#written = { end: this.end + extra };
  }
}

export class Labels {
  #names: string[];
  #range: BufferWindow;

  constructor(names: readonly string[] = []) {
    this.#names = [...names];
    this.#range = new BufferWindow(0, names.length);
  }

  get length(): number { return this.#range.end - this.#range.start; }

  at(index: number): string {
    return this.#names[this.#range.start + index]!;
  }

  fork(): Labels {
    const copy = new Labels();
    copy.#names = this.#names;
    copy.#range = this.#range.fork();
    return copy;
  }

  push(name: string): void {
    if (this.#range.reserve(1, Infinity)) this.#copy(1);
    this.#names[this.#range.end++] = name;
  }

  pop(): string {
    // The cursor can move back, but an inspected category view may still read the slot.
    return this.#names[--this.#range.end]!;
  }

  drop(count: number): void {
    this.#range.start += count;
    if (this.#range.compact(this.#names.length)) this.#copy(0);
  }

  #copy(extra: number): void {
    this.#names = this.snapshot();
    this.#range.rebase(extra);
  }

  snapshot(): string[] {
    return this.#names.slice(this.#range.start, this.#range.end);
  }

  view(): readonly string[] {
    const names = this.#names;
    const { start, end } = this.#range;
    const length = end - start;
    // An ordinary array snapshot would copy every retained label on every append.
    const indexOf = (key: PropertyKey): number => {
      if (typeof key !== 'string') return -1;
      const index = Number(key);
      return index >= 0 && index < length && Number.isInteger(index) && String(index) === key ? index : -1;
    };
    return new Proxy([] as string[], {
      get(target, key, receiver) {
        if (key === 'length') return length;
        const index = indexOf(key);
        return index < 0 ? Reflect.get(target, key, receiver) : names[start + index];
      },
      has(target, key) {
        return indexOf(key) >= 0 || Reflect.has(target, key);
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === 'length') return { configurable: false, enumerable: false, writable: true, value: length };
        const index = indexOf(key);
        return index < 0 ? Reflect.getOwnPropertyDescriptor(target, key)
          : { configurable: true, enumerable: true, writable: false, value: names[start + index] };
      },
      ownKeys() {
        return [...Array.from({ length }, (_, i) => String(i)), 'length'];
      },
      set: () => false,
      deleteProperty: () => false,
      defineProperty: () => false,
      preventExtensions: () => false,
    });
  }
}

