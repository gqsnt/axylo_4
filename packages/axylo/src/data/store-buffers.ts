import { mapValues } from './store-map';
import { BufferWindow } from './store-window';
import { SLOT_NO_ROW, SLOT_VALUE, type AlignedFrame, type RowSource, type Series, type XColumn } from '../core/contracts';
import { lazyColumns } from './store-bytes';
import { denseSeries, seriesSlots, sharedStatesFor } from './store-statistics';

interface OpenSlot {
  readonly index: number;
  exposed: boolean;
  claimed: boolean;
  readonly y: number;
  readonly slot: number;
  readonly row: number;
}

type SeriesDescription = Omit<Series, 'y' | 'slot' | 'row'>;
export interface SeriesBuffers {
  description: SeriesDescription;
  y: Float64Array;
  /**
   * null while every slot is SLOT_VALUE: a continuous million-point line would otherwise own a megabyte of
   * zeros (spec P7). Made, at the y column's capacity, by the first write of any other state.
   */
  slot: Uint8Array | null;
  /**
   * null while every slot came from the row with the same number (shifted by `FrameBuffers.rowShift`): a
   * typed-column frame has no row index, and a dense identity index would cost 4 bytes a slot (spec P7).
   */
  row: Int32Array | null;
  tail?: OpenSlot;
}

function buffers(description: SeriesDescription, capacity: number, rows = true): SeriesBuffers {
  return {
    description, y: new Float64Array(capacity), slot: null,
    row: rows ? new Int32Array(capacity) : null,
  };
}

export function copyWindow<T extends Float64Array | Uint8Array | Int32Array>(
  source: T, start: number, end: number, capacity: number, offset = 0,
): T {
  const copy = new (source.constructor as new (length: number) => T)(capacity);
  copy.set(source.subarray(start, end), offset);
  return copy;
}

/** Writes one slot state, making the state column only when the state is not SLOT_VALUE. */
export function writeSlot(series: SeriesBuffers, index: number, state: number): void {
  if (series.slot) series.slot[index] = state;
  else if (state !== SLOT_VALUE) (series.slot = sharedStatesFor(series.y))[index] = state;
}

// Spare slots when storage opens. The store opens on the first append to a static chart, so the copy
// made here is what P7 measures: a large chart gets only a small tail. Later growth doubles the window.
function openingCapacity(length: number): number {
  return length + Math.max(16, Math.min(Math.ceil(length / 8), 4096));
}

export class FrameBuffers {
  x: Float64Array;
  /** null while every slot of the window has an observation (no gap slot was ever stored). */
  private observedFlags: Uint8Array | null;
  private categoryPositions: Float64Array;
  #series: Map<string, SeriesBuffers>;
  #sharedSeries = false;
  #range: BufferWindow;
  /** Source row of slot i for an identity series is i + rowShift; storage rebasing moves slots, not rows. */
  #rowShift: number;

