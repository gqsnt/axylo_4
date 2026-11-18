import type { DiagnosticInput, DiagnosticSink, DonutFrame, PointFrame } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import { normalize, pointFrame, readX, reportCalendarDates, type DataEnvironment, type FrameVersion } from './normalize';
import { resolveOptions, resolveTable, retargetOptions, withoutTable, type ResolvedOptions } from './options';
import { Reports } from './reports';
import { FrameSource, RowRevisions, StreamRows } from './store-rows';
import { CalendarWindow } from './store-calendar';
import { StoreMap } from './store-map';
import { Column, Labels } from './store-window';
import { rowsTable, type Table } from './table';
import { once, retention, type PreparedFrame, type StoreAppendOptions } from './transaction';
import { nameOf } from './x';

const quiet: DiagnosticSink = { add() {} };

interface Result<F> {
  readonly frame: F;
  readonly positions: Float64Array;
  readonly order: Int32Array | null;
}

type Build<F> = (options: ResolvedOptions, environment: DataEnvironment, sink: DiagnosticSink, version: FrameVersion) => Result<F>;

interface Storage<F> {
  frame(frame: F): F;
  extend(next: Result<F>, rows: StreamRows, firstRow: number, keep: number | undefined): Storage<F> | null;
  commit(): void;
}

type Open<F> = (result: Result<F>) => Storage<F> | null;

const doubles = (length: number) => new Float64Array(length);
const indexes = (length: number) => new Int32Array(length);
const states = (length: number) => new Uint8Array(length);

