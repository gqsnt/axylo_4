import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticInput, type DiagnosticSink, type Frame, type RowSource, type XColumn,
} from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import {
  alignedFrame, alignedSeed, alignmentFits, normalizeAligned, readX, reportGaps, seriesDescription,
  type DataEnvironment, type FrameVersion, type XData,
} from './normalize';
import {
  checkFields, resolveFields, resolveTable, retargetOptions, withoutTable,
  type AlignedChartType, type ResolvedOptions, type ResolvedValueField,
} from './options';
import { Reports } from './reports';
import { gapPosition, snapGap, stepDelta, stepMultiple, supportsSteps, tooSparse } from './steps';
import { BufferWindow } from './store-window';
import { mapValues, StoreMap } from './store-map';
import { FrameBuffers, type SeriesBuffers } from './store-buffers';
import { ByteCount, CallerBuffers, countBuffers, countRevisions, type OwnedBytes } from './store-bytes';
import { CalendarWindow } from './store-calendar';
import { StreamDiagnostics } from './store-diagnostics';
import { forwardDiagnostics, groupFor, RevisionStore, retentionStart, sameRemainder, StreamRows } from './store-rows';
import { rowsTable, sameTableData, type Table } from './table';
import { once, retention, type PreparedFrame, type StoreAppendOptions } from './transaction';
import { readValues, valueMode, type ValueCounts, type ValueMode, type Values } from './values';
import { countKinds, dateUnitOf, kindOf, nameOf, positionName, preferredKind, type DateUnit, type KindVotes } from './x';

const quiet: DiagnosticSink = { add: () => {} };
const noSource: RowSource = { rowAt: () => null };
type Fields = Omit<ResolvedOptions, 'table'>;
const noPositions = new Float64Array(0);
const noObservations = new Uint8Array(0);
const oneObservation = Uint8Array.of(1);
const noRows: readonly number[] = [];
const firstRowOnly: readonly number[] = [0];

function forkObservations(source: ReadonlyMap<string, Observations>): Map<string, Observations> {
  const result = new Map<string, Observations>();
  for (const [key, value] of source) result.set(key, value.fork());
  return result;
}

function forkDuplicates(source: ReadonlyMap<string, StoreMap<number, true>> | null): Map<string, StoreMap<number, true>> | null {
  if (!source || source.size === 0) return null;
  const result = new Map<string, StoreMap<number, true>>();
  for (const [key, value] of source) result.set(key, value.fork());
  return result;
}

function replacesLast(item: BatchSeries | undefined, positions: Float64Array, lastX: number | undefined): boolean {
  return item !== undefined && item.rows.length > 0 && positions[item.rows[0]!] === lastX;
}

function valueFieldFor(values: readonly ResolvedValueField[], fieldName: string): ResolvedValueField | undefined {
  for (let i = 0; i < values.length; i++) if (values[i]!.field === fieldName) return values[i]!;
  return undefined;
}

function namedFields(fields: Fields): [string, string][] {
  const named: [string, string][] = [[fields.x.field, 'x']];
  for (const value of fields.values) named.push([value.field, 'y']);
  if (fields.series !== null) named.push([fields.series, 'series']);
  return named;
}

function sameNormalization(before: ResolvedOptions, after: ResolvedOptions): boolean {
  const same = <T>(a: T, b: T, keys: readonly (keyof T)[]) => keys.every(key => a[key] === b[key]);
  return after.valid && sameTableData(before.table, after.table) && before.series === after.series &&
    same(before.x, after.x, ['field', 'type', 'timeZone', 'ordered', 'label', 'unit']) &&
    before.values.length === after.values.length && before.values.every((field, i) =>
      same(field, after.values[i]!, ['field', 'label', 'unit', 'scale', 'missing', 'parse']));
}

interface Cadence {
  last: number;
  differences: number;
  min: number;
  span: number;
  matches: number;
  multiple: boolean | null;
}

function cadence(): Cadence {
  return { last: -Infinity, differences: 0, min: Infinity, span: 0, matches: 0, multiple: true };
}

function step(c: Cadence): number {
  return c.multiple && c.differences >= 2 && 2 * c.matches >= c.differences ? c.min : 0;
}

function extend(c: Cadence, axis: XColumn, x: number): void {
  const previous = c.last;
  c.last = x;
  if (previous === -Infinity || !supportsSteps(axis)) return;
  const delta = stepDelta(axis, previous, x);
  if (delta < c.min && stepMultiple(delta, c.min) !== 1) {
    // An irregular prefix only needs a second pass if the smaller step later becomes frequent enough.
    c.multiple = c.differences === c.matches ? c.differences === 0 || stepMultiple(c.min, delta) > 0 : null;
    c.min = delta;
    c.matches = 1;
  } else {
    const multiple = stepMultiple(delta, c.min);
    if (multiple === 1) c.matches++;
    if (multiple === 0) c.multiple = false;
  }
  c.span += delta;
  c.differences++;
}

function absent(c: Cadence, size: number): number {
  return size ? Math.max(0, Math.round(c.span / size) - c.differences) : 0;
}

class Observations {
  private positions: Float64Array;
  private range: BufferWindow;
  private prefixStart: number;

  constructor(
    private prefix: Float64Array | null = null,
    positions: Float64Array = noPositions,
    range: BufferWindow = new BufferWindow(),
    prefixStart = 0,
  ) {
    this.positions = positions;
    this.range = range;
    this.prefixStart = prefixStart;
  }

  get last(): number | undefined {
    return this.range.end > this.range.start ? this.positions[this.range.end - 1] : this.prefix?.at(-1);
  }

  get first(): number | undefined { return this.at(0); }

  fork(): Observations {
    return new Observations(this.prefix, this.positions, this.range.fork(), this.prefixStart);
  }

  at(index: number): number | undefined {
    if (this.prefix) {
      const remaining = this.prefix.length - this.prefixStart;
      if (index < remaining) return this.prefix[this.prefixStart + index];
      index -= remaining;
    }
    const { start, end } = this.range;
    return start + index < end ? this.positions[start + index] : undefined;
  }

  add(position: number): void {
    const capacity = this.range.reserve(1, this.positions.length);
    if (capacity) this.resize(capacity, 1);
    this.positions[this.range.end++] = position;
  }

