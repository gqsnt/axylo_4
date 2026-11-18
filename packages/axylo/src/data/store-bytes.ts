import type { Frame } from '../core/contracts';
import type { Table } from './table';

/** The buffers a store holds for one purpose. */
export interface OwnedBuffer {
  /** What holds them, for reading a breakdown: "x", "series temperature y", "rows". */
  readonly name: string;
  readonly bytes: number;
  /** How many distinct buffers: retained column rows are kept in blocks of 256, each its own buffer once copied. */
  readonly buffers: number;
}

/**
 * The typed storage a store holds that is not the caller's: what spec P7 calls "bytes owned by Axylo beyond
 * the caller's columns". Each underlying buffer is counted once, at its full byte length (spare capacity is
 * owned too), under the first name that reached it; buffers with the same name are summed.
 */
export interface OwnedBytes {
  readonly total: number;
  readonly buffers: readonly OwnedBuffer[];
}

/** The buffers behind a table's typed columns. Weak, so remembering them never keeps them alive. */
export class CallerBuffers {
  private readonly buffers = new WeakSet<ArrayBufferLike>();

  add(table: Table): void {
    const columns = table.columns;
    if (!columns) return;
    for (const key of Object.keys(columns)) {
      const column = columns[key];
      if (ArrayBuffer.isView(column)) this.buffers.add(column.buffer);
    }
  }

  has(buffer: ArrayBufferLike): boolean { return this.buffers.has(buffer); }
}

export class ByteCount {
  private readonly seen = new Set<ArrayBufferLike>();
  private readonly entries = new Map<string, { bytes: number; buffers: number }>();

  constructor(private readonly caller: CallerBuffers) {}

  add(name: string, view: ArrayBufferView | null | undefined): void {
    if (!view) return;
    const buffer = view.buffer;
    if (this.seen.has(buffer) || this.caller.has(buffer)) return;
    this.seen.add(buffer);
    if (!buffer.byteLength) return;
    const entry = this.entries.get(name);
    if (entry) {
      entry.bytes += buffer.byteLength;
      entry.buffers++;
    } else this.entries.set(name, { bytes: buffer.byteLength, buffers: 1 });
  }

  /**
   * Adds the columns a frame hands out that are plain properties. A column behind a getter is not read: reading
   * it marks the store's open slot as seen and changes what the next append copies.
   */
  frame(frame: Frame): void {
    if (frame.shape === 'aligned') {
      this.add('frame x', frame.x.values);
      for (const series of frame.series) this.plain(`frame series ${series.key}`, series, ['y', 'slot', 'row']);
    } else if (frame.shape === 'points') {
      for (const series of frame.series) this.plain(`frame series ${series.key}`, series, ['x', 'y', 'row', 'missingX', 'missingRow']);
    } else {
      this.plain('frame', frame, ['values', 'slot', 'row']);
    }
  }

  private plain(name: string, owner: object, keys: readonly string[]): void {
    for (const key of keys) {
      const value: unknown = Object.getOwnPropertyDescriptor(owner, key)?.value;
      if (ArrayBuffer.isView(value)) this.add(`${name} ${key}`, value);
    }
  }

  result(): OwnedBytes {
    let total = 0;
    const buffers: OwnedBuffer[] = [];
    for (const [name, entry] of this.entries) {
      total += entry.bytes;
      buffers.push({ name, ...entry });
    }
    return { total, buffers };
  }
}
