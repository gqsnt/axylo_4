import type { DiagnosticInput, DiagnosticSink, DonutFrame, Frame, PointFrame } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import { normalizeDonut, normalizePoints, pointFrame, readX, reportCalendarDates, type DataEnvironment, type FrameVersion } from './normalize';
import { resolveFields, resolveTable, retargetOptions, withoutTable, type ResolvedOptions } from './options';
import { Reports } from './reports';
import { lowerBound } from './search';
import { FrameSource, RowRevisions, StreamRows } from './store-rows';
import { CalendarWindow } from './store-calendar';
import { StoreMap } from './store-map';
import { Column, Labels } from './store-window';
import { ByteCount, CallerBuffers, countColumn, countRevisions, type OwnedBytes } from './store-bytes';
import { rowsTable, type Table } from './table';
import { once, retention, type PreparedFrame, type StoreAppendOptions } from './transaction';
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
}

type Open<F> = (result: Result<F>, options: ResolvedOptions) => Storage<F> | null;

const doubles = (length: number) => new Float64Array(length);
const indexes = (length: number) => new Int32Array(length);
const states = (length: number) => new Uint8Array(length);

function buildPoints(options: ResolvedOptions, environment: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Result<PointFrame> {
  if (!options.valid) {
    return { frame: normalizePoints(options, environment, sink, version), positions: new Float64Array(), order: null };
  }
  const x = readX('scatter', options, environment, sink);
  reportCalendarDates(x, options.table, sink);
  return { ...x, frame: pointFrame(options, x, sink, version) };
}

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

function firstPosition(result: Result<Frame>, keep: number): number {
  const { positions, order } = result;
  let first = Infinity;
  let distinct = 0;
  for (let i = (order?.length ?? positions.length) - 1; i >= 0; i--) {
    const position = positions[order?.[i] ?? i]!;
    if (position === first) continue;
    if (distinct === keep) return first;
    first = position;
    distinct++;
  }
  return -Infinity;
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

/**
 * One scatter series' storage. Two columns stay implicit while they add nothing (spec P7): the x position of
 * every retained row (`positions`) is the points' own x while no row lacks a y, and the source row of point i
 * is i + rowShift while every row has a point in row order.
 */
class Points implements Storage<PointFrame> {
  private constructor(
    private readonly kind: PointFrame['xKind'],
    private positions: Column<Float64Array> | null, private distinct: number,
    private readonly x: Column<Float64Array>, private readonly y: Column<Float64Array>,
    private row: Column<Int32Array> | null, private rowShift: number,
    private readonly missingX: Column<Float64Array>, private readonly missingRow: Column<Int32Array>,
    private readonly calendar: CalendarWindow | null,
  ) {}

  static open({ frame, positions }: Result<PointFrame>): Points | null {
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
    return new Points(frame.xKind, complete ? null : new Column(doubles, positions), distinct,
      new Column(doubles, series.x), new Column(doubles, series.y),
      identity(series.row, 0) ? null : new Column(indexes, series.row), 0,
      new Column(doubles, series.missingX ?? new Float64Array()), new Column(indexes, series.missingRow ?? new Int32Array()), calendar);
  }

  private rowsOf(): Column<Int32Array> {
    const length = this.x.view().length;
    return new Column(indexes, Int32Array.from({ length }, (_, i) => i + this.rowShift));
  }

  extend(next: Result<PointFrame>, rows: StreamRows, firstRow: number, keep: number | undefined): Points | null {
    const series = next.frame.series[0];
    const last = (this.positions ?? this.x).view().at(-1);
    if (next.frame.xKind !== this.kind || !series?.row || !ordered(next.positions, last)) return null;
    // A tie can append if its y also sorts after the old tail. Otherwise the old snapshot
    // and the new sort order need different storage.
    const lastX = this.x.view().at(-1);
    const lastY = this.y.view().at(-1);
    if (lastX !== undefined && lastY !== undefined && series.x[0] === lastX && series.y[0]! < lastY) return null;

    const calendar = this.calendar?.fork() ?? null;
    if (calendar) {
      for (const position of next.positions) calendar.observe(position);
      if (calendar.daily()) return null;
    }
    const complete = !series.missingX?.length && next.positions.length === series.x.length;
    const draft = new Points(this.kind,
      this.positions?.fork() ?? (complete ? null : new Column(doubles, this.x.view())), this.distinct,
      this.x.fork(), this.y.fork(), null, this.rowShift, this.missingX.fork(), this.missingRow.fork(), calendar);
    const count = this.x.view().length;
    draft.row = this.row?.fork() ?? (identity(series.row, count + this.rowShift) ? null : this.rowsOf());
    draft.positions?.append(next.positions);
    draft.x.append(series.x);
    draft.y.append(series.y);
    draft.row?.append(series.row);
    if (series.missingX) draft.missingX.append(series.missingX);
    if (series.missingRow) draft.missingRow.append(series.missingRow);
    let previous = last;
    for (let i = 0; i < next.positions.length; i++) {
      const position = next.positions[i]!;
      if (position !== previous) draft.distinct++;
      previous = position;
      rows.record(position, firstRow + i);
    }

    if (keep !== undefined && draft.distinct > keep) {
      const positions = (draft.positions ?? draft.x).view();
      let removed = 0;
      while (draft.distinct > keep) {
        const x = positions[removed]!;
        rows.evictRead(x);
        calendar?.evictPosition(x);
        do removed++; while (positions[removed] === x);
        draft.distinct--;
      }
      if (calendar?.daily()) return null;
      const first = positions[removed] ?? Infinity;
      const points = lowerBound(draft.x.view(), first);
      draft.positions?.drop(removed);
      draft.x.drop(points);
      draft.y.drop(points);
      if (draft.row) draft.row.drop(points);
      else draft.rowShift += points;
      const missing = lowerBound(draft.missingX.view(), first);
      draft.missingX.drop(missing);
      draft.missingRow.drop(missing);
      // Once the last row without a y has left, every retained row is a point again: positions repeat x.
      if (draft.positions && !draft.missingX.view().length && draft.positions.view().length === draft.x.view().length) {
        draft.positions = null;
      }
    }

    return draft;
  }

  commit(): void { this.calendar?.commit(); }

  frame(frame: PointFrame): PointFrame {
    // The frame's null row means "point i came from row i": once points have left the front, it needs the index.
    if (!this.row && this.rowShift !== 0) this.row = this.rowsOf();
    const missingX = this.missingX.view();
    const missing = missingX.length > 0;
    return { ...frame, series: [{
      ...frame.series[0]!, x: this.x.view(), y: this.y.view(), row: this.row?.view() ?? null,
      missingX: missing ? missingX : undefined, missingRow: missing ? this.missingRow.view() : undefined,
    }] };
  }
}

class Slices implements Storage<DonutFrame> {
  private constructor(
    private readonly labels: Labels, private readonly positions: StoreMap<string, number>, private next: number,
    private readonly values: Column<Float64Array>, private readonly slot: Column<Uint8Array>, private readonly row: Column<Int32Array>,
  ) {}

  static open({ frame, positions }: Result<DonutFrame>): Slices | null {
    if (frame.labels.length !== positions.length || !frame.row) return null;
    const labels = new Map(frame.labels.map((label, index) => [label, index]));
    if (labels.size !== frame.labels.length) return null;
    return new Slices(new Labels(frame.labels), new StoreMap(labels), labels.size,
      new Column(doubles, frame.values), new Column(states, frame.slot), new Column(indexes, frame.row));
  }

  commit(): void { this.positions.commit(); }

  extend(next: Result<DonutFrame>, rows: StreamRows, firstRow: number, keep: number | undefined): Slices | null {
    const frame = next.frame;
    if (frame.labels.length !== next.positions.length || !frame.row || frame.labels.some(label => this.positions.has(label))) return null;
    const draft = new Slices(this.labels.fork(), this.positions.fork(), this.next,
      this.values.fork(), this.slot.fork(), this.row.fork());
    for (let i = 0; i < frame.labels.length; i++) {
      const label = frame.labels[i]!;
      draft.labels.push(label);
      const position = draft.next++;
      draft.positions.set(label, position);
      rows.record(position, firstRow + i);
    }
    draft.values.append(frame.values);
    draft.slot.append(frame.slot);
    draft.row.append(frame.row);

    if (keep !== undefined && draft.labels.length > keep) {
      const dropped = draft.labels.length - keep;
      for (let i = 0; i < dropped; i++) {
        const label = draft.labels.at(i);
        rows.evictRead(draft.positions.get(label)!);
        draft.positions.delete(label);
      }
      draft.labels.drop(dropped);
      draft.values.drop(dropped);
      draft.slot.drop(dropped);
      draft.row.drop(dropped);
    }

    return draft;
  }

  frame(frame: DonutFrame): DonutFrame {
    return { ...frame, labels: this.labels.view(), values: this.values.view(), slot: this.slot.view(), row: this.row.view() };
  }
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

function removeRows(table: Table, result: Result<Frame>, keep: number, rows: StreamRows): number[] {
  if (result.frame.shape === 'aligned') {
    const evicted: number[] = [];
    dropOldSamples(rows, keep, evicted);
    return evicted;
  }
  const { positions } = result;
  const first = firstPosition(result, keep);
  let unplaced = 0;
  for (let i = 0; i < table.length; i++) {
    if (!Number.isFinite(positions[i])) unplaced++;
  }
  let excess = Math.max(0, unplaced - 2 * keep);
  const removed: number[] = [];
  for (let i = 0; i < table.length; i++) {
    const position = positions[i]!;
    if (Number.isFinite(position) ? position >= first : excess-- <= 0) continue;
    const row = table.rowIndex(i);
    rows.forget(row);
    removed.push(row);
  }
  return removed;
}

export class SampleStore<F extends Frame> {
  private rows: StreamRows;
  private readonly revisions: RowRevisions;
  private encoding: ResolvedOptions;
  private current: F;
  private latest: readonly DiagnosticInput[];
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
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installUnalignedExtras();
    this.rows = new StreamRows(options.table);
    this.revisions = new RowRevisions(this.rows);
    this.encoding = withoutTable(options);
    const diagnostics = new DiagnosticCollector();
    const table = this.rows.table();
    const result = build({ ...options, table }, environment, diagnostics, version);
    const { frame, positions } = result;
    if (this.type !== 'histogram') this.rows.resetPositions(table, positions);
    this.latest = diagnostics.inputs();
    this.storage = this.latest.length ? null : this.open(result, this.encoding);
    const source = new FrameSource(this.rows.next, this.rows);
    this.current = { ...(this.storage?.frame(frame) ?? frame), source };
    this.revisions.current.publish(frame.revision, source, this.rows);
    for (const diagnostic of this.latest) sink.add(diagnostic);
  }

  get diagnostics(): readonly DiagnosticInput[] { return this.latest; }
  get frame(): F { return this.current; }
  get retainedRowCount(): number { return this.revisions.size; }

  /**
   * The source rows `frame.source.rowAt` still answers, ascending, or null when the frame's revision is
   * retired or not one this store published. Imputed rows (row −1 in a series) are source rows too and listed.
   */
  retainedRows(frame: Frame): ArrayLike<number> | null { return this.revisions.retainedRows(frame); }

  /** Releases source rows through this revision. Held frame views keep their normalized values. */
  retire(revision: number): void { this.revisions.retire(Math.min(revision, this.current.revision)); }

  /** Validates encoding against the retained rows and returns options for re-encoding this store. */
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
    const resolved = retargetOptions(this.encoding, table, call);
    let result = this.build(resolved, this.environment, call, version);
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
    if (keep !== undefined) {
      // Removing rows can change the inferred kind and make formerly unplaceable x values usable.
      while (true) {
        const removed = removeRows(table, result, keep, retained);
        if (removed.length === 0) break;
        for (const row of removed) evicted.push(row);
        current = new DiagnosticCollector();
        table = retained.table();
        const encoded = retargetOptions(this.encoding, table, current);
        result = this.build(encoded, this.environment, current, version);
      }
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
    const source = new FrameSource(rows.next, rows, () => this.current === base);
    const candidate = { ...(storage?.frame(frame) ?? frame), source };
    const commit = once(() => this.current, () => {
      if (replacement) this.revisions.replace(rows);
      for (const row of evicted) this.revisions.current.archive(row);
      rows.commit();
      storage?.commit?.();
      this.rows = rows;
      this.current = candidate;
      this.latest = diagnostics;
      this.storage = storage;
      if (options !== this.encoding) this.encoding = withoutTable(options);
      this.revisions.current.publish(candidate.revision, source, rows);
    }, base);
    return { frame: candidate, diagnostics, callDiagnostics,
      commit, abort: commit.abort,
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

let unalignedExtras = false;
function installUnalignedExtras(): void {
  if (unalignedExtras) return;
  unalignedExtras = true;
  type Store = SampleStore<PointFrame | DonutFrame>;
  const proto = SampleStore.prototype as Store;
  proto.ownedBytes = function (this: Store, frames: readonly Frame[] = []): OwnedBytes {
    const bytes = new ByteCount(new CallerBuffers());
    const storage = this['storage'];
    if (storage instanceof Points) {
      countColumn(storage['positions'], bytes, 'x positions');
      countColumn(storage['x'], bytes, 'x');
      countColumn(storage['y'], bytes, 'y');
      countColumn(storage['row'], bytes, 'row');
      countColumn(storage['missingX'], bytes, 'missing x');
      countColumn(storage['missingRow'], bytes, 'missing row');
    } else if (storage instanceof Slices) {
      countColumn(storage['values'], bytes, 'values');
      countColumn(storage['slot'], bytes, 'slot');
      countColumn(storage['row'], bytes, 'row');
    }
    countRevisions(this['revisions'], bytes);
    bytes.frame(this['current']);
    for (const frame of frames) bytes.frame(frame);
    return bytes.result();
  };
  proto.append = function (this: Store, rows: readonly unknown[], options: StoreAppendOptions = {}, sink = this['sink']) {
    const prepared = this.prepareAppend(rows, options);
    for (const diagnostic of prepared.callDiagnostics) sink.add(diagnostic);
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
    super('scatter', buildPoints, Points.open, options, environment, version, sink);
  }
}

export class DonutStore extends SampleStore<DonutFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('donut', buildDonut, Slices.open, options, environment, version, sink);
  }
}

// The first append's storage for a static frame, in the form a chart kind's composition holds.
export const openPointStore = (frame: PointFrame, source: ResolvedOptions, _data: unknown, environment: DataEnvironment): PointStore =>
  new PointStore(source, environment, { epoch: frame.epoch, revision: frame.revision });
export const openDonutStore = (frame: DonutFrame, source: ResolvedOptions, _data: unknown, environment: DataEnvironment): DonutStore =>
  new DonutStore(source, environment, { epoch: frame.epoch, revision: frame.revision });