  evict(): void {
    if (this.prefix) {
      this.prefixStart++;
      if (this.prefixStart === this.prefix.length) {
        this.prefix = null;
        this.prefixStart = 0;
      }
      return;
    }
    this.range.start++;
    const capacity = this.range.compact(this.positions.length);
    if (capacity) this.resize(capacity, 0);
  }

  /**
   * Points the prefix at the store's own window, whose first slots hold the same positions (a wide frame over
   * one sorted x column, no gap slots): one copy of x per window, and the caller's column is not pinned.
   * Falls back to a copy of the remainder once half of it is gone, as before, if the window does not match.
   */
  share(window: Float64Array): void {
    const prefix = this.prefix;
    if (!prefix) return;
    const remaining = prefix.length - this.prefixStart;
    if (sameRemainder(prefix, this.prefixStart, window)) this.prefix = window.subarray(0, remaining);
    else if (this.prefixStart * 2 >= prefix.length) this.prefix = prefix.slice(this.prefixStart);
    else return;
    this.prefixStart = 0;
  }

  private resize(capacity: number, extra: number): void {
    const retained = this.positions.subarray(this.range.start, this.range.end);
    this.positions = new Float64Array(capacity);
    this.positions.set(retained);
    this.range.rebase(extra);
  }
}

function readCadence(axis: XColumn, observations: Observations): Cadence {
  const c = cadence();
  for (let i = 0, position = observations.first; position !== undefined; position = observations.at(++i)) {
    if (i && supportsSteps(axis)) {
      const delta = stepDelta(axis, c.last, position);
      c.min = Math.min(c.min, delta);
      c.span += delta;
      c.differences++;
    }
    c.last = position;
  }
  for (let i = 1, position = observations.at(1); position !== undefined; position = observations.at(++i)) {
    if (!supportsSteps(axis)) break;
    const multiple = stepMultiple(stepDelta(axis, observations.at(i - 1)!, position), c.min);
    if (multiple === 1) c.matches++;
    if (!multiple) c.multiple = false;
  }
  return c;
}

/**
 * The x positions of the first frame's slots, for history that outlives the store's first buffer. A view on the
 * caller's own column costs nothing and, unlike a view on the store's buffer, never pins a superseded copy.
 */
function prefixPositions(table: Table, field: string, x: XData, buffers: FrameBuffers): Float64Array {
  return table.columns?.[field] === x.positions && x.positions.length === buffers.end ? x.positions : buffers.x.subarray(0, buffers.end);
}

function cadences(options: Fields, table: Table, x: XData, axis: XColumn, buffers: FrameBuffers) {
  if (table.columns && options.series === null && x.order === null && x.positions.length > 0 && buffers.end === x.positions.length) {
    // Each wide series observes the same sorted x column. Keep appended history
    // separate so it cannot overwrite the prefix of a competing frame.
    const prefix = prefixPositions(table, options.x.field, x, buffers);
    const window = new Observations(prefix);
    const initial = readCadence(axis, window);
    return {
      history: new Map(options.values.map(field => [field.field, { ...initial }])),
      observations: new Map(options.values.map(field => [field.field, window.fork()])),
      duplicates: null as Map<string, StoreMap<number, true>> | null,
    };
  }
  const field = options.series;
  const keys = field === null ? null : Array.from({ length: table.length }, (_, i) => nameOf(table.read(i, field)));
  const observations = new Map<string, Observations>();
  let duplicates: Map<string, StoreMap<number, true>> | null = null;
  function observe(key: string, position: number): void {
    const window = groupFor(observations, key, Observations);
    if (position === window.last) {
      const positions = groupFor(duplicates ??= new Map(), key, StoreMap<number, true>);
      positions.set(position, true);
    } else {
      window.add(position);
    }
  }
  for (let i = 0, length = x.order?.length ?? x.positions.length; i < length; i++) {
    const row = x.order?.[i] ?? i;
    const position = x.positions[row]!;
    if (keys) {
      const key = keys[row];
      if (key != null) observe(key, position);
    } else for (const value of options.values) observe(value.field, position);
  }
  const history = mapValues(observations, window => readCadence(axis, window));
  return { history, observations, duplicates };
}

function calendarFor(x: XData, table: Table): CalendarWindow | null {
  if (x.parser.kind !== 'time') return null;
  const history = new CalendarWindow(x.parser.timeZone ?? 'UTC');
  for (let i = 0, n = x.order?.length ?? x.positions.length; i < n; i++) {
    history.observe(x.positions[x.order?.[i] ?? i]!);
  }
  for (let i = 0; i < x.positions.length; i++) {
    if (Number.isFinite(x.positions[i])) history.record(table.rowIndex(i));
  }
  return history;
}

function mode(counts: ValueCounts): ValueMode {
  return counts.other ? 'other' : counts.decimal ? 'decimal' : 'empty';
}

function valueCounts(table: Table, field: string, positions: Float64Array): ValueCounts {
  const counts = { decimal: 0, other: 0 };
  for (let i = 0; i < table.length; i++) {
    if (!Number.isFinite(positions[i])) continue;
    const kind = valueMode(table.read(i, field), table.isColumnRow(i));
    if (kind !== 'empty') counts[kind]++;
  }
  return counts;
}

interface State {
  readonly axis: XColumn;
  readonly parser: XData['parser'];
  readonly buffers: FrameBuffers;
  readonly history: Map<string, Cadence>;
  readonly observations: Map<string, Observations>;
  duplicates: Map<string, StoreMap<number, true>> | null;
  readonly modes: Map<string, ValueCounts>;
  readonly calendar: CalendarWindow | null;
  readonly votes: KindVotes | null;
  readonly dateUnits: Record<DateUnit, number> | null;
  readonly overBudget: boolean;
  readonly diagnostics: StreamDiagnostics;
}

interface BatchSeries {
  readonly key: string;
  readonly value: ResolvedValueField;
  readonly values: Values;
  readonly rows: readonly number[];
  readonly cadence: Cadence;
  readonly duplicates: readonly number[];
  readonly gaps: Float64Array | null;
  readonly sparse: number;
}

