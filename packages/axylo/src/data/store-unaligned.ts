import type { DiagnosticInput, DiagnosticSink, DonutFrame, PointFrame } from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import { normalize, pointFrame, readX, reportCalendarDates, type DataEnvironment, type FrameVersion } from './normalize';
import { resolveOptions, resolveTable, retargetOptions, withoutTable, type ResolvedOptions } from './options';
import { Reports } from './reports';
import { FrameSource, RowRevisions, StreamRows } from './store-rows';
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

interface Extension<F> {
  readonly frame: F;
  readonly positions: Float64Array;
  readonly dropped: number;
}

type Extend<F> = (frame: F, positions: Float64Array, next: Result<F>, keep: number | undefined) => Extension<F> | null;

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

function firstAtOrAfter(positions: Float64Array, first: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (positions[middle]! < first) low = middle + 1;
    else high = middle;
  }
  return low;
}

function ordered(positions: Float64Array, last: number = -Infinity): boolean {
  for (const position of positions) {
    if (!Number.isFinite(position) || position < last) return false;
    last = position;
  }
  return true;
}

function extendPoints(frame: PointFrame, positions: Float64Array, next: Result<PointFrame>, keep: number | undefined): Extension<PointFrame> | null {
  const before = frame.series[0];
  const after = next.frame.series[0];
  if (frame.xKind !== 'number' || next.frame.xKind !== 'number' || !before || !after ||
    frame.series.length !== 1 || next.frame.series.length !== 1 || !ordered(positions) ||
    !ordered(next.positions, positions.at(-1))) return null;

  const all = new Float64Array(positions.length + next.positions.length);
  all.set(positions);
  all.set(next.positions, positions.length);
  const first = keep === undefined ? -Infinity : firstPosition({ frame, positions: all, order: null }, keep);
  const dropped = firstAtOrAfter(all, first);
  let a = firstAtOrAfter(before.x, first);
  let b = firstAtOrAfter(after.x, first);
  const length = before.x.length + after.x.length - a - b;
  const x = new Float64Array(length);
  const y = new Float64Array(length);
  const row = new Int32Array(length);
  // The adjacent batches can share an x. Merge ties by y and preserve the source order of coincident points.
  for (let i = 0; i < length; i++) {
    const fromBefore = b === after.x.length || a < before.x.length &&
      (before.x[a]! < after.x[b]! || before.x[a] === after.x[b] && before.y[a]! <= after.y[b]!);
    const group = fromBefore ? before : after;
    const index = fromBefore ? a++ : b++;
    x[i] = group.x[index]!;
    y[i] = group.y[index]!;
    row[i] = group.row?.[index] ?? index;
  }
  return {
    frame: { ...next.frame, series: [{ ...before, x, y, row }] },
    positions: dropped ? all.slice(dropped) : all, dropped,
  };
}

