// Development and benchmark builds only (spec P7's byte count): the stores reach this module from code behind
// `__DEV__ || __BENCH__`, so a production bundle carries none of it.
import type { Frame } from '../core/contracts';
import type { FrameBuffers } from './store-buffers';
import type { RawRows, RowRevisions } from './store-rows';
import { existingSharedStates } from './store-statistics';
import type { Column } from './store-window';
import { borrowColumns, borrowedBuffers, type Table } from './table';

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

/** The buffers behind a table's typed columns, and every buffer a caller has given. */
export class CallerBuffers {
  add(table: Table): void {
    if (table.columns) borrowColumns(table.columns);
  }

  has(buffer: ArrayBufferLike): boolean { return borrowedBuffers.has(buffer); }
}

/**
 * Columns a frame copies on first read (a store's open slot that a later fill has claimed), by the object that
 * holds the getters. Reading the registry gives what has been copied so far without reading the getters.
 */
export const lazyColumns = new WeakMap<object, () => readonly (ArrayBufferView | null | undefined)[]>();

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
      for (const series of frame.series) {
        this.plain(`frame series ${series.key}`, series, ['y', 'slot', 'row']);
        const y: unknown = Object.getOwnPropertyDescriptor(series, 'y')?.value;
        if (y instanceof Float64Array) {
          const shared = existingSharedStates(y);
          if (shared) this.add(`frame series ${series.key} slot`, shared);
        }
      }
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
    for (const copy of lazyColumns.get(owner)?.() ?? []) this.add(`${name} copy`, copy);
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

// The stores' storage, read from outside the classes so their production code carries no counting members.

export function countBuffers(buffers: FrameBuffers, bytes: ByteCount): void {
  bytes.add('x', buffers.x);
  const [flags, categories] = buffers.auxiliaryColumns;
  if (flags) bytes.add('observed', flags);
  if (categories.length) bytes.add('category positions', categories);
  for (const [key, series] of buffers.series) {
    bytes.add(`series ${key} y`, series.y);
    // A dense series keeps no state column (null), unless one was already materialized for its shared y buffer.
    const slot = series.slot ?? existingSharedStates(series.y);
    if (slot) bytes.add(`series ${key} slot`, slot);
    if (series.row) bytes.add(`series ${key} row`, series.row);
  }
}

export function countColumn<T extends Float64Array | Int32Array | Uint8Array>(column: Column<T> | null, bytes: ByteCount, name: string): void {
  if (column) bytes.add(name, column['data']);
}

function countRaw(rows: RawRows, bytes: ByteCount, name: string): void {
  if (!rows.columnBlocks) return;
  for (const [, block] of rows.columnBlocks) {
    const columns = block.columns;
    for (const key of Object.keys(columns)) {
      const column = columns[key];
      if (ArrayBuffer.isView(column)) bytes.add(name, column);
    }
  }
}

export function countRevisions(revisions: RowRevisions, bytes: ByteCount): void {
  for (const window of [revisions.current, ...revisions['older'] ?? []]) {
    const rows = window['rows'];
    if (rows) {
      bytes.add('x positions of the first rows', rows.initialPositions);
      countRaw(rows, bytes, 'rows');
    }
    countRaw(window['archived'], bytes, 'rows kept for earlier frames');
  }
}