interface Batch {
  readonly positions: Float64Array;
  readonly axis: XColumn;
  readonly series: readonly BatchSeries[];
  readonly x: Float64Array;
  readonly observed: Uint8Array;
  readonly modes: State['modes'];
  readonly diagnostics: StreamDiagnostics;
}

function tail(
  positions: Float64Array, series: readonly BatchSeries[], lastX: number,
): { x: Float64Array; observed: Uint8Array } {
  let gapCount = 0;
  for (let i = 0; i < series.length; i++) gapCount += series[i]!.gaps?.length ?? 0;
  if (!gapCount && positions.length === 1) {
    const x = positions[0]!;
    return Number.isFinite(x) && x > lastX ? { x: positions, observed: oneObservation }
      : { x: noPositions, observed: noObservations };
  }
  const distinct = new Float64Array(positions.length + gapCount);
  let length = 0;
  for (const position of positions) {
    if (position > lastX && Number.isFinite(position) && (!length || position !== distinct[length - 1])) distinct[length++] = position;
  }
  const seen = distinct.subarray(0, length);
  if (!gapCount) return { x: seen, observed: new Uint8Array(length).fill(1) };
  const union = distinct.slice(0, length + gapCount);
  for (const { gaps } of series) {
    if (!gaps) continue;
    union.set(gaps, length);
    length += gaps.length;
  }
  union.sort();
  const observed = new Uint8Array(length);
  let index = 0;
  let count = 0;
  for (const x of union) {
    if (count && x === union[count - 1]) continue;
    union[count] = x;
    if (seen[index] === x) {
      observed[count] = 1;
      index++;
    }
    count++;
  }
  return { x: union.subarray(0, count), observed: observed.subarray(0, count) };
}

interface LazyReports {
  reports: Reports | null;
}

function extendSeries(
  key: string, field: ResolvedValueField, values: Values, rows: readonly number[],
  positions: Float64Array, state: State, axis: XColumn, lastX: number,
  duplicates: LazyReports, xField: string, diagnostics: StreamDiagnostics, firstRow: number, allFinite: boolean, label: string = key,
): BatchSeries | null {
  const previous = state.history.get(key) ?? cadence();
  const next = { ...previous };
  let firstObserved = false;
  let observedRows: number[] | undefined;
  let repeated: number[] | undefined;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const position = positions[row]!;
    if (position === next.last) {
      (repeated ??= []).push(position);
      (duplicates.reports ??= new Reports(xField, diagnostics)).add('AX108', 'series-disabled', firstRow + row, undefined, undefined, {
        series: label, position: axis.kind === 'category' ? JSON.stringify(state.parser.categoryName(position)) : positionName(axis, position),
      });
    } else {
      extend(next, axis, position);
      if (rows.length === 1 && row === 0) firstObserved = true;
      else (observedRows ??= []).push(row);
    }
  }
  if (next.multiple === null && next.differences >= 2 && 2 * next.matches >= next.differences) return null;
  const oldStep = step(previous);
  const newStep = step(next);
  const oldAbsent = absent(previous, oldStep);
  const nextAbsent = absent(next, newStep);
  const oldSparse = tooSparse(oldAbsent, previous.differences + 1);
  const newSparse = tooSparse(nextAbsent, next.differences + 1);
  if (oldSparse !== newSparse || oldStep !== newStep && !newSparse &&
    (oldAbsent > 0 || absent(previous, newStep) > 0)) return null;

  const observed = observedRows ?? (firstObserved ? firstRowOnly : noRows);
  let gapCount = 0;
  if (newStep && !newSparse) {
    let last = previous.last;
    for (let i = 0; i < observed.length; i++) {
      const position = positions[observed[i]!]!;
      if (last !== -Infinity) gapCount += stepMultiple(stepDelta(axis, last, position), newStep) - 1;
      last = position;
    }
  }
  const gaps = gapCount ? new Float64Array(gapCount) : null;
  if (gaps) {
    let validX: Float64Array | undefined;
    let index = 0;
    let last = previous.last;
    for (let i = 0; i < observed.length; i++) {
      const position = positions[observed[i]!]!;
      const multiple = last === -Infinity ? 0 : stepMultiple(stepDelta(axis, last, position), newStep);
      for (let j = 1; j < multiple; j++) {
        let gap = gapPosition(axis, last, position, newStep, j, multiple);
        if (axis.kind === 'number') {
          const x = validX ??= allFinite ? positions : positions.filter(Number.isFinite);
          const previousCount = Number.isFinite(lastX) ? 1 : 0;
          gap = snapGap(gap, last, position, newStep, x.length + previousCount, idx => previousCount && idx === 0 ? lastX : x[idx - previousCount]!);
        }
        if (gap <= lastX) return null;
        gaps[index++] = gap;
      }
      last = position;
    }
  }
  return { key, value: field, values, rows: observed, cadence: next, gaps, duplicates: repeated ?? noRows, sparse: newSparse ? nextAbsent : 0 };
}

function keptTable(table: Table, x: XData, keep: number): {
  table: Table; discarded: readonly number[]; categories: readonly string[] | null;
} | null {
  const { positions, parser } = x;
  const first = retentionStart(x, keep);
  if (first === -Infinity) return null;

  const unplaced: number[] = [];
  let latest = -Infinity;
  for (let i = 0; i < table.length; i++) {
    const position = positions[i]!;
    if (Number.isFinite(position)) latest = Math.max(latest, position);
    else if (latest >= first) unplaced.push(i);
  }
  const earliestUnplaced = unplaced[Math.max(0, unplaced.length - 2 * keep)] ?? Infinity;
  const indexes: number[] = [];
  const discarded: number[] = [];
  for (let i = 0; i < table.length; i++) {
    const position = positions[i]!;
    if ((Number.isFinite(position) ? position >= first : i >= earliestUnplaced)) indexes.push(i);
    else discarded.push(table.rowIndex(i));
  }
  if (discarded.length === 0) return null;
  return {
    table: {
      ...table, length: indexes.length,
      read: (i, field) => table.read(indexes[i]!, field),
      isColumnRow: i => table.isColumnRow(indexes[i]!),
      rowIndex: i => table.rowIndex(indexes[i]!),
      rowAt: i => table.rowAt(indexes[i]!),
    },
    discarded, categories: parser.categories?.slice(first) ?? null,
  };
}

