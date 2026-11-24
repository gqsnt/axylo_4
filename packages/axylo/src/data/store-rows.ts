import type { DiagnosticInput, DiagnosticSink, Frame, RowSource } from '../core/contracts';

/** Whether the first slots of `window` hold `prefix` from `start` on (checked at both ends). */
export function sameRemainder(prefix: Float64Array, start: number, window: Float64Array): boolean {
  const remaining = prefix.length - start;
  return remaining > 0 && remaining <= window.length &&
    window[0] === prefix[start] && window[remaining - 1] === prefix[prefix.length - 1];
}
import { once, type PreparedFrame } from './transaction';
import { lowerBound } from './search';
import { mapValues, StoreMap } from './store-map';
import { columnsTable, rowValue, type Columns, type Table } from './table';

/** The left edge of the newest distinct positions. An undersized window has no lower bound. */
export function retentionStart({ positions, order }: { positions: Float64Array; order: Int32Array | null }, keep: number): number {
  let first = Infinity;
  for (let i = (order?.length ?? positions.length) - 1; keep > 0 && i >= 0; i--) {
    const position = positions[order?.[i] ?? i]!;
    if (position !== first) {
      first = position;
      keep--;
    }
  }
  return keep ? -Infinity : first;
}

export function groupFor<K, V extends object>(map: Map<K, V>, key: K, create: new () => V): V {
  let group = map.get(key);
  if (!group) map.set(key, group = new create());
  return group;
}

const blockSize = 256;

interface ColumnBlock {
  readonly table: Table;
  // An untouched block has implicit row indexes. Only a sparse block needs a mask.
  readonly present: bigint | null;
  readonly borrowed: boolean;
}

function blockIndex(row: number): number { return Math.floor(row / blockSize); }
function rowBit(row: number): bigint { return 1n << BigInt(row % blockSize); }
function fullBlock(length: number): bigint { return (1n << BigInt(length)) - 1n; }

function typedColumn(column: ArrayLike<unknown>): boolean {
  return ArrayBuffer.isView(column) && 'BYTES_PER_ELEMENT' in column;
}

export class RawRows {
  #objects: StoreMap<number, unknown>;
  #references: Map<string, StoreMap<number, object>>;
  #columnCount: number;
  #borrowedSize: number;

  constructor(objects = new StoreMap<number, unknown>(), private readonly columns = new StoreMap<number, ColumnBlock>(),
    references = new Map<string, StoreMap<number, object>>(), count = 0, borrowed = 0) {
    this.#objects = objects;
    this.#references = references;
    this.#columnCount = count;
    this.#borrowedSize = borrowed;
  }

