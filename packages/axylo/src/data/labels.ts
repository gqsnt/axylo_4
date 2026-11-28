// An inspected preparation can outlive the next one. It owns the spare slots it
// wrote, so a competing writer must open a new buffer before reusing those indexes.
export class BufferWindow {
  #written: { end: number };

  start: number;
  end: number;

  constructor(window: BufferWindow | number = 0) {
    if (typeof window === 'number') {
      this.start = 0;
      this.end = window;
      this.#written = { end: window };
    } else {
      this.start = window.start;
      this.end = window.end;
      this.#written = window.#written;
    }
  }

  get length(): number { return this.end - this.start; }

  get hasCompetingWrites(): boolean { return this.end < this.#written.end; }

  growth(extra: number, capacity: number): number {
    if (this.end + extra > capacity || extra > 0 && this.hasCompetingWrites) {
      return Math.max(16, 2 * (this.length + extra));
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
    const length = this.length;
    return capacity > Math.max(32, 2.25 * length) ? length + Math.max(16, Math.ceil(length / 8)) : 0;
  }

  rebase(extra: number): void {
    this.end -= this.start;
    this.start = 0;
    this.#written = { end: this.end + extra };
  }
}

export class Labels extends BufferWindow {
  #names: string[];

  constructor(names: readonly string[] | Labels = []) {
    super(names instanceof Labels ? names : names.length);
    this.#names = names instanceof Labels ? names.#names : [...names];
  }

  at(index: number): string {
    return this.#names[this.start + index]!;
  }

  fork(): Labels {
    return new Labels(this);
  }

  push(name: string): void {
    if (this.growth(1, Infinity)) this.#copy(1);
    this.#names[this.end++] = name;
  }

  pop(): string {
    // The cursor can move back, but an inspected category view may still read the slot.
    return this.#names[--this.end]!;
  }

  drop(count: number): void {
    this.start += count;
    if (this.compact(this.#names.length)) this.#copy(0);
  }

  #copy(extra: number): void {
    this.#names = this.slice();
    this.rebase(extra);
  }

  slice(): string[] {
    return this.#names.slice(this.start, this.end);
  }

  view(): readonly string[] {
    const names = this.#names;
    const { start, end } = this;
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