function writeObservation(
  buffers: FrameBuffers, series: SeriesBuffers, target: number, values: Values, row: number, base: number, zero: boolean,
): void {
  const state = values.slot[row]!;
  const imputed = zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD);
  series.y[target] = values.y[row]!;
  series.slot[target] = imputed ? SLOT_VALUE : state;
  buffers.setRow(series, target, imputed ? -1 : base + row);
}

export class AlignedStore extends RevisionStore<AlignedFrame> {
  private fields: Fields;
  private named: readonly [string, string][];
  private state: State;
  private writing = false;

  constructor(
    private readonly type: AlignedChartType,
    options: ResolvedOptions,
    private readonly environment: DataEnvironment,
    version: FrameVersion,
    private readonly sink: DiagnosticSink = quiet,
    normalized?: AlignedFrame,
  ) {
    super(options.table);
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installAlignedExtras();
    const { table, ...fields } = options;
    this.fields = fields;
    this.named = namedFields(fields);
    const seed = normalized && alignedSeed(normalized);
    const reusable = normalized && seed?.type === type && sameNormalization(seed.options, options);
    const { frame, state, x } = reusable
      ? this.adoptNormalized(table, version, normalized)
      : this.build(table, version, null);
    this.state = state;
    this.rows.resetPositions(table, x.positions, prefixPositions(table, fields.x.field, x, state.buffers));
    this.current = this.snapshot(frame);
    this.latest = this.currentDiagnostics();
    this.publish(this.current);
    forwardDiagnostics(this.latest, this.sink);
  }

  /**
   * Opens owned streaming storage after static normalization. Supply the same resolved options and
   * data used for the frame; the resolved table already represents that data.
   */
  static fromFrame(
    frame: AlignedFrame, options: ResolvedOptions, data?: unknown,
    environment: DataEnvironment = { timeZone: frame.x.timeZone ?? 'UTC' },
    type: AlignedChartType = alignedSeed(frame)?.type ?? 'line', sink: DiagnosticSink = quiet,
  ): AlignedStore {
    // The optional raw data is already represented by options.table, including borrowed columns.
    void data;
    return new AlignedStore(type, options, environment, frame, sink, frame);
  }

  resolveEncoding(input: unknown, sink: DiagnosticSink): ResolvedOptions {
    return withoutTable(resolveFields(this.type, input, sink, this.rows.table()));
  }

  prepareAppend(rows: readonly unknown[], options: StoreAppendOptions = {}): PreparedFrame<AlignedFrame> {
    if (this.writing) throw new Error('Cannot prepare a data change during an append.');
    const base = this.current;
    const rowsDraft = this.rows.fork();
    rowsDraft.trackEvictions = true;
    const state = this.state;
    const draft = this.fork(rowsDraft);
    // `modes`, `votes`, and `dateUnits` are replaced with fresh instances by commitBatch or build before trim runs.
    draft.state = {
      ...state, parser: state.parser.fork(), buffers: state.buffers.fork(),
      history: new Map(state.history),
      observations: forkObservations(state.observations),
      duplicates: forkDuplicates(state.duplicates),
      calendar: state.calendar?.fork() ?? null, diagnostics: state.diagnostics.fork(),
    };
    const call = new DiagnosticCollector();
    try {
      draft.appendInPlace(rows, options, call, true);
    } finally {
      rowsDraft.trackEvictions = false;
    }
    const evicted = rowsDraft.evicted ?? noRows;
    rowsDraft.evicted = null;
    return this.transaction(base, draft, call, evicted);
  }

  prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<AlignedFrame> {
    return this.prepareEncoding(this.rows.fork(), options, version, new DiagnosticCollector());
  }

  private prepareEncoding(
    rows: StreamRows, options: ResolvedOptions, version: FrameVersion, call: DiagnosticCollector,
    replacement?: { table: Table; valid: boolean },
  ): PreparedFrame<AlignedFrame> {
    if (this.writing) throw new Error('Cannot prepare a data change during an append.');
    const base = this.current;
    if (version.revision <= base.revision || version.epoch <= base.epoch) {
      throw new Error('Encoding updates and replacements require a newer epoch and revision.');
    }
    const input = replacement?.table ?? rows.table();
    const { table, ...fields } = retargetOptions(options, input, call, replacement?.valid);
    const draft = this.fork(rows);
    draft.fields = fields;
    draft.named = namedFields(fields);
    const built = draft.build(table, version, null);
    draft.state = built.state;
    draft.rows.resetPositions(table, built.x.positions);
    draft.current = draft.snapshot(built.frame);
    forwardDiagnostics(draft.currentDiagnostics(), call);
    draft.latest = call.inputs();
    return this.transaction(base, draft, call, [], replacement !== undefined);
  }

  private fork(rows: StreamRows): AlignedStore {
    return Object.assign(Object.create(AlignedStore.prototype) as AlignedStore, this, { rows });
  }

  private transaction(
    base: AlignedFrame, draft: AlignedStore, call: DiagnosticCollector, evicted: readonly number[], replacement = false,
  ): PreparedFrame<AlignedFrame> {
    return this.preview(base, draft.current, draft.rows, draft.latest, call.inputs(), () => {
      if (this.writing) throw new Error('Cannot commit a data change during an append.');
      this.commitRows(draft.rows, evicted, replacement);
      draft.state.parser.commit();
      draft.state.calendar?.commit();
      draft.state.diagnostics.commit();
      if (draft.state.duplicates) {
        for (const positions of draft.state.duplicates.values()) positions.commit();
      }
      this.fields = draft.fields;
      this.named = draft.named;
      this.state = draft.state;
    });
  }

  private adoptNormalized(table: Table, version: FrameVersion, normalized: AlignedFrame) {
    return this.build(table, version, null, normalized);
  }

