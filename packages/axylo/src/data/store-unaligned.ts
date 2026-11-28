import type { DiagnosticInput, DiagnosticSink, DonutFrame, Frame, PointFrame } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import { buildDonut, buildPoints, type DataEnvironment, type FrameVersion } from './normalize';
import { resolveFields, retargetOptions, withoutTable, type ResolvedOptions } from './options';
import { Reports } from './reports';
import { lowerBound } from './search';
import { forwardDiagnostics, installEncodingExtras, nextVersion, RevisionStore, selectWindow, StreamRows } from './store-rows';
import { CalendarWindow } from './store-calendar';
import { StoreMap } from './store-map';
import { Column, Labels } from './store-window';
import { ByteCount, CallerBuffers, countColumn, countRevisions, type OwnedBytes } from './store-bytes';
import { batchTable, type Table } from './table';
import { retention, type PreparedFrame, type StoreAppendOptions } from './transaction';

const quiet: DiagnosticSink = { add() {} };

export interface Result<F> {
  readonly frame: F;
  readonly positions: Float64Array;
  readonly order: Int32Array | null;
}

type Build<F> = (options: ResolvedOptions, environment: DataEnvironment, sink: DiagnosticSink, version: FrameVersion) => Result<F>;

type Candidate<F extends Frame> = PreparedFrame<F> & { abort(): void };

export interface Storage<F> {
  frame(frame: F): F;
  extend(next: Result<F>, rows: StreamRows, firstRow: number, keep: number | undefined): Storage<F> | null;
  commit?(): void;
  countBytes?(bytes: ByteCount): void;
}

type Open<F> = (result: Result<F>, options: ResolvedOptions) => Storage<F> | null;

function ordered(positions: Float64Array, last: number = -Infinity): boolean {
  for (const position of positions) {
    if (!Number.isFinite(position) || position < last) return false;
    last = position;
  }
  return true;
}

function identity(rows: Int32Array, first: number): boolean {
  for (let i = 0; i < rows.length; i++) if (rows[i] !== first + i) return false;
  return true;
}

/**
 * One scatter series' storage. Two columns stay implicit while they add nothing (spec P7): the x position of
 * every retained row (`positions`) is the points' own x while no row lacks a y, and the source row of point i
 * is i + rowShift while every row has a point in row order.
 */
function openPoints({ frame, positions }: Result<PointFrame>): Storage<PointFrame> | null {
  const series = frame.series[0];
  if (frame.series.length !== 1 || !series?.row || !ordered(positions)) return null;
  const calendar = frame.xKind === 'time' ? new CalendarWindow(frame.timeZone ?? 'UTC') : null;
  let distinct = 0;
  let last = -Infinity;
  for (const position of positions) {
    if (position !== last) distinct++;
    last = position;
    calendar?.observe(position);
  }
  const complete = !series.missingX?.length && positions.length === series.x.length;
  return pointWindow(frame.xKind, complete ? null : new Column(positions), distinct,
    new Column(series.x), new Column(series.y),
    identity(series.row, 0) ? null : new Column(series.row), 0,
    new Column(series.missingX ?? new Float64Array()), new Column(series.missingRow ?? new Int32Array()), calendar);
}

