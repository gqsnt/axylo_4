import type { DiagnosticInput, DiagnosticSink, Frame, RowSource } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import type { FrameVersion } from './normalize';
import { resolveTable, type ResolvedOptions } from './options';

import { once, type PreparedFrame } from './transaction';
import { lowerBound } from './search';
import { StoreMap } from './store-map';
import { columnsTable, rowValue, type Columns, type Table } from './table';

/** Share a matching window. A prefix already on that backing keeps its existing cursor. */
export function shareRemainder(
  prefix: Float64Array, offset: number, x: Float64Array, start: number, end: number,
): Float64Array | null {
  const remaining = prefix.length - offset;
  if (remaining <= 0 || remaining > end - start) return null;
  if (prefix.buffer === x.buffer && prefix.byteOffset + offset * 8 === x.byteOffset + start * 8) return prefix;
  return x[start] === prefix[offset] && x[start + remaining - 1] === prefix[prefix.length - 1]
    ? x.subarray(start, start + remaining) : null;
}

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
  readonly start: number;
  readonly end: number;
  // Only a block with holes needs an explicit index.
  readonly present: readonly number[] | null;
  readonly borrowed: boolean;
}

/** Shared empty column map for row-only stores and archives; lazily created so import does zero work. */
let sharedEmptyColumns: StoreMap<number, ColumnBlock> | null = null;
function getEmptyColumns(): StoreMap<number, ColumnBlock> {
  return sharedEmptyColumns ??= new StoreMap<number, ColumnBlock>();
}

function blockIndex(row: number): number { return Math.floor(row / blockSize); }
function offsetBit(offset: number): number { return 1 << (offset & 31); }

function hasOffset(mask: readonly number[], offset: number): boolean {
  return (mask[offset >>> 5]! & offsetBit(offset)) !== 0;
}

function blockMask(block: ColumnBlock, start: number): number[] {
  if (block.present) return block.present.slice();
  const mask = new Array<number>(blockSize / 32).fill(0);
  for (let offset = start; offset < block.end; offset++) mask[offset >>> 5]! |= offsetBit(offset);
  return mask;
}

function typedColumn(column: ArrayLike<unknown>): boolean {
  return ArrayBuffer.isView(column) && 'BYTES_PER_ELEMENT' in column;
}

export function forkValues<K, V extends { fork(): V }>(source: ReadonlyMap<K, V>): Map<K, V> {
  const result = new Map<K, V>();
  for (const [key, entries] of source) result.set(key, entries.fork());
  return result;
}

export class RawRows {
  #objects: StoreMap<number, unknown>;
  private columns: StoreMap<number, ColumnBlock>;
  #references: Map<string, StoreMap<number, object>> | null;
  #columnCount: number;
  #borrowedSize: number;
  // Keep the advancing edge on the draft itself so it can share its block with the base.
  #headIndex = -1;
  #headOffset = 0;

  constructor(
    objects = new StoreMap<number, unknown>(),
    columns: StoreMap<number, ColumnBlock> = getEmptyColumns(),
    references: Map<string, StoreMap<number, object>> | null = null,
    count = 0,
    borrowed = 0,
  ) {
    this.#objects = objects;
    this.columns = columns;
    this.#references = references;
    this.#columnCount = count;
    this.#borrowedSize = borrowed;
  }

  fork(): RawRows {
    const draft = new RawRows(
      this.#objects.fork(),
      this.#columnCount > 0 ? this.columns.fork() : getEmptyColumns(),
      this.#references?.size ? forkValues(this.#references) : null,
      this.#columnCount,
      this.#borrowedSize,
    );
    draft.#headIndex = this.#headIndex;
    draft.#headOffset = this.#headOffset;
    return draft;
  }