  private build(table: Table, version: FrameVersion,
    categories: readonly string[] | null = this.state?.parser.categories ?? null, normalized?: AlignedFrame) {
    const options = { ...this.fields, table };
    const seed = normalized && alignedSeed(normalized);
    const diagnostics = seed?.diagnostics.copy() ?? new StreamDiagnostics();
    const x = seed ? { ...seed.x, parser: seed.x.parser.copy() } :
      readX(this.type, options.valid ? options : { ...options, table: rowsTable([]) },
        this.environment, diagnostics, categories ?? undefined);
    const frame = normalized ?? (options.valid ? alignedFrame(options, x, diagnostics, version)
      : normalizeAligned(this.type, options, this.environment, diagnostics, version));
    const axis = x.parser.column(noPositions, true);
    const overBudget = !seed && diagnostics.inputs().some(diagnostic => diagnostic.code === 'AX134');
    const buffers = new FrameBuffers(frame, x.positions, x.order);
    const state: State = {
      axis, parser: x.parser, buffers,
      ...(overBudget ? { history: new Map(), observations: new Map(), duplicates: null } : cadences(options, table, x, frame.x, buffers)),
      modes: seed ? mapValues(seed.counts, count => ({ ...count })) : overBudget ? new Map() : new Map(options.values.map(value => [value.field, valueCounts(table, value.field, x.positions)])),
      calendar: overBudget ? null : calendarFor(x, table),
      votes: options.x.type !== null ? null : seed ?
        { date: 0, wall: 0, number: 0, time: 0, category: 0, [axis.kind]: x.positions.length } :
        countKinds(table, options.x.field, options.series),
      overBudget, dateUnits: seed && x.dateUnits ? { ...x.dateUnits } : x.dateUnits, diagnostics,
    };
    return { frame, state, x };
  }

  private batch(table: Table, positions: Float64Array, axis: XColumn, lastX: number, diagnostics: StreamDiagnostics, allFinite: boolean): Batch | null {
    const { state, fields } = this;
    const modes = new Map<string, ValueCounts>();
    for (const [k, v] of state.modes) modes.set(k, { decimal: v.decimal, other: v.other });
    const valueFields = fields.values;
    const singleField = valueFields.length === 1;
    let singleValues: Values | null = null;
    const values = singleField ? null : new Map<string, Values>();
    const included = allFinite ? undefined : (i: number) => Number.isFinite(positions[i]);
    for (let f = 0; f < valueFields.length; f++) {
      const field = valueFields[f]!;
      const before = modes.get(field.field);
      let addedDecimal = 0;
      let addedOther = 0;
      for (let i = 0; i < table.length; i++) {
        if (!allFinite && !Number.isFinite(positions[i])) continue;
        const kind = valueMode(table.read(i, field.field), table.isColumnRow(i));
        if (kind === 'decimal') addedDecimal++;
        else if (kind === 'other') addedOther++;
      }
      if (before && !before.other && before.decimal && addedOther) return null;
      const counts = before
        ? (before.decimal += addedDecimal, before.other += addedOther, before)
        : { decimal: addedDecimal, other: addedOther };
      if (!before) modes.set(field.field, counts);
      const read = readValues(table, field, diagnostics, true, this.rows.next, mode(counts), included);
      if (singleField) singleValues = read;
      else values!.set(field.field, read);
    }

    const series: BatchSeries[] = [];
    const duplicates: LazyReports = { reports: null };
    const xField = fields.x.field;
    const firstRow = this.rows.next;
    if (fields.series !== null) {
      const memberships = new Map<string, number[]>();
      let seriesReports: Reports | null = null;
      for (let i = 0; i < table.length; i++) {
        const raw = table.read(i, fields.series);
        const key = nameOf(raw);
        if (key === null) {
          seriesReports ??= new Reports(fields.series, diagnostics);
          if (raw === undefined) seriesReports.add('AX102', 'omitted', firstRow + i, undefined, undefined, { outcome: 'The affected row is not drawn.' });
          else seriesReports.add('AX107', 'omitted', firstRow + i, raw, 'Supply a name for the series in each row.');
        } else if (allFinite || Number.isFinite(positions[i])) groupFor(memberships, key, Array<number>).push(i);
      }
      seriesReports?.flush(diagnostics);
      const primaryField = valueFields[0]!;
      const primaryValues = singleField ? singleValues! : values!.get(primaryField.field)!;
      for (const [key, rows] of memberships) {
        const item = extendSeries(key, primaryField, primaryValues, rows, positions, state, axis, lastX,
          duplicates, xField, diagnostics, firstRow, allFinite, key);
        if (!item) return null;
        series.push(item);
      }
    } else {
      let allRows: readonly number[];
      if (table.length === 1) allRows = allFinite || Number.isFinite(positions[0]) ? firstRowOnly : noRows;
      else {
        const validRows: number[] = [];
        for (let i = 0; i < table.length; i++) if (allFinite || Number.isFinite(positions[i])) validRows.push(i);
        allRows = validRows;
      }
      for (let f = 0; f < valueFields.length; f++) {
        const field = valueFields[f]!;
        const fieldValues = singleField ? singleValues! : values!.get(field.field)!;
        const item = extendSeries(field.field, field, fieldValues, allRows, positions, state, axis, lastX,
          duplicates, xField, diagnostics, firstRow, allFinite, field.label);
        if (!item) return null;
        series.push(item);
      }
    }
    duplicates.reports?.flush(diagnostics);
    for (let i = 0; i < series.length; i++) {
      const item = series[i]!;
      if (item.gaps || item.sparse) {
        reportGaps(diagnostics, xField, item.value.missing === 'zero', item.gaps, axis, this.label(item.key), item.sparse, item.key);
      }
    }
    const { x, observed } = tail(positions, series, lastX);
    return { positions, axis, series, x, observed, modes, diagnostics };
  }