  get start(): number { return this.#range.start; }
  get end(): number { return this.#range.end; }
  set end(end: number) { this.#range.end = end; }
  get series(): ReadonlyMap<string, SeriesBuffers> { return this.#series; }
  distinct: number;

  constructor(frame?: AlignedFrame | FrameBuffers, positions?: Float64Array, order: Int32Array | null = null, dense = false) {
    if (frame instanceof FrameBuffers) {
      this.#range = frame.#range.fork();
      // Dense drafts can share descriptors with explicit row indexes and no writable tail.
      this.#sharedSeries = dense && frame.#canShareSeries();
      this.#series = this.#sharedSeries ? frame.#series : mapValues(frame.#series, series => ({ ...series }));
      if (this.#sharedSeries) frame.#sharedSeries = true;
      this.x = frame.x;
      this.distinct = frame.distinct;
      this.observedFlags = frame.observedFlags;
      this.categoryPositions = frame.categoryPositions;
      this.#rowShift = frame.#rowShift;
      return;
    }
    this.#series = new Map();
    this.observedFlags = null;
    this.categoryPositions = new Float64Array();
    this.#rowShift = 0;
    this.#range = new BufferWindow(0, frame?.length ?? 0);
    this.distinct = 0;
    const capacity = openingCapacity(this.end);
    this.x = new Float64Array(capacity);
    if (!frame || !positions) return;
    this.x.set(frame.x.values);
    const flags = new Uint8Array(capacity);
    let slot = 0;
    const length = order?.length ?? positions.length;
    for (let i = 0; i < length; i++) {
      const x = positions[order?.[i] ?? i]!;
      while (slot < this.end && this.x[slot]! < x) slot++;
      if (slot < this.end && this.x[slot] === x && !flags[slot]) {
        flags[slot] = 1;
        this.distinct++;
      }
    }
    // Most frames observe every slot; the flags are kept only when an expected step has no observation.
    this.observedFlags = this.distinct === this.end ? null : flags;
    for (const source of frame.series) {
      const { key, label, field, unit, valueScale, drawable, y, row } = source;
      const description = { key, label, field, unit, valueScale, drawable };
      const series = buffers(description, capacity, row !== null);
      series.y.set(y);
      // A dense static series has no state column to copy; the fresh buffer is already all SLOT_VALUE.
      const slot = seriesSlots(source);
      if (slot) (series.slot = new Uint8Array(capacity)).set(slot);
      if (row) series.row!.set(row);
      this.#series.set(description.key, series);
    }
  }

  fork(dense = false): FrameBuffers {
    return new FrameBuffers(this, undefined, null, dense);
  }

  #canShareSeries(): boolean {
    for (const series of this.#series.values()) if (!series.row || series.tail) return false;
    return true;
  }

  #ownSeries(): Map<string, SeriesBuffers> {
    if (this.#sharedSeries) {
      this.#series = new Map(this.#series);
      this.#sharedSeries = false;
    }
    return this.#series;
  }

  deleteSeries(key: string): void { this.#ownSeries().delete(key); }
  clearSeries(): void { this.#ownSeries().clear(); }

  get hasCompetingWrites(): boolean { return this.#range.hasCompetingWrites; }

  /** Whether slot `index` holds an observed x (not only an expected step that no series had). */
  #observed(index: number): boolean {
    return this.observedFlags ? this.observedFlags[index] === 1 : index >= this.start && index < this.end;
  }

  /** Records the observed flags of slots written from `index`. Call after `reserve`. */
  markObserved(flags: Uint8Array | null, index: number, length: number): void {
    if (!flags) {
      this.observedFlags?.fill(1, index, index + length);
      this.distinct += length;
      return;
    }
    let observed = 0;
    for (let i = 0; i < flags.length; i++) observed += flags[i]!;
    this.distinct += observed;
    if (!this.observedFlags) {
      if (observed === length) return;
      this.observedFlags = new Uint8Array(this.x.length).fill(1, this.start, index);
    }
    this.observedFlags.set(flags, index);
  }

  /** Writes the source row of a slot, giving the series an explicit index the first time it stops being the identity. */
  setRow(series: SeriesBuffers, index: number, row: number): void {
    if (!series.row) {
      if (row === index + this.#rowShift) return;
      // A batch writes past `end` before it moves `end`: the slots it already wrote are identity rows too.
      this.#materializeRows(series, Math.max(this.end, index));
    }
    series.row![index] = row;
  }

  #materializeRows(series: SeriesBuffers, end = this.end): void {
    const rows = new Int32Array(this.x.length);
    for (let i = this.start; i < end; i++) rows[i] = i + this.#rowShift;
    series.row = rows;
  }

  reserve(extra: number): boolean {
    const capacity = this.#range.reserve(extra, this.x.length);
    const grow = capacity !== 0;
    if (grow) this.#resize(capacity, extra);
    // A rival may have claimed the base's tail. Reconstruct that tail before this
    // draft can publish a longer view in which the old slot is no longer special.
    else for (const series of this.series.values()) {
      if (series.tail?.claimed) this.copySeries(series);
    }
    return grow;
  }

  shrink(): void {
    const capacity = this.#range.compact(this.x.length);
    if (capacity) this.#resize(capacity, 0);
  }

  #resize(capacity: number, extra: number): void {
    const { start, end } = this;
    this.x = copyWindow(this.x, start, end, capacity);
    if (this.observedFlags) this.observedFlags = copyWindow(this.observedFlags, start, end, capacity);
    if (this.categoryPositions.length > capacity) this.categoryPositions = new Float64Array();
    for (const series of this.series.values()) this.copySeries(series, capacity, 0);
    this.#rowShift += start;
    this.#range.rebase(extra);
  }

  copySeries(series: SeriesBuffers, capacity = this.x.length, offset = this.start): SeriesBuffers {
    const { start, end } = this;
    const copy: SeriesBuffers = {
      description: series.description,
      y: copyWindow(series.y, start, end, capacity, offset),
      slot: series.slot ? copyWindow(series.slot, start, end, capacity, offset) : null,
      row: series.row ? copyWindow(series.row, start, end, capacity, offset) : null,
    };
    restoreTail(series.tail, copy, offset + end - start - 1);
    this.#ownSeries().set(series.description.key, copy);
    return copy;
  }

  writeTail(series: SeriesBuffers, hasCompetingWrites: boolean): SeriesBuffers {
    const tail = series.tail;
    // An advanced preview can expose this slot in the middle of its view. After a draw
    // has requested a column, a fill copies that series' window to protect the issued view.
    // Between draws the first writer claims the open slot and only touches the appended rows.
    if (!tail || tail.exposed || hasCompetingWrites) return this.copySeries(series);
    tail.claimed = true;
    series.tail = undefined;
    return series;
  }

  addSeries(description: SeriesDescription, zero: boolean): SeriesBuffers {
    const series = buffers(description, this.x.length);
    series.row!.fill(-1, this.start, this.end);
    if (!zero) {
      series.y.fill(NaN, this.start, this.end);
      // The new series had no row at any slot already in the window.
      if (this.end > this.start) (series.slot = sharedStatesFor(series.y)).fill(SLOT_NO_ROW, this.start, this.end);
    }
    this.#ownSeries().set(description.key, series);
    return series;
  }

  retainedStart(keep: number): number {
    let remove = this.distinct - keep;
    if (!this.observedFlags) return this.start + Math.max(0, remove);
    let first = this.start;
    while (remove > 0) remove -= this.observedFlags[first++]!;
    while (first < this.end && !this.observedFlags[first]) first++;
    return first;
  }

  trim(first: number, evict: (x: number, observed: boolean) => void): void {
    while (this.start < first) {
      const observed = this.#observed(this.start);
      if (observed) this.distinct--;
      evict(this.x[this.start]!, observed);
      this.#range.start++;
    }
  }

  dropObservedHead(): void {
    this.#range.start++;
    this.distinct--;
    this.shrink();
  }

  frame(previous: AlignedFrame, axis: XColumn, source: RowSource, open?: (key: string) => boolean,
    revision = previous.revision,
  ): AlignedFrame {
    const { start, end } = this;
    let positions = this.x.subarray(start, end);
    if (axis.kind === 'category' && positions[0]) {
      if (this.categoryPositions.length < positions.length) {
        const capacity = Math.max(16, positions.length * 2);
        this.categoryPositions = Float64Array.from({ length: capacity }, (_, i) => i);
      }
      positions = this.categoryPositions.subarray(0, positions.length);
    }
    const { kind, dateUnit, timeZone, ordered } = axis;
    const x = kind === 'category' ? {
      values: positions, kind, dateUnit, timeZone, ordered,
      get categories() { return end === start ? [] : axis.categories; },
    } : { values: positions, kind, dateUnit, timeZone, ordered, categories: null };
    const series: Series[] = [];
    for (const buffer of this.#series.values()) {
      // The frame's null row means "slot i came from row i", which holds only while nothing has shifted.
      if (!buffer.row && start + this.#rowShift !== 0 && end > start) this.#materializeRows(buffer);
      const { key } = buffer.description;
      if (start !== end && open?.(key)) {
        series.push(this.#openSeries(buffer, start, end));
      } else {
        const owned = buffer.y, y = owned.subarray(start, end), row = buffer.row?.subarray(start, end) ?? null;
        series.push(buffer.slot ? { ...buffer.description, y, slot: buffer.slot.subarray(start, end), row }
          : denseSeries({ ...buffer.description, y, row }, end - start,
            () => sharedStatesFor(owned).subarray(start, end)));
      }
    }
    const { shape, epoch, xLabel, yLabel, binEdges } = previous;
    const frame = { shape, epoch, xLabel, yLabel, source, revision, length: end - start, x, series };
    return binEdges === undefined ? frame : { ...frame, binEdges };
  }

  #openSeries(series: SeriesBuffers, start: number, end: number): Series {
    const { description, y, slot, row } = series;
    const index = end - 1;
    if (series.tail?.index !== index) {
      series.tail = {
        index, exposed: false, claimed: false, y: y[index]!, slot: slot ? slot[index]! : SLOT_VALUE,
        row: row ? row[index]! : index + this.#rowShift,
      };
    }
    const tail = series.tail;
    let values: Float64Array | undefined;
    let states: Uint8Array | undefined;
    let rows: Int32Array | undefined;
    const columns = {
      ...description,
      get y() { return values ??= readColumn(y, tail, start, end, tail.y); },
      get row() { return row ? rows ??= readColumn(row, tail, start, end, tail.row) : null; },
    };
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) lazyColumns.set(columns, () => [values, states, rows]);
    // Captured dense, the window was all SLOT_VALUE then, the open slot included, whatever a later writer stores.
    if (!slot) return denseSeries(columns, end - start, () => readColumn(sharedStatesFor(y), tail, start, end, SLOT_VALUE));
    Object.defineProperty(columns, 'slot', {
      configurable: true, enumerable: true,
      get() { return states ??= readColumn(slot, tail, start, end, tail.slot); },
    });
    return columns as Series;
  }
}

function restoreTail(tail: OpenSlot | undefined, series: SeriesBuffers, index: number): void {
  if (!tail?.claimed || index < 0) return;
  series.y[index] = tail.y;
  writeSlot(series, index, tail.slot);
  // An identity series keeps no index: the claimed slot's row was the identity and still is.
  if (series.row) series.row[index] = tail.row;
}

function readColumn<T extends Float64Array | Uint8Array | Int32Array>(
  data: T, tail: OpenSlot, start: number, end: number, value: number,
): T {
  if (!tail.claimed) {
    tail.exposed = true;
    return data.subarray(start, end) as T;
  }
  const snapshot = data.slice(start, end) as T;
  snapshot[snapshot.length - 1] = value;
  return snapshot;
}