function pointWindow(
  kind: PointFrame['xKind'],
  oldPositions: Column<Float64Array> | null, distinct: number,
  oldX: Column<Float64Array>, oldY: Column<Float64Array>,
  oldRow: Column<Int32Array> | null, rowShift: number,
  oldMissingX: Column<Float64Array>, oldMissingRow: Column<Int32Array>,
  oldCalendar: CalendarWindow | null,
): Storage<PointFrame> {
  function rowsOf(): Column<Int32Array> {
    const length = oldX.length;
    return new Column(Int32Array.from({ length }, (_, i) => i + rowShift));
  }

  const storage: Storage<PointFrame> = {
    extend(next: Result<PointFrame>, rows: StreamRows, firstRow: number, keep: number | undefined): Storage<PointFrame> | null {
      const series = next.frame.series[0];
      const last = (oldPositions ?? oldX).last;
      if (next.frame.xKind !== kind || !series?.row || !ordered(next.positions, last)) return null;
      // A tie can append if its y also sorts after the old tail. Otherwise the old snapshot
      // and the new sort order need different storage.
      const lastX = oldX.last;
      const lastY = oldY.last;
      if (lastX !== undefined && lastY !== undefined && series.x[0] === lastX && series.y[0]! < lastY) return null;

      const calendar = oldCalendar?.fork() ?? null;
      if (calendar) {
        for (const position of next.positions) calendar.observe(position);
        if (calendar.daily()) return null;
      }
      const complete = !series.missingX?.length && next.positions.length === series.x.length;
      let positions = oldPositions?.fork() ?? (complete ? null : new Column(oldX.view()));
      positions?.append(next.positions);
      const count = oldX.length;
      const row = oldRow?.fork() ?? (identity(series.row, count + rowShift) ? null : rowsOf());
      row?.append(series.row);
      const x = oldX.extend(series.x);
      const y = oldY.extend(series.y);
      const missingX = oldMissingX.extend(series.missingX);
      const missingRow = oldMissingRow.extend(series.missingRow);
      let shift = rowShift;
      let retained = distinct;
      let previous = last;
      for (let i = 0; i < next.positions.length; i++) {
        const position = next.positions[i]!;
        if (position !== previous) retained++;
        previous = position;
        rows.record(position, firstRow + i);
      }

      if (keep !== undefined && retained > keep) {
        const axis = (positions ?? x).view();
        let removed = 0;
        while (retained > keep) {
          const evicted = axis[removed]!;
          rows.evictRead(evicted);
          calendar?.evictPosition(evicted);
          do removed++; while (axis[removed] === evicted);
          retained--;
        }
        if (calendar?.daily()) return null;
        const first = axis[removed] ?? Infinity;
        const points = lowerBound(x.view(), first);
        positions?.drop(removed);
        x.drop(points);
        y.drop(points);
        if (row) row.drop(points);
        else shift += points;
        if (missingX.length) {
          const missing = lowerBound(missingX.view(), first);
          missingX.drop(missing);
          missingRow.drop(missing);
        }
        // Once the last row without a y has left, every retained row is a point again: positions repeat x.
        if (positions && !missingX.length && positions.length === x.length) {
          positions = null;
        }
      }

      return pointWindow(kind, positions, retained, x, y, row, shift, missingX, missingRow, calendar);
    },
    commit() { oldCalendar?.commit(); },
    frame(frame: PointFrame): PointFrame {
      // The frame's null row means "point i came from row i": once points have left the front, it needs the index.
      if (!oldRow && rowShift !== 0) oldRow = rowsOf();
      const missing = oldMissingX.length > 0;
      return { ...frame, series: [{
        ...frame.series[0]!, x: oldX.view(), y: oldY.view(), row: oldRow?.view() ?? null,
        missingX: missing ? oldMissingX.view() : undefined, missingRow: missing ? oldMissingRow.view() : undefined,
      }] };
    },
  };
  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
    storage.countBytes = bytes => {
      countColumn(oldPositions, bytes, 'x positions');
      countColumn(oldX, bytes, 'x');
      countColumn(oldY, bytes, 'y');
      countColumn(oldRow, bytes, 'row');
      countColumn(oldMissingX, bytes, 'missing x');
      countColumn(oldMissingRow, bytes, 'missing row');
    };
  }
  return storage;
}

function openSlices({ frame, positions }: Result<DonutFrame>): Storage<DonutFrame> | null {
  if (frame.labels.length !== positions.length || !frame.row) return null;
  const labels = new StoreMap(frame.labels.map((label, index) => [label, index]));
  if (labels.size !== frame.labels.length) return null;
  return sliceWindow(new Labels(frame.labels), labels, labels.size,
    new Column(frame.values), new Column(frame.slot), new Column(frame.row));
}

function sliceWindow(labels: Labels, positions: StoreMap<string, number>, next: number,
  values: Column<Float64Array>, slot: Column<Uint8Array>, row: Column<Int32Array>): Storage<DonutFrame> {
  const storage: Storage<DonutFrame> = {
    commit() { positions = positions.commit(); },
    frame: frame => ({ ...frame, labels: labels.view(), values: values.view(), slot: slot.view(), row: row.view() }),
    extend(result, rows, firstRow, keep) {
      const { frame } = result;
      if (frame.labels.length !== result.positions.length || !frame.row || frame.labels.some(label => positions.has(label))) return null;
      const names = labels.fork();
      const index = positions.fork();
      const y = values.extend(frame.values);
      const states = slot.extend(frame.slot);
      const source = row.extend(frame.row);
      for (let i = 0; i < frame.labels.length; i++) {
        const label = frame.labels[i]!;
        names.push(label);
        index.set(label, next + i);
        rows.record(next + i, firstRow + i);
      }
      if (keep !== undefined && names.length > keep) {
        const dropped = names.length - keep;
        for (let i = 0; i < dropped; i++) {
          const label = names.at(i);
          rows.evictRead(index.get(label)!);
          index.delete(label);
        }
        for (const c of [names, y, states, source]) c.drop(dropped);
      }
      return sliceWindow(names, index, next + frame.labels.length, y, states, source);
    },
  };
  if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
    storage.countBytes = bytes => {
      countColumn(values, bytes, 'values');
      countColumn(slot, bytes, 'slot');
      countColumn(row, bytes, 'row');
    };
  }
  return storage;
}