  private commitBatch(
    batch: Batch, rows: readonly unknown[], version: FrameVersion, dateUnits: State['dateUnits'], votes: State['votes'],
  ): void {
    const base = this.rows.next;
    this.rows.append(rows);
    for (let i = 0; i < batch.positions.length; i++) {
      const position = batch.positions[i]!;
      const row = base + i;
      this.rows.record(position, row);
      if (!Number.isFinite(position)) continue;
      this.state.calendar?.observe(position);
      this.state.calendar?.record(row);
    }

    const { buffers } = this.state;
    const hasCompetingWrites = buffers.hasCompetingWrites;
    const resized = buffers.reserve(batch.x.length);
    const { end } = buffers;
    const lastX = end > buffers.start ? buffers.x[end - 1] : undefined;
    buffers.x.set(batch.x, end);
    buffers.markObserved(batch.observed, end);
    for (let i = 0; i < batch.observed.length; i++) buffers.distinct += batch.observed[i]!;
    const only = batch.series.length === 1 ? batch.series[0] : undefined;
    const updates = batch.series.length > 1 ? new Map<string, BatchSeries>() : null;
    for (let s = 0; s < batch.series.length; s++) {
      const item = batch.series[s]!;
      updates?.set(item.key, item);
      let series = buffers.series.get(item.key);
      const zero = item.value.missing === 'zero';
      const first = item.rows[0];
      const replacingLast = replacesLast(item, batch.positions, lastX);
      if (series && replacingLast && !resized) series = buffers.writeTail(series, hasCompetingWrites);
      if (!series) {
        series = buffers.addSeries({
          ...seriesDescription(item.key, this.fields.series === null ? item.value.label : item.key, item.value),
          drawable: true,
        }, zero);
      }
      if (item.duplicates.length) {
        const positions = groupFor(this.state.duplicates ??= new Map(), item.key, StoreMap<number, true>);
        for (const position of item.duplicates) positions.set(position, true);
        if (series.description.drawable) series.description = { ...series.description, drawable: false };
      }
      if (replacingLast) {
        writeObservation(buffers, series, end - 1, item.values, first!, base, zero);
      }
      this.state.history.set(item.key, item.cadence);
      const window = groupFor(this.state.observations, item.key, Observations);
      for (let r = 0; r < item.rows.length; r++) window.add(batch.positions[item.rows[r]!]!);
    }
    const length = batch.x.length;
    for (const [key, series] of buffers.series) {
      const item = only?.key === key ? only : updates?.get(key);
      const zero = (item?.value ?? valueFieldFor(this.fields.values, series.description.field))?.missing === 'zero';
      let next = replacesLast(item, batch.positions, lastX) ? 1 : 0;
      let gap = 0;
      for (let i = 0; i < length; i++) {
        const position = batch.x[i]!;
        const row = item?.rows[next];
        const target = end + i;
        if (item && row !== undefined && batch.positions[row] === position) {
          writeObservation(buffers, series, target, item.values, row, base, zero);
          next++;
        } else {
          const missing = item?.gaps?.[gap] === position;
          if (missing) gap++;
          buffers.setRow(series, target, -1);
          series.y[target] = zero ? 0 : NaN;
          series.slot[target] = zero ? SLOT_VALUE : missing ? SLOT_GAP : SLOT_NO_ROW;
        }
      }
    }
    buffers.end += length;
    this.state.diagnostics.merge(batch.diagnostics);
    this.state = { ...this.state, axis: batch.axis, modes: batch.modes, dateUnits, votes };
    this.current = { ...this.current, ...version };
  }

  private currentDiagnostics(): readonly DiagnosticInput[] {
    const findings = this.state.diagnostics.retained();
    const calendar = this.state.calendar?.diagnostic(this.fields.x.field, this.current.x.values[0]!);
    return calendar ? [...findings, calendar] : findings;
  }

  private label(key: string): string {
    return this.fields.series === null ? this.fields.values.find(value => value.field === key)?.label ?? key : key;
  }

  private snapshot(frame: AlignedFrame, skipSource = false): AlignedFrame {
    const { buffers, axis, history } = this.state;
    const last = buffers.x[buffers.end - 1];
    return buffers.frame(frame, axis, skipSource ? noSource : this.rows.source(), key => history.get(key)?.last !== last);
  }

  private failAppend(count: number, version: FrameVersion, diagnostics: readonly DiagnosticInput[], sink: DiagnosticSink): AlignedFrame {
    forwardDiagnostics(diagnostics, sink);
    this.rows.next += count;
    const axis = this.state.axis;
    this.current = {
      ...this.current, ...version, length: 0, series: [], source: this.rows.source(),
      x: { ...axis, values: new Float64Array(), categories: axis.kind === 'category' ? [] : null },
    };
    this.latest = diagnostics;
    return this.current;
  }

  private evictObservation(key: string, window: Observations, position: number, first: number): boolean {
    const { axis, buffers, diagnostics, duplicates, history, observations } = this.state;
    if (window.first !== position) return false;
    window.evict();
    const next = window.first;
    const series = buffers.series.get(key)!;
    if (next === undefined) {
      history.delete(key);
      observations.delete(key);
      duplicates?.delete(key);
      diagnostics.evictSeries(key);
      if (this.fields.series !== null) buffers.series.delete(key);
      else if (!series.description.drawable) series.description = { ...series.description, drawable: true };
      return false;
    }
    const repeats = duplicates?.get(key);
    repeats?.delete(position);
    if (repeats?.size === 0) {
      duplicates!.delete(key);
      series.description = { ...series.description, drawable: true };
    }
    if (!supportsSteps(axis)) return false;
    const before = history.get(key)!;
    const previousStep = step(before);
    const oldAbsent = absent(before, previousStep);
    const oldSparse = tooSparse(oldAbsent, before.differences + 1);
    const delta = stepDelta(axis, position, next);
    const multiple = stepMultiple(delta, before.min);
    let after = { ...before, span: before.span - delta, differences: before.differences - 1,
      matches: before.matches - Number(multiple === 1) };
    if (!after.matches || !multiple || before.multiple === null) after = readCadence(axis, window);
    history.set(key, after);
    const currentStep = step(after);
    const newAbsent = absent(after, currentStep);
    const newSparse = tooSparse(newAbsent, after.differences + 1);
    if (oldSparse && newSparse) {
      reportGaps(diagnostics, this.fields.x.field, false, null, axis, this.label(key), newAbsent, key);
      return false;
    }
    if (oldSparse) diagnostics.evictSeries(key);
    return (oldAbsent !== 0 || newAbsent !== 0) &&
      (previousStep !== currentStep || oldSparse !== newSparse || !newSparse && multiple > 1 && next > first);
  }