  commit(): void {
    this.#objects.commit();
    if (this.columns !== sharedEmptyColumns) this.columns.commit();
    if (this.#references) {
      for (const entries of this.#references.values()) entries.commit();
    }
  }

  get size(): number { return this.#objects.size + this.#columnCount; }

  load(table: Table): void {
    if (!table.columns || table.length === 0) {
      for (let i = 0; i < table.length; i++) this.#objects.set(i, table.rowAt(i));
      return;
    }
    if (this.columns === sharedEmptyColumns) this.columns = new StoreMap();
    const columns = table.columns;
    this.#columnCount = table.length;
    const keys = Object.keys(columns);
    const borrowed = keys.some(key => ArrayBuffer.isView(columns[key]));
    this.#borrowedSize = borrowed ? table.length : 0;
    for (let start = 0; start < table.length; start += blockSize) {
      const end = Math.min(start + blockSize, table.length);
      const block: Columns = Object.fromEntries(keys.map(key => [key, this.#columnSlice(columns[key]!, key, start, end)]));
      this.columns.set(blockIndex(start), { table: columnsTable(block, end - start), start: 0, end: end - start, present: null, borrowed });
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
    const contents = Object.fromEntries(Object.entries(columns).map(([key, column]) => [
      key, typedColumn(column) ? Uint8Array.prototype.slice.call(column) : column,
    ]));
    return { ...block, table: columnsTable(contents, block.table.length), borrowed: false };
  }

  needsColumnCompaction(discarded = 0): boolean {
    return this.#borrowedSize > 0 && (this.#columnCount - discarded) * 2 <= this.#borrowedSize;
  }

  compactColumns(): void {
    if (!this.needsColumnCompaction()) return;
    // One copy at the halfway point frees the original large buffers after the old
    // revisions retire. Subsequent eviction can free each small block independently.
    for (const [index, block] of this.columns) this.columns.set(index, this.#own(block));
    this.#borrowedSize = 0;
  }

  #column(row: number): ColumnBlock | undefined {
    if (this.#columnCount === 0) return undefined;
    const index = blockIndex(row);
    const block = this.columns.get(index);
    const offset = row % blockSize;
    if (block && offset >= this.#blockStart(index, block) && offset < block.end &&
      (!block.present || hasOffset(block.present, offset))) return block;
    return undefined;
  }

  #blockStart(index: number, block: ColumnBlock): number {
    return index === this.#headIndex ? this.#headOffset : block.start;
  }

  #rememberHead(index: number, offset: number): void {
    if (this.#headIndex !== index) {
      const previous = this.columns.get(this.#headIndex);
      if (previous) this.columns.set(this.#headIndex, { ...previous, start: this.#headOffset });
      this.#headIndex = index;
    }
    this.#headOffset = offset;
  }

  #reference(field: string, row: number, value: object): void {
    groupFor(this.#references ??= new Map(), field, StoreMap<number, object>).set(row, value);
  }

  append(start: number, rows: readonly unknown[]): void {
    for (let i = 0; i < rows.length; i++) this.#objects.set(start + i, rows[i]);
  }

  appendOne(index: number, row: unknown): void { this.#objects.set(index, row); }

  copy(row: number, target: RawRows, rolling = false): boolean {
    const block = this.#column(row);
    if (block) {
      if (target.columns === sharedEmptyColumns) target.columns = new StoreMap();
      const index = blockIndex(row);
      const offset = row % blockSize;
      const archived = target.columns.get(index);
      if (!archived) {
        const owned = this.#own(block);
        // A rolling frame can retire its archive after every row. Share this block's copy
        // with the live rows so its next eviction does not copy the same columns again.
        if (rolling && owned !== block) this.columns.set(index, owned);
        target.columns.set(index, { ...owned, start: offset, end: offset + 1, present: null });
      } else if (!target.#column(row)) {
        const start = target.#blockStart(index, archived);
        const adjacent = !archived.present && (offset === start - 1 || offset === archived.end);
        const present = adjacent ? null : blockMask(archived, start);
        if (present) present[offset >>> 5]! |= offsetBit(offset);
        if (target.#headIndex === index) target.#headIndex = -1;
        target.columns.set(index, { ...archived, start: Math.min(start, offset), end: Math.max(archived.end, offset + 1), present });
      } else return true;
      target.#columnCount++;
      if (this.#references) {
        for (const [field, entries] of this.#references) {
          const value = entries.get(row);
          if (value !== undefined) target.#reference(field, row, value);
        }
      }
    } else if (this.#objects.has(row)) target.#objects.set(row, this.#objects.get(row));
    else return false;
    return true;
  }

  forget(row: number): void {
    const block = this.#column(row);
    if (!block) this.#objects.delete(row);
    else {
      const index = blockIndex(row);
      const offset = row % blockSize;
      const start = this.#blockStart(index, block);
      if (start + 1 === block.end) {
        this.columns.delete(index);
        if (this.#headIndex === index) this.#headIndex = -1;
      } else if (!block.present && offset === start) this.#rememberHead(index, offset + 1);
      else {
        let first = start;
        let end = block.end;
        let present: number[] | null = null;
        if (!block.present && offset === end - 1) end--;
        else {
          present = blockMask(block, start);
          present[offset >>> 5]! &= ~offsetBit(offset);
          while (!hasOffset(present, first)) first++;
          while (!hasOffset(present, end - 1)) end--;
          if (first + 1 === end) present = null;
        }
        this.columns.set(index, { ...block, start: first, end, present });
        if (this.#headIndex === index) this.#headIndex = -1;
      }
      this.#columnCount--;
      if (this.#references) {
        for (const entries of this.#references.values()) entries.delete(row);
      }
    }
  }

  read(row: number, field: string): unknown {
    const range = this.#column(row)?.table;
    return range ? this.#references?.get(field)?.get(row) ?? range.read(row % blockSize, field) : rowValue(this.#objects.get(row), field);
  }

  rowAt(row: number): unknown {
    const range = this.#column(row)?.table;
    if (!range) return this.#objects.has(row) ? this.#objects.get(row) : null;
    if (!this.#references?.size) return range.rowAt(row % blockSize);
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
    if (this.#columnCount > 0) {
      for (const [index, block] of this.columns) {
        const { end, present } = block;
        const base = index * blockSize;
        for (let offset = this.#blockStart(index, block); offset < end; offset++) {
          if (!present || hasOffset(present, offset)) indexes[i++] = base + offset;
        }
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
  #previousAtPosition: StoreMap<number, number> | null;
  #unplaced: StoreMap<number, number> | null;
  #latestPosition = -Infinity;
  onForget?: (row: number) => void;
  trackEvictions = false;
  evicted: number | number[] | null = null;
  next: number;

  constructor(table?: Table, previous?: StreamRows) {
    if (previous) {
      this.retained = previous.retained.fork();
      this.#positions = previous.#positions.fork();
      this.#previousAtPosition = previous.#previousAtPosition?.size
        ? previous.#previousAtPosition.fork() : null;
      this.#unplaced = previous.#unplaced?.size
        ? previous.#unplaced.fork() : null;
      this.seedPositions = previous.seedPositions;
      this.#seedOffset = previous.#seedOffset;
      this.#seedStart = previous.#seedStart;
      this.#latestPosition = previous.#latestPosition;
      this.next = previous.next;
    } else {
      this.retained = new RawRows();
      this.#positions = new StoreMap();
      this.#previousAtPosition = null;
      this.#unplaced = null;
      if (table) this.retained.load(table);
      this.next = table?.length ?? 0;
    }
  }

  get size(): number { return this.retained.size; }
  get hasUnplaced(): boolean { return Boolean(this.#unplaced?.size); }

  fork(): StreamRows {
    return new StreamRows(undefined, this);
  }

  commit(): void {
    this.retained.commit();
    this.#positions.commit();
    this.#previousAtPosition?.commit();
    this.#unplaced?.commit();
  }

  record(position: number, row: number): void {
    if (!Number.isFinite(position)) {
      (this.#unplaced ??= new StoreMap()).set(row, this.#latestPosition);
      return;
    }
    this.#latestPosition = Math.max(position, this.#latestPosition);
    const previous = this.#positions.get(position);
    if (previous !== undefined) (this.#previousAtPosition ??= new StoreMap()).set(row, previous);
    this.#positions.set(position, row);
  }

  resetPositions(table: Table, positions: Float64Array, seed?: Float64Array): void {
    this.#positions = new StoreMap();
    this.#previousAtPosition = null;
    this.#unplaced = null;
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

  appendPositions(rows: readonly unknown[], positions: Float64Array, ascending: boolean): void {
    const start = this.next;
    this.append(rows);
    if (ascending && positions[0]! > this.#latestPosition) {
      for (let i = 0; i < positions.length; i++) this.#positions.set(positions[i]!, start + i);
      this.#latestPosition = positions[positions.length - 1]!;
    } else {
      for (let i = 0; i < positions.length; i++) this.record(positions[i]!, start + i);
    }
  }

  /** The dense append path has already checked that this x is new and in order. */
  appendPosition(row: object, position: number): void {
    this.retained.appendOne(this.next, row);
    this.#positions.set(position, this.next++);
    this.#latestPosition = position;
  }

  firstRowAt(position: number): number | undefined {
    return this.#positions.get(position) ??
      (this.seedPositions?.[this.#seedStart] === position ? this.#seedOffset + this.#seedStart : undefined);
  }

  evictSingle(position: number, row: number): void {
    // The dense window has exactly one retained row per position.
    if (this.seedPositions?.[this.#seedStart] === position) this.#seedStart++;
    else this.#positions.delete(position);
    this.forget(row);
  }

  isColumn(row: number): boolean { return this.retained.isColumn(row); }

  needsColumnCompaction(discarded: number): boolean { return this.retained.needsColumnCompaction(discarded); }

  previewAppend(row: object, evicted: number | undefined): FrameSource {
    // The preview overlays just the changed rows until its base is superseded or it is published.
    return new FrameSource(this.next + 1, this, undefined, row, evicted);
  }

  forget(row: number): void {
    if (this.trackEvictions) {
      if (this.evicted === null) this.evicted = row;
      else if (typeof this.evicted === 'number') this.evicted = [this.evicted, row];
      else this.evicted.push(row);
    }
    this.onForget?.(row);
    this.retained.forget(row);
  }

  evictRead(position: number, discard?: Discard): void {
    let row = this.#positions.get(position);
    if (row !== undefined) {
      const previousMap = this.#previousAtPosition;
      do {
        const previous: number | undefined = previousMap?.get(row);
        if (previous !== undefined) previousMap!.delete(row);
        discard?.(row, this.retained.isColumn(row));
        this.forget(row);
        row = previous;
      } while (row !== undefined);
      this.#positions.delete(position);
    }
    // Eviction walks positions in ascending order. Appended rows at this same x
    // have already been evicted from the delta above.
    if (this.seedPositions?.[this.#seedStart] === position) {
      const index = this.#seedOffset + this.#seedStart++;
      discard?.(index, true);
      this.forget(index);
    }
  }

  /** As `Observations.share`: the seed's remaining positions read from the store's window (see store.ts). */
  shareSeed(x: Float64Array, start: number, end: number): void {
    const seed = this.seedPositions;
    if (!seed) return;
    const shared = shareRemainder(seed, this.#seedStart, x, start, end);
    if (!shared || shared === seed) return;
    this.seedPositions = shared;
    this.#seedOffset += this.#seedStart;
    this.#seedStart = 0;
  }

  compactColumns(window?: ArrayBufferLike): void {
    this.retained.compactColumns();
    const seed = this.seedPositions;
    if (!seed || this.#seedStart * 2 < seed.length) return;
    if (seed.buffer === window && this.#seedStart < seed.length) return;
    this.seedPositions = this.#seedStart === seed.length ? null : seed.slice(this.#seedStart);
    this.#seedOffset += this.#seedStart;
    this.#seedStart = 0;
  }

  trimUnplacedRead(keep: number, first: number, observed: number, discard: Discard): void {
    const unplaced = this.#unplaced;
    if (!unplaced || unplaced.size === 0) return;
    // Invalid records need a bounded home even when every new record is unplaceable.
    const capacity = observed ? 2 * keep : keep;
    for (const [row, position] of unplaced) {
      if (unplaced.size <= capacity && (!observed || position >= first)) break;
      unplaced.delete(row);
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

  archive(row: number, target: RawRows, rolling = false): boolean {
    return this.retained.copy(row, target, rolling);
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
  #rows: StreamRows | null;
  #live: (() => boolean) | null;
  #store: RevisionStore<Frame> | null = null;
  #base: Frame | null = null;
  #window: RowWindow | null = null;
  #revision = 0;
  #custom: ((row: number) => unknown) | null = null;

  readonly #end: number;

  constructor(
    end: number, rows: StreamRows, live?: () => boolean,
    private appended?: object, private readonly evicted?: number,
  ) {
    this.#end = end;
    this.#rows = rows;
    this.#live = live ?? null;
  }

  rowAt(row: number): unknown {
    if (!Number.isInteger(row) || row < 0 || row >= this.#end) return null;
    if (this.#window) return this.#window.readRevision(this.#revision, row);
    if (this.#custom) return this.#custom(row);
    if (this.#rows) {
      if ((this.#store === null || this.#store.frame === this.#base) && (this.#live === null || this.#live())) {
        if (this.appended) {
          if (row === this.evicted) return null;
          if (row === this.#end - 1) return this.appended;
        }
        return this.#rows.rowAt(row);
      }
      this.release();
    }
    return null;
  }

  get limit(): number { return this.#end; }

  watchBase(store: RevisionStore<Frame>, base: Frame): void {
    this.#store = store;
    this.#base = base;
  }

  bindWindow(window: RowWindow, revision: number): void {
    this.release();
    this.#window = window;
    this.#revision = revision;
  }

  bind(read: (row: number) => unknown): void {
    this.release();
    this.#custom = read;
  }

  release(): void {
    this.#window = null;
    this.#rows = null;
    this.#live = null;
    this.#store = null;
    this.#base = null;
    this.#custom = null;
    this.appended = undefined;
  }
}

export class RowWindow {
  private readonly archived = new RawRows();
  readonly #lastSeen = new Map<number, number>();
  // A renderer may hold other revisions, but the latest source is the only one used on every append.
  #olderSources: Map<number, FrameSource> | null = null;
  #latestSource: FrameSource | null = null;
  #latestRevision = -Infinity;
  private rows: StreamRows | null;
  #closed = false;

  constructor(rows: StreamRows) {
    this.rows = rows;
  }

  get size(): number { return (this.rows?.size ?? 0) + this.archived.size; }
  get disposable(): boolean { return this.#closed && !this.#latestSource && !this.#olderSources?.size; }

  archive(row: number, rolling = false): void {
    const revision = this.#latestRevision;
    // Newly appended rows can be evicted before any accepted frame has addressed them.
    const source = this.#latestSource;
    if (!source || row >= source.limit || !this.rows?.archive(row, this.archived, rolling)) return;
    this.#lastSeen.set(row, revision);
  }

  readRevision(revision: number, row: number): unknown {
    const last = this.#lastSeen.get(row);
    return last === undefined ? this.rows?.rowAt(row) : revision <= last ? this.archived.rowAt(row) : null;
  }

  publish(revision: number, source: FrameSource, rows: StreamRows): void {
    this.rows = rows;
    if (this.#latestSource) (this.#olderSources ??= new Map()).set(this.#latestRevision, this.#latestSource);
    this.#latestRevision = revision;
    this.#latestSource = source;
    source.bindWindow(this, revision);
  }

  /**
   * The source rows a published revision's `rowAt` answers, ascending, or null when it is not one of this
   * window's live revisions. The rows still retained below its end, and the evicted rows kept for it.
   */
  retainedRows(revision: number, source: RowSource): ArrayLike<number> | null {
    const active = revision === this.#latestRevision ? this.#latestSource : this.#olderSources?.get(revision);
    if (active !== source || !this.rows) return null;
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
    if (this.disposable) this.rows = null;
  }

  retire(revision: number): void {
    if (this.#olderSources?.size) {
      for (const [number, source] of this.#olderSources) {
        if (number > revision) break;
        source.release();
        this.#olderSources.delete(number);
      }
    }
    if (this.#latestRevision <= revision && this.#latestSource) {
      this.#latestSource.release();
      this.#latestSource = null;
    }
    // A source row leaves a window once. Map insertion order is therefore eviction revision order.
    if (this.#lastSeen.size) {
      for (const [row, last] of this.#lastSeen) {
        if (last > revision) break;
        this.archived.forget(row);
        this.#lastSeen.delete(row);
      }
    }
    if (this.disposable) this.rows = null;
  }
}

export class RowRevisions {
  private readonly windows = new Set<RowWindow>();
  #retired = -Infinity;
  current: RowWindow;

  constructor(rows: StreamRows) {
    this.windows.add(this.current = new RowWindow(rows));
  }

  get size(): number {
    if (this.windows.size === 1) return this.current.size;
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
    // The controller releases after acceptance and again after presentation.
    if (revision <= this.#retired) return;
    this.#retired = revision;
    if (this.windows.size === 1) {
      this.current.retire(revision);
      return;
    }
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
    callDiagnostics: readonly DiagnosticInput[], apply: () => void, source = rows.source(),
  ): PreparedFrame<F> & { commit: ReturnType<typeof once> } {
    source.watchBase(this, base);
    const frame = result.source === source ? result : { ...result, source };
    const commit = once(() => this.current, () => {
      apply();
      this.latest = diagnostics;
      this.publish(frame, source);
    }, base);
    return { frame, diagnostics, callDiagnostics, commit };
  }

  protected commitRows(rows: StreamRows, evicted: number | readonly number[] | null, replacement: boolean): void {
    if (replacement) this.revisions.replace(rows);
    if (typeof evicted === 'number') this.revisions.current.archive(evicted);
    else if (evicted) {
      for (let i = 0; i < evicted.length; i++) this.revisions.current.archive(evicted[i]!);
    }
    rows.commit();
    this.rows = rows;
  }
}

export function nextVersion(frame: FrameVersion): FrameVersion {
  return { epoch: frame.epoch, revision: frame.revision + 1 };
}

export function checkVersion(base: FrameVersion, version: FrameVersion): void {
  if (version.revision <= base.revision || version.epoch <= base.epoch) {
    throw new Error('Encoding updates and replacements require a newer epoch and revision.');
  }
}

interface EncodingExtras<F extends Frame> {
  prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>;
  reencode(options: ResolvedOptions, version: FrameVersion): F;
  replace(data: unknown, options: ResolvedOptions, version: FrameVersion): F;
  prepareReplace(data: unknown, options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>;
}

/** Installed only by the development and benchmark store constructors. */
export function installEncodingExtras<F extends Frame, S extends EncodingExtras<F>>(proto: S, prepare: (
  this: S, rows: StreamRows, options: ResolvedOptions, version: FrameVersion, call: DiagnosticCollector,
  replacement: ReturnType<typeof resolveTable>,
) => PreparedFrame<F>): void {
  function commit(change: PreparedFrame<F>): F {
    change.commit();
    return change.frame;
  }
  proto.reencode = function (options, version) { return commit(this.prepareReencode(options, version)); };
  proto.replace = function (data, options, version) { return commit(this.prepareReplace(data, options, version)); };
  proto.prepareReplace = function (data, options, version) {
    const call = new DiagnosticCollector();
    const replacement = resolveTable(data, call);
    return prepare.call(this, new StreamRows(replacement.table), options, version, call, replacement);
  };
}

export function forwardDiagnostics(inputs: readonly DiagnosticInput[], sink: DiagnosticSink): void {
  for (let i = 0; i < inputs.length; i++) sink.add(inputs[i]!);
}