// Sample windows retain a contiguous suffix of arrival indexes, including rows whose value is missing.
export function dropOldSamples(rows: StreamRows, keep: number): number {
  const count = Math.max(0, rows.size - keep);
  const first = rows.next - rows.size;
  for (let i = first; i < first + count; i++) {
    rows.forget(i);
  }
  return count;
}

function removeRows(table: Table, result: Result<Frame>, keep: number, rows: StreamRows): number {
  if (result.frame.shape === 'aligned') {
    return dropOldSamples(rows, keep);
  }
  const before = rows.size;
  selectWindow(table, result, keep, row => rows.forget(row));
  return before - rows.size;
}

let installUnalignedExtras: () => void;

export class SampleStore<F extends Frame> extends RevisionStore<F, Candidate<F>> {
  #encoding: ResolvedOptions;
  #storage: Storage<F> | null;

  readonly #build: Build<F>;
  readonly #open: Open<F>;
  readonly #environment: DataEnvironment;
  readonly #sink: DiagnosticSink;

  constructor(
    type: 'scatter' | 'donut' | 'histogram',
    build: Build<F>,
    open: Open<F>,
    options: ResolvedOptions,
    environment: DataEnvironment,
    version: FrameVersion,
    sink: DiagnosticSink = quiet,
    resolve = resolveFields,
  ) {
    super(options.table, type, resolve);
    this.#build = build;
    this.#open = open;
    this.#environment = environment;
    this.#sink = sink;
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installUnalignedExtras();
    this.#encoding = withoutTable(options);
    const diagnostics = new DiagnosticCollector();
    const table = this.rows.table();
    const { result, storage } = this.#buildStorage(this.rows, { ...options, table }, version, diagnostics);
    this.latest = diagnostics.inputs();
    this.#storage = storage;
    this.publish(storage?.frame(result.frame) ?? result.frame);
    forwardDiagnostics(this.latest, sink);
  }