  /** History that reads x positions reads them from the window, never from a copy of its own. */
  private sharePositions(): void {
    const { buffers, observations } = this.state;
    const window = buffers.x.subarray(buffers.start, buffers.end);
    for (const history of observations.values()) history.share(window);
    this.rows.shareSeed(window);
  }

  private trim(keep: number): boolean {
    const { axis, buffers, diagnostics, calendar, observations, modes, votes, parser, dateUnits } = this.state;
    if (keep >= buffers.distinct && !this.rows.hasUnplaced) return false;
    let update = false;
    let mixedModes: Set<string> | undefined;
    for (const [field, counts] of modes) {
      if (counts.decimal && counts.other) (mixedModes ??= new Set()).add(field);
    }
    let categories = 0;
    let remove = buffers.distinct - keep;
    let first = buffers.start;
    while (remove > 0 && first < buffers.end) remove -= Number(buffers.observed(first++));
    while (first < buffers.end && !buffers.observed(first)) first++;
    const firstX = buffers.x[first] ?? Infinity;
    const discard = (row: number, column: boolean, placed = true) => {
      diagnostics.evict(row, false);
      calendar?.evictRow(row);
      const x = this.rows.read(row, this.fields.x.field);
      if (votes && (this.fields.series === null || nameOf(this.rows.read(row, this.fields.series)) !== null)) {
        if (x != null && x !== '' && !(column && Number.isNaN(x))) votes[kindOf(x) ?? 'category']--;
      }
      if (!placed) return;
      if (dateUnits) dateUnits[dateUnitOf(x)]--;
      for (const [field, counts] of modes) {
        const kind = valueMode(this.rows.read(row, field), column);
        if (kind !== 'empty') counts[kind]--;
      }
    };
    if (keep < buffers.distinct) {
      buffers.trim(keep, (position, observed) => {
        diagnostics.evict(position, true);
        if (!observed) return;
        if (parser.kind === 'category') categories++;
        calendar?.evictPosition(position);
        for (const [key, window] of observations) {
          update = this.evictObservation(key, window, position, firstX) || update;
        }
        this.rows.evictRead(position, discard);
      });
      buffers.shrink();
      this.sharePositions();
    }
    if (buffers.distinct === 0) buffers.series.clear();
    if (this.rows.hasUnplaced) {
      this.rows.trimUnplacedRead(keep, firstX, buffers.distinct, (row, column) => discard(row, column, false));
    }
    this.rows.compactColumns();
    if (categories) parser.evictCategories(categories);
    if (mixedModes) {
      for (const field of mixedModes) {
        if (mode(modes.get(field)!) === 'decimal') update = true;
      }
    }
    if (dateUnits) {
      const precision = dateUnits.day ? 'day' : dateUnits.month ? 'month' : dateUnits.year ? 'year' : null;
      if (precision === null) parser.restore(parser.categoryCount, null);
      else if (precision !== parser.dateUnit) update = true;
    }
    if (categories || axis.kind === 'date' && axis.dateUnit !== (parser.dateUnit ?? 'day')) {
      this.state = { ...this.state, axis: parser.column(noPositions, true) };
    }
    const inferred = votes && preferredKind(votes);
    return update || Boolean(inferred && inferred !== parser.kind);
  }

  private appendInPlace(rows: readonly unknown[], options: StoreAppendOptions, sink: DiagnosticSink, skipSource = false): AlignedFrame {
    const { parser, buffers } = this.state;
    const categoryCount = parser.categoryCount;
    const dateUnit = parser.dateUnit;
    const keep = retention(options);
    const version = { epoch: this.current.epoch, revision: this.current.revision + 1 };
    const lastX = buffers.end > buffers.start ? buffers.x[buffers.end - 1]! : -Infinity;
    const diagnostics = new StreamDiagnostics();
    const issues = new Reports(this.fields.x.field, diagnostics);
    let ordering: StreamDiagnostics | undefined;
    let order: Reports | undefined;
    const table = rowsTable(rows);
    const fields = this.fields;
    if (!checkFields(table, this.named, diagnostics)) return this.failAppend(rows.length, version, diagnostics.inputs(), sink);

    const votes = this.state.votes && countKinds(table, fields.x.field, fields.series);
    if (votes) {
      const prev = this.state.votes!;
      votes.date += prev.date;
      votes.wall += prev.wall;
      votes.number += prev.number;
      votes.time += prev.time;
      votes.category += prev.category;
    }
    const inferred = votes && preferredKind(votes);
    const positions = new Float64Array(rows.length);
    const dateUnits = this.state.dateUnits && { ...this.state.dateUnits };
    let needsUpdate = !fields.valid || this.state.overBudget || Boolean(inferred && inferred !== parser.kind);
    let highest = lastX;
    let allFinite = true;
    for (let i = 0; i < rows.length; i++) {
      const validSeries = fields.series === null || nameOf(table.read(i, fields.series)) !== null;
      const raw = validSeries ? table.read(i, fields.x.field) : undefined;
      const position = validSeries ? parser.read(raw, this.rows.next + i, issues, fields.values.length) : NaN;
      positions[i] = position;
      if (!Number.isFinite(position)) {
        allFinite = false;
        continue;
      }
      if (dateUnits) dateUnits[dateUnitOf(raw)]++;
      if (position < highest) {
        order ??= new Reports(fields.x.field, ordering = new StreamDiagnostics());
        order.add('AX151', 'none', this.rows.next + i);
        needsUpdate = true;
      }
      highest = Math.max(highest, position);
    }
    if (dateUnit !== parser.dateUnit && buffers.distinct) needsUpdate = true;
    issues.flush(diagnostics);
    const axis = categoryCount === parser.categoryCount && dateUnit === parser.dateUnit
      ? this.state.axis : parser.column(noPositions, true);
    let batch = needsUpdate ? null : this.batch(table, positions, axis, lastX, diagnostics, allFinite);
    if (ordering) order?.flush(ordering);
    const orderInputs = ordering?.inputs();
    if (batch) {
      let count = buffers.series.size;
      for (let i = 0; i < batch.series.length; i++) if (!buffers.series.has(batch.series[i]!.key)) count++;
      const limits = keep === undefined ? new DiagnosticCollector() : null;
      if (!alignmentFits(count, buffers.end - buffers.start + batch.x.length, limits ?? quiet)) {
        if (limits) {
          parser.restore(categoryCount, dateUnit);
          return this.failAppend(rows.length, version, limits.inputs(), sink);
        }
        batch = null;
      }
    }

    if (batch) {
      try {
        forwardDiagnostics(batch.diagnostics.inputs(), sink);
        const hint = this.state.calendar?.preview(fields.x.field, buffers.x[buffers.start] ?? -Infinity, positions, this.rows.next);
        if (hint) sink.add(hint);
      } catch (error) {
        parser.restore(categoryCount, dateUnit);
        throw error;
      }
      this.commitBatch(batch, rows, version, dateUnits, votes);
    } else {
      parser.restore(categoryCount, dateUnit);
      const combined = this.rows.table(rows);
      let prepared = this.build(combined, version);
      const window = prepared.state.overBudget && keep !== undefined ? keptTable(combined, prepared.x, keep) : null;
      if (window) prepared = this.build(window.table, version, window.categories);
      const { frame, state, x: read } = prepared;
      if (state.overBudget) return this.failAppend(rows.length, version, state.diagnostics.inputs(), sink);
      if (orderInputs) forwardDiagnostics(orderInputs, sink);
      forwardDiagnostics(state.diagnostics.inputs(), sink);
      const hint = state.calendar?.diagnostic(fields.x.field, frame.x.values[0]!);
      if (hint) sink.add(hint);
      this.rows.append(rows);
      for (const row of window?.discarded ?? []) {
        this.rows.forget(row);
      }
      this.rows.resetPositions(window?.table ?? combined, read.positions);
      this.state = state;
      this.current = frame;
    }

    if (keep !== undefined) {
      while (this.trim(keep)) {
        const retained = this.rows.table();
        const { frame, state, x: read } = this.build(retained, version);
        this.rows.resetPositions(retained, read.positions);
        this.state = state;
        this.current = frame;
        if (state.overBudget) break;
      }
    }
    // Growth may have moved the window to a new buffer: history must not pin the old one.
    this.sharePositions();
    this.current = this.snapshot(this.current, skipSource);
    const findings = this.currentDiagnostics();
    this.latest = orderInputs?.length ? [...findings, ...orderInputs] : findings;
    return this.current;
  }
}

