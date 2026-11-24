import type { DiagnosticInput, DiagnosticSink, DonutFrame, Frame, PointFrame } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import { normalizeDonut, buildPoints, type DataEnvironment, type FrameVersion } from './normalize';
import { resolveFields, resolveTable, retargetOptions, withoutTable, type ResolvedOptions } from './options';
import { Reports } from './reports';
import { lowerBound } from './search';
import { forwardDiagnostics, RevisionStore, retentionStart, StreamRows } from './store-rows';
import { CalendarWindow } from './store-calendar';
import { StoreMap } from './store-map';
import { Column, Labels } from './store-window';
import { ByteCount, CallerBuffers, countColumn, countRevisions, type OwnedBytes } from './store-bytes';
import { rowsTable, type Table } from './table';
import { retention, type PreparedFrame, type StoreAppendOptions } from './transaction';
import { nameOf } from './x';

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

const doubles = (length: number) => new Float64Array(length);
const indexes = (length: number) => new Int32Array(length);
const states = (length: number) => new Uint8Array(length);

function buildDonut(options: ResolvedOptions, environment: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Result<DonutFrame> {
  const frame = normalizeDonut(options, environment, sink, version);
  const positions = new Float64Array(options.valid ? options.table.length : 0).fill(NaN);
  const labels = new Map<string, number>();
  const order = new Int32Array(frame.labels.length);
  let length = 0;
  for (let i = 0; i < positions.length; i++) {
    const label = nameOf(options.table.read(i, options.x.field));
    if (label === null) continue;
    let index = labels.get(label);
    if (index === undefined) labels.set(label, index = labels.size);
    positions[i] = index;
    order[length++] = i;
  }
  order.sort((a, b) => positions[a]! - positions[b]!);
  return { frame, positions, order };
}

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

function extended<T extends Float64Array | Int32Array | Uint8Array>(column: Column<T>, values?: T): Column<T> {
  const draft = column.fork();
  if (values) draft.append(values);
  return draft;
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
  return pointWindow(frame.xKind, complete ? null : new Column(doubles, positions), distinct,
    new Column(doubles, series.x), new Column(doubles, series.y),
    identity(series.row, 0) ? null : new Column(indexes, series.row), 0,
    new Column(doubles, series.missingX ?? new Float64Array()), new Column(indexes, series.missingRow ?? new Int32Array()), calendar);
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
    const length = oldX.view().length;
    return new Column(indexes, Int32Array.from({ length }, (_, i) => i + rowShift));
  }

  const storage: Storage<PointFrame> = {
    extend(next: Result<PointFrame>, rows: StreamRows, firstRow: number, keep: number | undefined): Storage<PointFrame> | null {
      const series = next.frame.series[0];
      const last = (oldPositions ?? oldX).view().at(-1);
      if (next.frame.xKind !== kind || !series?.row || !ordered(next.positions, last)) return null;
      // A tie can append if its y also sorts after the old tail. Otherwise the old snapshot
      // and the new sort order need different storage.
      const lastX = oldX.view().at(-1);
      const lastY = oldY.view().at(-1);
      if (lastX !== undefined && lastY !== undefined && series.x[0] === lastX && series.y[0]! < lastY) return null;

      const calendar = oldCalendar?.fork() ?? null;
      if (calendar) {
        for (const position of next.positions) calendar.observe(position);
        if (calendar.daily()) return null;
      }
      const complete = !series.missingX?.length && next.positions.length === series.x.length;
      let positions = oldPositions?.fork() ?? (complete ? null : new Column(doubles, oldX.view()));
      positions?.append(next.positions);
      const count = oldX.view().length;
      const row = oldRow?.fork() ?? (identity(series.row, count + rowShift) ? null : rowsOf());
      row?.append(series.row);
      const x = extended(oldX, series.x);
      const y = extended(oldY, series.y);
      const missingX = extended(oldMissingX, series.missingX);
      const missingRow = extended(oldMissingRow, series.missingRow);
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
        const missing = lowerBound(missingX.view(), first);
        missingX.drop(missing);
        missingRow.drop(missing);
        // Once the last row without a y has left, every retained row is a point again: positions repeat x.
        if (positions && !missingX.view().length && positions.view().length === x.view().length) {
          positions = null;
        }
      }

      return pointWindow(kind, positions, retained, x, y, row, shift, missingX, missingRow, calendar);
    },
    commit() { oldCalendar?.commit(); },
    frame(frame: PointFrame): PointFrame {
      // The frame's null row means "point i came from row i": once points have left the front, it needs the index.
      if (!oldRow && rowShift !== 0) oldRow = rowsOf();
      const missingX = oldMissingX.view();
      const missing = missingX.length > 0;
      return { ...frame, series: [{
        ...frame.series[0]!, x: oldX.view(), y: oldY.view(), row: oldRow?.view() ?? null,
        missingX: missing ? missingX : undefined, missingRow: missing ? oldMissingRow.view() : undefined,
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
  const labels = new Map(frame.labels.map((label, index) => [label, index]));
  if (labels.size !== frame.labels.length) return null;
  return sliceWindow(new Labels(frame.labels), new StoreMap(labels), labels.size,
    new Column(doubles, frame.values), new Column(states, frame.slot), new Column(indexes, frame.row));
}

function sliceWindow(labels: Labels, positions: StoreMap<string, number>, next: number,
  values: Column<Float64Array>, slot: Column<Uint8Array>, row: Column<Int32Array>): Storage<DonutFrame> {
  const storage: Storage<DonutFrame> = {
    commit() { positions.commit(); },
    frame: frame => ({ ...frame, labels: labels.view(), values: values.view(), slot: slot.view(), row: row.view() }),
    extend(result, rows, firstRow, keep) {
      const { frame } = result;
      if (frame.labels.length !== result.positions.length || !frame.row || frame.labels.some(label => positions.has(label))) return null;
      const names = labels.fork();
      const index = positions.fork();
      const y = extended(values, frame.values);
      const states = extended(slot, frame.slot);
      const source = extended(row, frame.row);
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
        names.drop(dropped);
        y.drop(dropped);
        states.drop(dropped);
        source.drop(dropped);
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
export function dropOldSamples(rows: StreamRows, keep: number, evicted?: number[]): number {
  const count = Math.max(0, rows.size - keep);
  const first = rows.next - rows.size;
  for (let i = first; i < first + count; i++) {
    rows.forget(i);
    evicted?.push(i);
  }
  return count;
}

function removeRows(table: Table, result: Result<Frame>, keep: number, rows: StreamRows, evicted: number[]): number {
  if (result.frame.shape === 'aligned') {
    return dropOldSamples(rows, keep, evicted);
  }
  const { positions } = result;
  const first = retentionStart(result, keep);
  let unplaced = 0;
  for (let i = 0; i < table.length; i++) {
    if (!Number.isFinite(positions[i])) unplaced++;
  }
  let excess = Math.max(0, unplaced - 2 * keep);
  const before = evicted.length;
  for (let i = 0; i < table.length; i++) {
    const position = positions[i]!;
    if (Number.isFinite(position) ? position >= first : excess-- <= 0) continue;
    const row = table.rowIndex(i);
    rows.forget(row);
    evicted.push(row);
  }
  return evicted.length - before;
}

export class SampleStore<F extends Frame> extends RevisionStore<F> {
  private encoding: ResolvedOptions;
  private storage: Storage<F> | null;

  constructor(
    private readonly type: 'scatter' | 'donut' | 'histogram',
    private readonly build: Build<F>,
    private readonly open: Open<F>,
    options: ResolvedOptions,
    private readonly environment: DataEnvironment,
    version: FrameVersion,
    private readonly sink: DiagnosticSink = quiet,
    private readonly resolve = resolveFields,
  ) {
    super(options.table);
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installUnalignedExtras();
    this.encoding = withoutTable(options);
    const diagnostics = new DiagnosticCollector();
    const table = this.rows.table();
    const result = build({ ...options, table }, environment, diagnostics, version);
    const { frame, positions } = result;
    if (this.type !== 'histogram') this.rows.resetPositions(table, positions);
    this.latest = diagnostics.inputs();
    this.storage = this.latest.length ? null : this.open(result, this.encoding);
    this.publish(this.storage?.frame(frame) ?? frame);
    forwardDiagnostics(this.latest, sink);
  }

  get diagnostics(): readonly DiagnosticInput[] { return this.latest; }
  resolveEncoding(input: unknown, sink: DiagnosticSink): ResolvedOptions {
    return withoutTable(this.resolve(this.type, input, sink, this.rows.table()));
  }

  prepareAppend(rows: readonly unknown[], options: StoreAppendOptions = {}): Candidate<F> {
    const base = this.current;
    const version = { epoch: base.epoch, revision: base.revision + 1 };
    const keep = retention(options);
    const fast = this.extendAppend(base, rows, version, keep);
    if (fast) return fast;
    const retained = this.rows.fork();
    retained.append(rows);
    let table = retained.table();
    const call = new DiagnosticCollector();
    const rebuild = (sink: DiagnosticSink) => this.build(retargetOptions(this.encoding, table, sink), this.environment, sink, version);
    let result = rebuild(call);
    const ordering = new DiagnosticCollector();
    if (this.type === 'scatter') {
      const reports = new Reports(this.encoding.x.field, ordering);
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
    const evicted: number[] = [];
    // Removing rows can change the inferred kind and make formerly unplaceable x values usable.
    while (keep !== undefined && removeRows(table, result, keep, retained, evicted)) {
      current = new DiagnosticCollector();
      table = retained.table();
      result = rebuild(current);
    }
    retained.compactColumns();
    const ordered = ordering.inputs();
    const diagnostics = [...current.inputs(), ...ordered];
    if (this.type !== 'histogram') retained.resetPositions(table, result.positions);
    return this.prepare(base, result.frame, retained, diagnostics.length ? null : this.open(result, this.encoding),
      diagnostics, [...call.inputs(), ...ordered], evicted);
  }

  private extendAppend(base: F, rows: readonly unknown[], version: FrameVersion, keep: number | undefined): Candidate<F> | null {
    // Implicit string parsing and diagnostics can change when old rows leave. Reuse old values only when
    // both partitions have unambiguous clean values and the same x interpretation.
    if (!this.storage || this.encoding.values[0]?.parse || this.encoding.series !== null) return null;
    const table = { ...rowsTable(rows), rowIndex: (row: number) => this.rows.next + row };
    const diagnostics = new DiagnosticCollector();
    const resolved = retargetOptions(this.encoding, table, diagnostics);
    if (!resolved.valid) return null;
    const result = this.build(resolved, this.environment, diagnostics, version);
    if (diagnostics.inputs().length) return null;
    const retained = this.rows.fork();
    const evicted: number[] = [];
    retained.onForget = row => evicted.push(row);
    retained.append(rows);
    const extension = this.storage.extend(result, retained, this.rows.next, keep);
    retained.onForget = undefined;
    if (!extension) return null;
    retained.compactColumns();
    return this.prepare(base, result.frame, retained, extension, [], [], evicted);
  }

  prepareReencode(options: ResolvedOptions, version: FrameVersion): Candidate<F> {
    return this.prepareEncoding(this.rows.fork(), options, version, new DiagnosticCollector());
  }

  private prepareEncoding(
    rows: StreamRows, options: ResolvedOptions, version: FrameVersion, call: DiagnosticCollector,
    replacement?: { table: Table; valid: boolean },
  ): Candidate<F> {
    const base = this.current;
    if (version.revision <= base.revision || version.epoch <= base.epoch) {
      throw new Error('Encoding updates and replacements require a newer epoch and revision.');
    }
    const table = rows.table();
    const resolved = retargetOptions(options, replacement?.table ?? table, call, replacement?.valid);
    const result = this.build({ ...resolved, table }, this.environment, call, version);
    if (this.type !== 'histogram') rows.resetPositions(table, result.positions);
    const diagnostics = call.inputs();
    return this.prepare(base, result.frame, rows, diagnostics.length ? null : this.open(result, withoutTable(options)), diagnostics, diagnostics, [], options, replacement !== undefined);
  }

  private prepare(
    base: F, frame: F, rows: StreamRows, storage: Storage<F> | null,
    diagnostics: readonly DiagnosticInput[], callDiagnostics: readonly DiagnosticInput[],
    evicted: readonly number[], options = this.encoding, replacement = false,
  ): Candidate<F> {
    const candidate = this.preview(base, storage?.frame(frame) ?? frame, rows, diagnostics, callDiagnostics, () => {
      this.commitRows(rows, evicted, replacement);
      storage?.commit?.();
      this.storage = storage;
      if (options !== this.encoding) this.encoding = withoutTable(options);
    });
    return { ...candidate, abort: candidate.commit.abort };
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

let unalignedExtras = false;
function installUnalignedExtras(): void {
  if (unalignedExtras) return;
  unalignedExtras = true;
  type Store = SampleStore<PointFrame | DonutFrame>;
  const proto = SampleStore.prototype as Store;
  proto.ownedBytes = function (this: Store, frames: readonly Frame[] = []): OwnedBytes {
    const bytes = new ByteCount(new CallerBuffers());
    const storage = this['storage'];
    storage?.countBytes?.(bytes);
    countRevisions(this['revisions'], bytes);
    bytes.frame(this['current']);
    for (const frame of frames) bytes.frame(frame);
    return bytes.result();
  };
  proto.append = function (this: Store, rows: readonly unknown[], options: StoreAppendOptions = {}, sink = this['sink']) {
    const prepared = this.prepareAppend(rows, options);
    forwardDiagnostics(prepared.callDiagnostics, sink);
    prepared.commit();
    return prepared.frame;
  };
  proto.reencode = function (this: Store, options: ResolvedOptions, version: FrameVersion) {
    const prepared = this.prepareReencode(options, version);
    prepared.commit();
    return prepared.frame;
  };
  proto.prepareReplace = function (this: Store, data: unknown, options: ResolvedOptions, version: FrameVersion) {
    const call = new DiagnosticCollector();
    const replacement = resolveTable(data, call);
    return this['prepareEncoding'](new StreamRows(replacement.table), options, version, call, replacement);
  };
  proto.replace = function (this: Store, data: unknown, options: ResolvedOptions, version: FrameVersion) {
    const prepared = this.prepareReplace(data, options, version);
    prepared.commit();
    return prepared.frame;
  };
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