  get diagnostics(): readonly DiagnosticInput[] { return this.latest; }
  #buildStorage(
    rows: StreamRows, options: ResolvedOptions, version: FrameVersion, sink: DiagnosticCollector,
  ): { result: Result<F>; storage: Storage<F> | null } {
    const result = this.#build(options, this.#environment, sink, version);
    if (this.kind !== 'histogram') rows.resetPositions(options.table, result.positions);
    return { result, storage: sink.inputs().length ? null : this.#open(result, withoutTable(options)) };
  }

  prepareAppend(rows: readonly unknown[], options: StoreAppendOptions = {}): Candidate<F> {
    const base = this.current;
    const version = nextVersion(base);
    const keep = retention(options);
    const fast = this.#extendAppend(base, rows, version, keep);
    if (fast) return fast;
    const retained = this.rows.fork(true);
    retained.append(rows);
    let table = retained.table();
    const call = new DiagnosticCollector();
    const rebuild = (sink: DiagnosticSink) => this.#build(retargetOptions(this.#encoding, table, sink), this.#environment, sink, version);
    let result = rebuild(call);
    const ordering = new DiagnosticCollector();
    if (this.kind === 'scatter') {
      const reports = new Reports(this.#encoding.x.field, ordering);
      let highest = -Infinity;
      for (let i = 0; i < result.positions.length; i++) {
        const position = result.positions[i]!;
        if (!Number.isFinite(position)) continue;
        const row = table.rowIndex(i);
        if (row >= this.rows.next && position < highest) reports.add('AX151', 'none', row);
        highest = Math.max(highest, position);
      }
      reports.flush(ordering);
    }
    let current = call;
    // Removing rows can change the inferred kind and make formerly unplaceable x values usable.
    while (keep !== undefined && removeRows(table, result, keep, retained)) {
      current = new DiagnosticCollector();
      table = retained.table();
      result = rebuild(current);
    }
    retained.compactColumns();
    const ordered = ordering.inputs();
    const diagnostics = [...current.inputs(), ...ordered];
    if (this.kind !== 'histogram') retained.resetPositions(table, result.positions);
    return this.#prepare(base, result.frame, retained, diagnostics.length ? null : this.#open(result, this.#encoding),
      diagnostics, [...call.inputs(), ...ordered]);
  }

  #extendAppend(base: F, rows: readonly unknown[], version: FrameVersion, keep: number | undefined): Candidate<F> | null {
    // Implicit string parsing and diagnostics can change when old rows leave. Reuse old values only when
    // both partitions have unambiguous clean values and the same x interpretation.
    if (!this.#storage || this.#encoding.values[0]?.parse || this.#encoding.series !== null) return null;
    const table = batchTable(rows, this.rows.next);
    const diagnostics = new DiagnosticCollector();
    const resolved = retargetOptions(this.#encoding, table, diagnostics);
    if (!resolved.valid) return null;
    const result = this.#build(resolved, this.#environment, diagnostics, version);
    if (diagnostics.inputs().length) return null;
    const retained = this.rows.fork(true);
    retained.append(rows);
    const extension = this.#storage.extend(result, retained, this.rows.next, keep);
    if (!extension) return null;
    retained.compactColumns();
    return this.#prepare(base, result.frame, retained, extension, [], []);
  }

  protected override encode(base: F, rows: StreamRows, resolved: ResolvedOptions, options: ResolvedOptions,
    version: FrameVersion, call: DiagnosticCollector, replacement: boolean): Candidate<F> {
    // Some replacements validate the caller's columns but publish values through the new store's source rows.
    const input = replacement ? { ...resolved, table: rows.table() } : resolved;
    const { result, storage } = this.#buildStorage(rows, input, version, call);
    const diagnostics = call.inputs();
    return this.#prepare(base, result.frame, rows, storage, diagnostics, diagnostics, options, replacement);
  }

  #prepare(
    base: F, frame: F, rows: StreamRows, storage: Storage<F> | null,
    diagnostics: readonly DiagnosticInput[], callDiagnostics: readonly DiagnosticInput[],
    options = this.#encoding, replacement = false,
  ): Candidate<F> {
    const candidate = this.preview(base, storage?.frame(frame) ?? frame, rows, diagnostics, callDiagnostics, () => {
      this.commitRows(rows, replacement);
      storage?.commit?.();
      this.#storage = storage;
      if (options !== this.#encoding) this.#encoding = withoutTable(options);
    });
    return Object.assign(candidate, { abort: candidate.commit.abort });
  }
  static {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installUnalignedExtras = () => {
      if (Object.hasOwn(SampleStore.prototype, 'ownedBytes')) return;
      type Store = SampleStore<PointFrame | DonutFrame>;
      const proto = SampleStore.prototype as Store;
      proto.ownedBytes = function (this: Store, frames: readonly Frame[] = []): OwnedBytes {
        const bytes = new ByteCount(new CallerBuffers());
        const storage = this.#storage;
        storage?.countBytes?.(bytes);
        countRevisions(this.revisions, bytes);
        bytes.frame(this.current);
        for (const frame of frames) bytes.frame(frame);
        return bytes.result();
      };
      proto.append = function (this: Store, rows: readonly unknown[], options: StoreAppendOptions = {}, sink = this.#sink) {
        const prepared = this.prepareAppend(rows, options);
        forwardDiagnostics(prepared.callDiagnostics, sink);
        prepared.commit();
        return prepared.frame;
      };
      installEncodingExtras<PointFrame | DonutFrame, Store>(proto);
    };
  }
}

/**
 * Members only tests and the benchmark's memory probe use (spec P7's byte count; one-step conveniences over
 * prepare and commit). Development and benchmark builds install them when the first store is made; the
 * production file has none of them.
 */
export interface SampleStore<F extends Frame> {
  /** The typed storage beyond the caller's columns, with frames still held counted in the same set (P7). */
  ownedBytes(frames?: readonly Frame[]): OwnedBytes;
  append(rows: readonly unknown[], options?: StoreAppendOptions, sink?: DiagnosticSink): F;
  reencode(options: ResolvedOptions, version: FrameVersion): F;
  replace(data: unknown, options: ResolvedOptions, version: FrameVersion): F;
  prepareReplace(data: unknown, options: ResolvedOptions, version: FrameVersion): PreparedFrame<F>;
}

export class PointStore extends SampleStore<PointFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('scatter', buildPoints, openPoints, options, environment, version, sink);
  }
}

export class DonutStore extends SampleStore<DonutFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('donut', buildDonut, openSlices, options, environment, version, sink);
  }
}

// The first append's storage for a static frame, in the form a chart kind's composition holds.
export const openPointStore = (frame: PointFrame, source: ResolvedOptions, _data: unknown, environment: DataEnvironment): PointStore =>
  new PointStore(source, environment, frame);
export const openDonutStore = (frame: DonutFrame, source: ResolvedOptions, _data: unknown, environment: DataEnvironment): DonutStore =>
  new DonutStore(source, environment, frame);