/**
 * Members only tests and the benchmark's memory probe use (spec P7's byte count; one-step conveniences over
 * prepare and commit). Development and benchmark builds install them when the first store is made; the
 * production file has none of them.
 */
export interface AlignedStore {
  readonly diagnostics: readonly DiagnosticInput[];
  /** The typed storage beyond the caller's columns, with frames still held counted in the same set (P7). */
  ownedBytes(frames?: readonly Frame[]): OwnedBytes;
  append(rows: readonly unknown[], options?: { keep?: number }, sink?: DiagnosticSink): AlignedFrame;
  reencode(options: ResolvedOptions, version: FrameVersion): AlignedFrame;
  replace(data: unknown, options: ResolvedOptions, version: FrameVersion): AlignedFrame;
  prepareReplace(data: unknown, options: ResolvedOptions, version: FrameVersion): PreparedFrame<AlignedFrame>;
}

let alignedExtras = false;
function installAlignedExtras(): void {
  if (alignedExtras) return;
  alignedExtras = true;
  const proto = AlignedStore.prototype;
  Object.defineProperty(proto, 'diagnostics', { configurable: true, get(this: AlignedStore) { return this['latest']; } });
  proto.ownedBytes = function (this: AlignedStore, frames: readonly Frame[] = []): OwnedBytes {
    const bytes = new ByteCount(new CallerBuffers());
    const state = this['state'];
    countBuffers(state.buffers, bytes);
    for (const [key, window] of state.observations) {
      const name = `series ${key} x history`;
      bytes.add(name, window['prefix']);
      if (window['positions'].length) bytes.add(name, window['positions']);
    }
    countRevisions(this['revisions'], bytes);
    bytes.frame(this['current']);
    for (const frame of frames) bytes.frame(frame);
    return bytes.result();
  };
  proto.append = function (this: AlignedStore, rows: readonly unknown[], options: { keep?: number } = {}, sink = this['sink']): AlignedFrame {
    if (retention(options) !== undefined) {
      const prepared = this.prepareAppend(rows, options);
      forwardDiagnostics(prepared.callDiagnostics, sink);
      prepared.commit();
      return prepared.frame;
    }
    if (this['writing']) throw new Error('Cannot prepare a data change during an append.');
    // Without an inspected candidate, the incremental path can safely reuse the owned buffers.
    once(() => this['current'], () => {
      const parser = this['state'].parser;
      const count = parser.categoryCount;
      const unit = parser.dateUnit;
      this['writing'] = true;
      try {
        this['publish'](this['appendInPlace'](rows, options, sink));
      } catch (error) {
        parser.restore(count, unit);
        throw error;
      } finally {
        this['writing'] = false;
      }
    }, this['current'])();
    return this['current'];
  };
  proto.reencode = function (this: AlignedStore, options: ResolvedOptions, version: FrameVersion): AlignedFrame {
    const prepared = this.prepareReencode(options, version);
    prepared.commit();
    return prepared.frame;
  };
  proto.prepareReplace = function (this: AlignedStore, data: unknown, options: ResolvedOptions, version: FrameVersion) {
    const call = new DiagnosticCollector();
    const { table, valid } = resolveTable(data, call);
    return this['prepareEncoding'](new StreamRows(table), options, version, call, { table, valid });
  };
  proto.replace = function (this: AlignedStore, data: unknown, options: ResolvedOptions, version: FrameVersion): AlignedFrame {
    const prepared = this.prepareReplace(data, options, version);
    prepared.commit();
    return prepared.frame;
  };
}

/** AlignedStore.fromFrame as a plain function, for a chart kind's composition (a member read is not tree-shakable). */
export function openAlignedStore(
  frame: AlignedFrame, options: ResolvedOptions, data: unknown, environment: DataEnvironment, type: AlignedChartType,
): AlignedStore {
  return AlignedStore.fromFrame(frame, options, data, environment, type);
}