  fork(): RawRows {
    return new RawRows(this.#objects.fork(), this.columns.fork(),
      mapValues(this.#references, entries => entries.fork()), this.#columnCount, this.#borrowedSize);
  }

  commit(): void {
    this.#objects.commit();
    this.columns.commit();
    for (const entries of this.#references.values()) entries.commit();
  }

  get size(): number { return this.#objects.size + this.#columnCount; }

  load(table: Table): void {
    if (!table.columns || table.length === 0) {
      for (let i = 0; i < table.length; i++) this.#objects.set(i, table.rowAt(i));
      return;
    }
    const columns = table.columns;
    const keys = Object.keys(columns);
    this.#columnCount = table.length;
    const borrowed = keys.some(key => ArrayBuffer.isView(columns[key]));
    this.#borrowedSize = borrowed ? table.length : 0;
    for (let start = 0; start < table.length; start += blockSize) {
      const end = Math.min(start + blockSize, table.length);
      const block: Columns = Object.fromEntries(keys.map(key => [key, this.#columnSlice(columns[key]!, key, start, end)]));
      this.columns.set(blockIndex(start), { table: columnsTable(block, end - start), present: null, borrowed });
    }
  }

  #columnSlice(column: ArrayLike<unknown>, field: string, start: number, end: number): ArrayLike<unknown> {
    if (typedColumn(column)) {
      return Uint8Array.prototype.subarray.call(column, start, end);
    }
    return Array.from({ length: end - start }, (_, i) => {
      const value = column[start + i];
      if (value === null || typeof value !== 'object' && typeof value !== 'function') return value;
      // A partly retained block may keep primitive values, but an object belongs to one row.
      this.#reference(field, start + i, value);
      return undefined;
    });
  }

  #own(block: ColumnBlock): ColumnBlock {
    if (!block.borrowed) return block;
    const columns = block.table.columns!;
    const contents: Columns = Object.fromEntries(Object.entries(columns).map(([key, column]) => [
      key, typedColumn(column) ? Uint8Array.prototype.slice.call(column) : column,
    ]));
    return { ...block, table: columnsTable(contents, block.table.length), borrowed: false };
  }

  compactColumns(): void {
    if (!this.#borrowedSize || this.#columnCount * 2 > this.#borrowedSize) return;
    // One copy at the halfway point frees the original large buffers after the old
    // revisions retire. Subsequent eviction can free each small block independently.
    for (const [index, block] of this.columns) this.columns.set(index, this.#own(block));
    this.#borrowedSize = 0;
  }

  #column(row: number): ColumnBlock | undefined {
    const block = this.columns.get(blockIndex(row));
    if (block && (block.present === null ? row % blockSize < block.table.length : (block.present & rowBit(row)) !== 0n)) return block;
    return undefined;
  }

  #reference(field: string, row: number, value: object): void {
    groupFor(this.#references, field, StoreMap<number, object>).set(row, value);
  }

  append(start: number, rows: readonly unknown[]): void {
    for (let i = 0; i < rows.length; i++) this.#objects.set(start + i, rows[i]);
  }

  copy(row: number, target: RawRows): boolean {
    const block = this.#column(row);
    if (block) {
      const index = blockIndex(row);
      const archived = target.columns.get(index);
      target.columns.set(index, { ...(archived ?? this.#own(block)), present: (archived?.present ?? 0n) | rowBit(row) });
      target.#columnCount++;
      for (const [field, entries] of this.#references) {
        const value = entries.get(row);
        if (value !== undefined) target.#reference(field, row, value);
      }
    } else if (this.#objects.has(row)) target.#objects.set(row, this.#objects.get(row));
    else return false;
    return true;
  }

  forget(row: number): void {
    this.#objects.delete(row);
    const block = this.#column(row);
    if (block) {
      const index = blockIndex(row);
      const present = (block.present ?? fullBlock(block.table.length)) & ~rowBit(row);
      if (present) this.columns.set(index, { ...block, present });
      else this.columns.delete(index);
      this.#columnCount--;
      for (const entries of this.#references.values()) entries.delete(row);
    }
  }

  read(row: number, field: string): unknown {
    const range = this.#column(row)?.table;
    return range ? this.#references.get(field)?.get(row) ?? range.read(row % blockSize, field) : rowValue(this.#objects.get(row), field);
  }

  rowAt(row: number): unknown {
    const range = this.#column(row)?.table;
    if (!range) return this.#objects.has(row) ? this.#objects.get(row) : null;
    if (this.#references.size === 0) return range.rowAt(row % blockSize);
    return Object.fromEntries(range.keys().map(field => [field, this.read(row, field)]));
  }

  isColumn(row: number): boolean {
    return this.#column(row) !== undefined;
  }

  keysAt(row: number): readonly string[] {
    return this.#column(row)?.table.keys() ?? Object.keys(Object(this.#objects.get(row)));
  }

  hasField(row: number, field: string): boolean {
    return this.#column(row)?.table.hasField(field) ?? Object.hasOwn(Object(this.#objects.get(row)), field);
  }

  indexes(start: number, incoming: number): Int32Array {
    const indexes = new Int32Array(this.size + incoming);
    let i = 0;
    for (const [index, { table, present }] of this.columns) {
      const base = index * blockSize;
      for (let offset = 0; offset < table.length; offset++) {
        if (present === null || (present & rowBit(offset)) !== 0n) indexes[i++] = base + offset;
      }
    }
    for (const row of this.#objects.keys()) indexes[i++] = row;
    for (let j = 0; j < incoming; j++) indexes[i++] = start + j;
    return indexes;
  }
}

type Discard = (row: number, column: boolean) => void;

export class StreamRows {
  private retained: RawRows;
  #positions: StoreMap<number, number>;
  // A sorted, unique column prefix already has a typed position index and implicit source rows.
  private seedPositions: Float64Array | null = null;
  #seedOffset = 0;
  #seedStart = 0;
  #previousAtPosition: StoreMap<number, number>;
  #unplaced: StoreMap<number, number>;
  #latestPosition = -Infinity;
  onForget?: (row: number) => void;
  next: number;

  constructor(table?: Table, previous?: StreamRows) {
    if (previous) {
      this.retained = previous.retained.fork();
      this.#positions = previous.#positions.fork();
      this.#previousAtPosition = previous.#previousAtPosition.fork();
      this.#unplaced = previous.#unplaced.fork();
      this.seedPositions = previous.seedPositions;
      this.#seedOffset = previous.#seedOffset;
      this.#seedStart = previous.#seedStart;
      this.#latestPosition = previous.#latestPosition;
      this.next = previous.next;
    } else {
      this.retained = new RawRows();
      this.#positions = new StoreMap();
      this.#previousAtPosition = new StoreMap();
      this.#unplaced = new StoreMap();
      if (table) this.retained.load(table);
      this.next = table?.length ?? 0;
    }
  }

  get size(): number { return this.retained.size; }

  fork(): StreamRows {
    return new StreamRows(undefined, this);
  }

  commit(): void {
    this.retained.commit();
    this.#positions.commit();
    this.#previousAtPosition.commit();
    this.#unplaced.commit();
  }

  record(position: number, row: number): void {
    if (!Number.isFinite(position)) {
      this.#unplaced.set(row, this.#latestPosition);
      return;
    }
    this.#latestPosition = Math.max(position, this.#latestPosition);
    const previous = this.#positions.get(position);
    if (previous !== undefined) this.#previousAtPosition.set(row, previous);
    this.#positions.set(position, row);
  }

  resetPositions(table: Table, positions: Float64Array, seed?: Float64Array): void {
    this.#positions = new StoreMap();
    this.#previousAtPosition = new StoreMap();
    this.#unplaced = new StoreMap();
    this.#latestPosition = -Infinity;
    this.seedPositions = null;
    this.#seedStart = this.#seedOffset = 0;
    if (table.columns && seed?.length === table.length && table.length) {
      let last = -Infinity;
      let i = 0;
      for (; i < seed.length; i++) {
        const position = seed[i]!;
        if (position !== positions[i] || position <= last || !Number.isFinite(position)) break;
        last = position;
      }
      if (i === seed.length) {
        this.seedPositions = seed;
        this.#latestPosition = last;
        return;
      }
    }
    for (let i = 0; i < table.length; i++) this.record(positions[i] ?? NaN, table.rowIndex(i));
  }

  append(rows: readonly unknown[]): void {
    this.retained.append(this.next, rows);
    this.next += rows.length;
  }

  forget(row: number): void {
    this.onForget?.(row);
    this.retained.forget(row);
  }

  evictRead(position: number, discard?: Discard): void {
    let row = this.#positions.get(position);
    while (row !== undefined) {
      const previous = this.#previousAtPosition.get(row);
      this.#previousAtPosition.delete(row);
      discard?.(row, this.retained.isColumn(row));
      this.forget(row);
      row = previous;
    }
    this.#positions.delete(position);
    // Eviction walks positions in ascending order. Appended rows at this same x
    // have already been evicted from the delta above.
    if (this.seedPositions?.[this.#seedStart] === position) {
      const index = this.#seedOffset + this.#seedStart++;
      discard?.(index, true);
      this.forget(index);
    }
  }

  /** As `Observations.share`: the seed's remaining positions read from the store's window (see store.ts). */
  shareSeed(window: Float64Array): void {
    const seed = this.seedPositions;
    if (!seed || !sameRemainder(seed, this.#seedStart, window)) return;
    this.seedPositions = window.subarray(0, seed.length - this.#seedStart);
    this.#seedOffset += this.#seedStart;
    this.#seedStart = 0;
  }

  compactColumns(): void {
    this.retained.compactColumns();
    const seed = this.seedPositions;
    if (!seed || this.#seedStart * 2 < seed.length) return;
    this.seedPositions = this.#seedStart === seed.length ? null : seed.slice(this.#seedStart);
    this.#seedOffset += this.#seedStart;
    this.#seedStart = 0;
  }

  trimUnplacedRead(keep: number, first: number, observed: number, discard: Discard): void {
    // Invalid records need a bounded home even when every new record is unplaceable.
    const capacity = observed ? 2 * keep : keep;
    for (const [row, position] of this.#unplaced) {
      if (this.#unplaced.size <= capacity && (!observed || position >= first)) break;
      this.#unplaced.delete(row);
      discard(row, this.retained.isColumn(row));
      this.forget(row);
    }
  }

  read(row: number, field: string): unknown {
    return this.retained.read(row, field);
  }

  rowAt(row: number): unknown {
    return this.retained.rowAt(row);
  }

  source(live?: () => boolean): FrameSource {
    return new FrameSource(this.next, this, live);
  }

  /** Every retained source row, ascending: the opening's column rows come first, appended rows after them. */
  retainedIndexes(): Int32Array {
    return this.retained.indexes(0, 0);
  }

  archive(row: number, target: RawRows): boolean {
    return this.retained.copy(row, target);
  }

  table(incoming: readonly unknown[] = []): Table {
    const retained = this.retained;
    const first = this.next;
    const indexes = retained.indexes(first, incoming.length);
    return {
      length: indexes.length, columns: null,
      read: (i, field) => {
        const row = indexes[i]!;
        return row < first ? retained.read(row, field) : rowValue(incoming[row - first], field);
      },
      rowIndex: i => indexes[i]!,
      isColumnRow: i => retained.isColumn(indexes[i]!),
      rowAt: i => {
        const row = indexes[i]!;
        return row < first ? retained.rowAt(row) : incoming[row - first];
      },
      hasField: field => indexes.some(row => row < first ? retained.hasField(row, field) : Object.hasOwn(Object(incoming[row - first]), field)),
      keys: () => {
        const keys = new Set<string>();
        for (const row of indexes) {
          const fields = row < first ? retained.keysAt(row) : Object.keys(Object(incoming[row - first]));
          for (const field of fields) keys.add(field);
        }
        return [...keys];
      },
    };
  }
}

export class FrameSource implements RowSource {
  #read: ((row: number) => unknown) | null;

  constructor(private readonly end: number, rows: StreamRows, live: () => boolean = () => true) {
    this.#read = row => {
      if (live()) return rows.rowAt(row);
      this.release();
      return null;
    };
  }

  rowAt(row: number): unknown {
    return Number.isInteger(row) && row >= 0 && row < this.end && this.#read ? this.#read(row) : null;
  }

  get limit(): number { return this.end; }

  bind(read: (row: number) => unknown): void {
    this.#read = read;
  }

  release(): void {
    this.#read = null;
  }
}

export class RowWindow {
  private readonly archived = new RawRows();
  readonly #lastSeen = new Map<number, number>();
  private readonly sources = new Map<number, FrameSource>();
  #latestRevision = -Infinity;
  private rows: StreamRows | null;
  #closed = false;

  constructor(rows: StreamRows) {
    this.rows = rows;
  }

  get size(): number { return (this.rows?.size ?? 0) + this.archived.size; }
  get disposable(): boolean { return this.#closed && this.sources.size === 0; }

  archive(row: number): void {
    const revision = this.#latestRevision;
    // Newly appended rows can be evicted before any accepted frame has addressed them.
    const source = this.sources.get(revision);
    if (!source || row >= source.limit || !this.rows?.archive(row, this.archived)) return;
    this.#lastSeen.set(row, revision);
  }

  publish(revision: number, source: FrameSource, rows: StreamRows): void {
    this.rows = rows;
    this.#latestRevision = revision;
    this.sources.set(revision, source);
    source.bind(row => {
      const last = this.#lastSeen.get(row);
      return last === undefined ? this.rows?.rowAt(row) : revision <= last ? this.archived.rowAt(row) : null;
    });
  }

  /**
   * The source rows a published revision's `rowAt` answers, ascending, or null when it is not one of this
   * window's live revisions. The rows still retained below its end, and the evicted rows kept for it.
   */
  retainedRows(revision: number, source: RowSource): ArrayLike<number> | null {
    if (this.sources.get(revision) !== source || !this.rows) return null;
    const end = (source as FrameSource).limit;
    const current = this.rows.retainedIndexes();
    const live = current.subarray(0, lowerBound(current, end));
    const kept: number[] = [];
    for (const [row, last] of this.#lastSeen) if (revision <= last && row < end) kept.push(row);
    if (!kept.length) return live;
    kept.sort((a, b) => a - b);
    // Merge the two ascending lists.
    const all = new Int32Array(live.length + kept.length);
    for (let i = 0, j = 0, k = 0; k < all.length; k++) {
      all[k] = j >= kept.length || i < live.length && live[i]! < kept[j]! ? live[i++]! : kept[j++]!;
    }
    return all;
  }

  close(): void {
    this.#closed = true;
    if (this.sources.size === 0) this.rows = null;
  }

  retire(revision: number): void {
    for (const [number, source] of this.sources) {
      if (number > revision) break;
      source.release();
      this.sources.delete(number);
    }
    // A source row leaves a window once. Map insertion order is therefore eviction revision order.
    for (const [row, last] of this.#lastSeen) {
      if (last > revision) break;
      this.archived.forget(row);
      this.#lastSeen.delete(row);
    }
    if (this.#closed && this.sources.size === 0) this.rows = null;
  }
}

export class RowRevisions {
  private readonly windows = new Set<RowWindow>();
  current: RowWindow;

  constructor(rows: StreamRows) {
    this.windows.add(this.current = new RowWindow(rows));
  }

  get size(): number {
    let size = 0;
    for (const window of this.windows) size += window.size;
    return size;
  }

  /** See `RowWindow.retainedRows`: the frame's revision, in whichever window published it. */
  retainedRows(frame: { readonly revision: number; readonly source: RowSource }): ArrayLike<number> | null {
    for (const window of this.windows) {
      const rows = window.retainedRows(frame.revision, frame.source);
      if (rows) return rows;
    }
    return null;
  }

  replace(rows: StreamRows): void {
    this.current.close();
    if (this.current.disposable) this.windows.delete(this.current);
    this.windows.add(this.current = new RowWindow(rows));
  }

  retire(revision: number): void {
    for (const window of this.windows) {
      window.retire(revision);
      if (window.disposable) this.windows.delete(window);
    }
  }
}

/** Shared revision and row ownership for aligned, point and slice frames. */
export abstract class RevisionStore<F extends Frame> {
  protected rows: StreamRows;
  protected readonly revisions: RowRevisions;
  protected current!: F;
  protected latest!: readonly DiagnosticInput[];

  constructor(table: Table) {
    this.rows = new StreamRows(table);
    this.revisions = new RowRevisions(this.rows);
  }

  get frame(): F { return this.current; }
  get retainedRowCount(): number { return this.revisions.size; }
  retainedRows(frame: Frame): ArrayLike<number> | null { return this.revisions.retainedRows(frame); }
  retire(revision: number): void { this.revisions.retire(Math.min(revision, this.current.revision)); }

  protected publish(frame: F, source = this.rows.source()): void {
    this.revisions.current.publish(frame.revision, source, this.rows);
    this.current = frame.source === source ? frame : { ...frame, source };
  }

  protected preview(base: F, result: F, rows: StreamRows, diagnostics: readonly DiagnosticInput[],
    callDiagnostics: readonly DiagnosticInput[], apply: () => void): PreparedFrame<F> & { commit: ReturnType<typeof once> } {
    const source = rows.source(() => this.current === base);
    const frame = { ...result, source };
    const commit = once(() => this.current, () => {
      apply();
      this.latest = diagnostics;
      this.publish(frame, source);
    }, base);
    return { frame, diagnostics, callDiagnostics, commit };
  }

  protected commitRows(rows: StreamRows, evicted: readonly number[], replacement: boolean): void {
    if (replacement) this.revisions.replace(rows);
    for (const row of evicted) this.revisions.current.archive(row);
    rows.commit();
    this.rows = rows;
  }
}

export function forwardDiagnostics(inputs: readonly DiagnosticInput[], sink: DiagnosticSink): void {
  for (const diagnostic of inputs) sink.add(diagnostic);
}