function buildPoints(options: ResolvedOptions, environment: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Result<PointFrame> {
  if (!options.valid) {
    return { frame: normalize('scatter', options, environment, sink, version), positions: new Float64Array(), order: null };
  }
  const x = readX('scatter', options, environment, sink);
  reportCalendarDates(x, options.table, sink);
  return { ...x, frame: pointFrame(options, x, sink, version) };
}

function buildDonut(options: ResolvedOptions, environment: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Result<DonutFrame> {
  const frame = normalize('donut', options, environment, sink, version);
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

function firstPosition(result: Result<PointFrame | DonutFrame>, keep: number): number {
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

class Points implements Storage<PointFrame> {
  private constructor(
    private readonly kind: PointFrame['xKind'],
    private readonly positions: Column<Float64Array>, private distinct: number,
    private readonly x: Column<Float64Array>, private readonly y: Column<Float64Array>, private readonly row: Column<Int32Array>,
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
    return new Points(frame.xKind, new Column(doubles, positions), distinct,
      new Column(doubles, series.x), new Column(doubles, series.y), new Column(indexes, series.row), calendar);
  }

  extend(next: Result<PointFrame>, rows: StreamRows, firstRow: number, keep: number | undefined): Points | null {
    const series = next.frame.series[0];
    const last = this.positions.view().at(-1);
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
    const draft = new Points(this.kind, this.positions.fork(), this.distinct,
      this.x.fork(), this.y.fork(), this.row.fork(), calendar);
    draft.positions.append(next.positions);
    draft.x.append(series.x);
    draft.y.append(series.y);
    draft.row.append(series.row);
    let previous = last;
    for (let i = 0; i < next.positions.length; i++) {
      const position = next.positions[i]!;
      if (position !== previous) draft.distinct++;
      previous = position;
      rows.record(position, firstRow + i);
    }

    if (keep !== undefined && draft.distinct > keep) {
      const positions = draft.positions.view();
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
      const x = draft.x.view();
      let points = 0;
      while (points < x.length && x[points]! < first) points++;
      draft.positions.drop(removed);
      draft.x.drop(points);
      draft.y.drop(points);
      draft.row.drop(points);
    }

    return draft;
  }

  commit(): void { this.calendar?.commit(); }

  frame(frame: PointFrame): PointFrame {
    return { ...frame, series: [{ ...frame.series[0]!, x: this.x.view(), y: this.y.view(), row: this.row.view() }] };
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

function removeRows(table: Table, positions: Float64Array, keep: number, first: number, rows: StreamRows): number[] {
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

class UnalignedStore<F extends PointFrame | DonutFrame> {
  private rows: StreamRows;
  private readonly revisions: RowRevisions;
  private encoding: ResolvedOptions;
  private current: F;
  private latest: readonly DiagnosticInput[];
  private storage: Storage<F> | null;

  constructor(
    private readonly type: 'scatter' | 'donut',
    private readonly build: Build<F>,
    private readonly open: Open<F>,
    options: ResolvedOptions,
    private readonly environment: DataEnvironment,
    version: FrameVersion,
    private readonly sink: DiagnosticSink,
  ) {
    this.rows = new StreamRows(options.table);
    this.revisions = new RowRevisions(this.rows);
    this.encoding = withoutTable(options);
    const diagnostics = new DiagnosticCollector();
    const table = this.rows.table();
    const result = build({ ...options, table }, environment, diagnostics, version);
    const { frame, positions } = result;
    this.rows.resetPositions(table, positions);
    this.latest = diagnostics.inputs();
    this.storage = this.latest.length ? null : this.open(result);
    const source = new FrameSource(this.rows.next, this.rows);
    this.current = { ...(this.storage?.frame(frame) ?? frame), source };
    this.revisions.current.publish(frame.revision, source, this.rows);
    for (const diagnostic of this.latest) sink.add(diagnostic);
  }

  get frame(): F { return this.current; }
  get diagnostics(): readonly DiagnosticInput[] { return this.latest; }
  get retainedRowCount(): number { return this.revisions.size; }

  /** Releases source rows through this revision. Held frame views keep their normalized values. */
  retire(revision: number): void { this.revisions.retire(revision); }

  /** Validates encoding against the retained rows and returns options for re-encoding this store. */
  resolveEncoding(input: unknown, sink: DiagnosticSink): ResolvedOptions {
    return withoutTable(resolveOptions(this.type, input, sink, this.rows.table()));
  }

  append(rows: readonly unknown[], options: StoreAppendOptions = {}, sink = this.sink): F {
    const prepared = this.prepareAppend(rows, options);
    for (const diagnostic of prepared.callDiagnostics) sink.add(diagnostic);
    prepared.commit();
    return prepared.frame;
  }

  prepareAppend(rows: readonly unknown[], options: StoreAppendOptions = {}): PreparedFrame<F> {
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
        const removed = removeRows(table, result.positions, keep, firstPosition(result, keep), retained);
        if (removed.length === 0) break;
        for (const row of removed) evicted.push(row);
        current = new DiagnosticCollector();
        table = retained.table();
        const encoded = retargetOptions(this.encoding, table, current);
        result = this.build(encoded, this.environment, current, version);
      }
    }
    const ordered = ordering.inputs();
    const diagnostics = [...current.inputs(), ...ordered];
    retained.resetPositions(table, result.positions);
    return this.prepare(base, result.frame, retained, diagnostics.length ? null : this.open(result),
      diagnostics, [...call.inputs(), ...ordered], evicted);
  }

  private extendAppend(base: F, rows: readonly unknown[], version: FrameVersion, keep: number | undefined): PreparedFrame<F> | null {
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
    return this.prepare(base, result.frame, retained, extension, [], [], evicted);
  }

  reencode(options: ResolvedOptions, version: FrameVersion): F {
    const prepared = this.prepareReencode(options, version);
    prepared.commit();
    return prepared.frame;
  }

  prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<F> {
    return this.prepareEncoding(this.rows.fork(), options, version, new DiagnosticCollector());
  }

  replace(data: unknown, options: ResolvedOptions, version: FrameVersion): F {
    const prepared = this.prepareReplace(data, options, version);
    prepared.commit();
    return prepared.frame;
  }

  prepareReplace(data: unknown, options: ResolvedOptions, version: FrameVersion): PreparedFrame<F> {
    const call = new DiagnosticCollector();
    const replacement = resolveTable(data, call);
    return this.prepareEncoding(new StreamRows(replacement.table), options, version, call, replacement);
  }

  private prepareEncoding(
    rows: StreamRows, options: ResolvedOptions, version: FrameVersion, call: DiagnosticCollector,
    replacement?: { table: Table; valid: boolean },
  ): PreparedFrame<F> {
    const base = this.current;
    if (version.revision <= base.revision || version.epoch <= base.epoch) {
      throw new Error('Encoding updates and replacements require a newer epoch and revision.');
    }
    const table = rows.table();
    const resolved = retargetOptions(options, replacement?.table ?? table, call, replacement?.valid);
    const result = this.build({ ...resolved, table }, this.environment, call, version);
    rows.resetPositions(table, result.positions);
    const diagnostics = call.inputs();
    return this.prepare(base, result.frame, rows, diagnostics.length ? null : this.open(result), diagnostics, diagnostics, [], options, replacement !== undefined);
  }

  private prepare(
    base: F, frame: F, rows: StreamRows, storage: Storage<F> | null,
    diagnostics: readonly DiagnosticInput[], callDiagnostics: readonly DiagnosticInput[],
    evicted: readonly number[], options = this.encoding, replacement = false,
  ): PreparedFrame<F> {
    const source = new FrameSource(rows.next, rows, () => this.current === base);
    const candidate = { ...(storage?.frame(frame) ?? frame), source };
    const commit = once(() => this.current, () => {
      if (replacement) this.revisions.replace(rows);
      for (const row of evicted) this.revisions.current.archive(row);
      rows.commit();
      storage?.commit();
      this.rows = rows;
      this.current = candidate;
      this.latest = diagnostics;
      this.storage = storage;
      if (options !== this.encoding) this.encoding = withoutTable(options);
      this.revisions.current.publish(candidate.revision, source, rows);
    }, base);
    return { frame: candidate, diagnostics, callDiagnostics, commit };
  }
}

export class PointStore extends UnalignedStore<PointFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('scatter', buildPoints, Points.open, options, environment, version, sink);
  }
}

export class DonutStore extends UnalignedStore<DonutFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('donut', buildDonut, Slices.open, options, environment, version, sink);
  }
}