function extendDonut(frame: DonutFrame, positions: Float64Array, next: Result<DonutFrame>, keep: number | undefined): Extension<DonutFrame> | null {
  if (frame.labels.length !== positions.length || next.frame.labels.length !== next.positions.length) return null;
  const names = new Set(frame.labels);
  const after = next.frame;
  if (after.labels.some(label => names.has(label))) return null;
  const count = frame.labels.length + after.labels.length;
  const dropped = keep === undefined ? 0 : Math.max(0, count - keep);
  const length = count - dropped;
  const labels = new Array<string>(length);
  const values = new Float64Array(length);
  const slot = new Uint8Array(length);
  const row = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    const index = dropped + i;
    const source = index < frame.labels.length ? frame : after;
    const offset = source === frame ? index : index - frame.labels.length;
    labels[i] = source.labels[offset]!;
    values[i] = source.values[offset]!;
    slot[i] = source.slot[offset]!;
    row[i] = source.row?.[offset] ?? offset;
  }
  return {
    frame: { ...after, labels, values, slot, row },
    positions: Float64Array.from({ length }, (_, i) => i), dropped,
  };
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
  private positions: Float64Array;

  constructor(
    private readonly type: 'scatter' | 'donut',
    private readonly build: Build<F>,
    private readonly extend: Extend<F>,
    options: ResolvedOptions,
    private readonly environment: DataEnvironment,
    version: FrameVersion,
    private readonly sink: DiagnosticSink,
  ) {
    this.rows = new StreamRows(options.table);
    this.revisions = new RowRevisions(this.rows);
    this.encoding = withoutTable(options);
    const diagnostics = new DiagnosticCollector();
    const { frame, positions } = build({ ...options, table: this.rows.table() }, environment, diagnostics, version);
    this.positions = positions;
    const source = new FrameSource(this.rows.next, this.rows);
    this.current = { ...frame, source };
    this.revisions.current.publish(frame.revision, source, this.rows);
    this.latest = diagnostics.inputs();
    for (const diagnostic of this.latest) sink.add(diagnostic);
  }

  get frame(): F { return this.current; }
  get diagnostics(): readonly DiagnosticInput[] { return this.latest; }
  get retainedRowCount(): number { return this.revisions.size; }

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
    return this.prepare(base, result.frame, retained, result.positions, [...current.inputs(), ...ordered], [...call.inputs(), ...ordered], evicted);
  }

  private extendAppend(base: F, rows: readonly unknown[], version: FrameVersion, keep: number | undefined): PreparedFrame<F> | null {
    // Implicit string parsing and diagnostics can change when old rows leave. Reuse old values only when
    // both partitions have unambiguous clean values and the same x interpretation.
    if (this.latest.length || this.encoding.values[0]?.parse || this.encoding.series !== null ||
      this.positions.length !== this.rows.size) return null;
    const table = { ...rowsTable(rows), rowIndex: (row: number) => this.rows.next + row };
    const diagnostics = new DiagnosticCollector();
    const resolved = retargetOptions(this.encoding, table, diagnostics);
    if (!resolved.valid) return null;
    const result = this.build(resolved, this.environment, diagnostics, version);
    if (diagnostics.inputs().length) return null;
    const extension = this.extend(base, this.positions, result, keep);
    if (!extension) return null;
    const retained = this.rows.fork();
    retained.append(rows);
    const evicted: number[] = [];
    if (extension.dropped > 0) {
      const combined = retained.table();
      for (let i = 0; i < extension.dropped; i++) {
        const row = combined.rowIndex(i);
        retained.forget(row);
        evicted.push(row);
      }
    }
    return this.prepare(base, extension.frame, retained, extension.positions, [], [], evicted);
  }

  reencode(options: ResolvedOptions, version: FrameVersion): F {
    const prepared = this.prepareReencode(options, version);
    prepared.commit();
    return prepared.frame;
  }

  prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<F> {
    return this.prepareEncoding(this.rows, options, version, new DiagnosticCollector());
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
    const { frame, positions } = this.build({ ...resolved, table }, this.environment, call, version);
    const diagnostics = call.inputs();
    return this.prepare(base, frame, rows, positions, diagnostics, diagnostics, [], options, replacement !== undefined);
  }

  private prepare(
    base: F, frame: F, rows: StreamRows, positions: Float64Array,
    diagnostics: readonly DiagnosticInput[], callDiagnostics: readonly DiagnosticInput[],
    evicted: readonly number[], options = this.encoding, replacement = false,
  ): PreparedFrame<F> {
    const source = new FrameSource(rows.next, rows);
    const candidate = { ...frame, source };
    const commit = once(() => this.current, () => {
      if (replacement) this.revisions.replace(rows);
      for (const row of evicted) this.revisions.current.archive(row);
      this.rows = rows;
      this.current = candidate;
      this.latest = diagnostics;
      this.positions = positions;
      if (options !== this.encoding) this.encoding = withoutTable(options);
      this.revisions.current.publish(candidate.revision, source, rows);
    }, base);
    return { frame: candidate, diagnostics, callDiagnostics, commit };
  }
}

export class PointStore extends UnalignedStore<PointFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('scatter', buildPoints, extendPoints, options, environment, version, sink);
  }
}

export class DonutStore extends UnalignedStore<DonutFrame> {
  constructor(options: ResolvedOptions, environment: DataEnvironment, version: FrameVersion, sink: DiagnosticSink = quiet) {
    super('donut', buildDonut, extendDonut, options, environment, version, sink);
  }
}
