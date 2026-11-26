import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticInput, type DiagnosticSink, type Frame, type RowSource, type XColumn,
} from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import { MAX_DATE } from '../scale/zone';
import {
  alignedFrame, alignedSeed, alignmentFits, mergeGaps, normalizeAligned, readPosition, readX, reportGaps, reportMissingName, seriesDescription,
  type DataEnvironment, type FrameVersion, type XData,
} from './normalize';
import {
  checkFields, namedFields, resolveFields, retargetOptions, withoutTable,
  type AlignedChartType, type ResolvedOptions, type ResolvedValueField,
} from './options';
import { Reports } from './reports';
import { gapPosition, snapGap, stepDelta, stepMultiple, supportsSteps, tooSparse } from './steps';
import { extendStatistics } from './store-statistics';
import { BufferWindow } from './store-window';
import { mapValues, StoreMap } from './store-map';
import { FrameBuffers, writeSlot, type SeriesBuffers } from './store-buffers';
import { ByteCount, CallerBuffers, countBuffers, countRevisions, type OwnedBytes } from './store-bytes';
import { CalendarWindow } from './store-calendar';
import { StreamDiagnostics } from './store-diagnostics';
import { forkValues, checkVersion, forwardDiagnostics, installEncodingExtras, nextVersion, groupFor, RevisionStore, retentionStart, shareRemainder, StreamRows } from './store-rows';
import { rowsTable, rowValue, sameTableData, type Table } from './table';
import { once, retention, type PreparedFrame, type StoreAppendOptions } from './transaction';
import { readValues, valueMode, type ValueCounts, type ValueMode, type Values } from './values';
import { addKinds, countKinds, dateUnitOf, voteOf, nameOf, positionName, preferredKind, DAY, HOUR, type DateUnit, type KindVotes } from './x';

const quiet: DiagnosticSink = { add: () => {} };
const noSource: RowSource = { rowAt: () => null };
type Fields = Omit<ResolvedOptions, 'table'>;
const noRows: readonly number[] = [];
const noDiagnostics: readonly DiagnosticInput[] = [];
const smallBatches: readonly (readonly number[])[] = [
  [], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4, 5], [0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6, 7],
];
let emptyPositions: Float64Array | null = null;
const getNoPositions = (): Float64Array => emptyPositions ??= new Float64Array(0);

class AppendTable implements Table {
  readonly columns = null;
  readonly length: number;
  readonly #rows: readonly unknown[];

  constructor(rows: readonly unknown[]) {
    this.#rows = rows;
    this.length = rows.length;
  }

  read(row: number, field: string): unknown { return rowValue(this.#rows[row], field); }
  rowAt(row: number): unknown { return Number.isInteger(row) && row >= 0 && row < this.length ? this.#rows[row] : null; }
  rowIndex(row: number): number { return row; }
  isColumnRow(): boolean { return false; }
  keys(): readonly string[] { return rowsTable(this.#rows).keys(); }

  hasField(field: string): boolean {
    for (let i = 0; i < this.length; i++) {
      const row = this.#rows[i];
      if (row !== null && typeof row === 'object' && Object.hasOwn(row, field)) return true;
    }
    return false;
  }
}

function replacesLast(item: BatchSeries | undefined, positions: Float64Array, lastX: number | undefined): boolean {
  return item !== undefined && item.rows.length > 0 && positions[item.rows[0]!] === lastX;
}

function valueFieldFor(values: readonly ResolvedValueField[], fieldName: string): ResolvedValueField | undefined {
  for (let i = 0; i < values.length; i++) if (values[i]!.field === fieldName) return values[i]!;
  return undefined;
}

function sameNormalization(before: ResolvedOptions, after: ResolvedOptions): boolean {
  const same = <T>(a: T, b: T, keys: readonly (keyof T)[]) => keys.every(key => a[key] === b[key]);
  return after.valid && sameTableData(before.table, after.table) && before.series === after.series &&
    same(before.x, after.x, ['field', 'type', 'timeZone', 'ordered', 'label', 'unit']) &&
    before.values.length === after.values.length && before.values.every((field, i) =>
      same(field, after.values[i]!, ['field', 'label', 'unit', 'scale', 'missing', 'parse']));
}

class Cadence {
  last = -Infinity;
  #differences = 0;
  #min = Infinity;
  #span = 0;
  #matches = 0;
  #multiple: boolean | null = true;

  fork(): Cadence {
    const copy = new Cadence();
    copy.last = this.last;
    copy.#differences = this.#differences;
    copy.#min = this.#min;
    copy.#span = this.#span;
    copy.#matches = this.#matches;
    copy.#multiple = this.#multiple;
    return copy;
  }

  get ambiguous(): boolean { return this.#multiple === null && this.#frequent; }
  get #frequent(): boolean { return this.#differences >= 2 && 2 * this.#matches >= this.#differences; }
  get step(): number { return this.#multiple && this.#frequent ? this.#min : 0; }

  absent(step: number): number {
    return step ? Math.max(0, Math.round(this.#span / step) - this.#differences) : 0;
  }

  sparse(absent: number): boolean { return tooSparse(absent, this.#differences + 1); }

  extend(axis: XColumn, x: number): boolean {
    const previous = this.last;
    this.last = x;
    if (previous === -Infinity || !supportsSteps(axis)) return false;
    const delta = stepDelta(axis, previous, x);
    const multiple = stepMultiple(delta, this.#min);
    if (delta < this.#min && multiple !== 1) {
      // Only rescan an irregular prefix if the smaller step becomes frequent enough.
      this.#multiple = this.#differences === this.#matches ? !this.#differences || stepMultiple(this.#min, delta) > 0 : null;
      this.#min = delta;
      this.#matches = 1;
    } else {
      if (multiple === 1) this.#matches++;
      if (!multiple) this.#multiple = false;
    }
    this.#span += delta;
    this.#differences++;
    return multiple === 1;
  }

  multiple(delta: number): number { return stepMultiple(delta, this.#min); }

  regularSpan(delta: number, dropped: number | undefined): number | undefined {
    const step = this.step;
    if (!Number.isFinite(step) || !step || this.#matches !== this.#differences || this.absent(step) !== 0 ||
      (delta !== step && stepMultiple(delta, step) !== 1) ||
      (dropped !== undefined && dropped !== delta && stepMultiple(dropped, step) !== 1)) return;
    const extended = this.#span + delta;
    const count = this.#differences + 1;
    if (Math.round(extended / step) > count) return;
    const span = dropped === undefined ? extended : extended - dropped;
    const retainedCount = dropped === undefined ? count : this.#differences;
    if (Math.round(span / step) <= retainedCount) return span;
  }

  commitRegular(position: number, span: number, dropped: boolean): void {
    this.last = position;
    this.#span = span;
    if (!dropped) this.#matches = ++this.#differences;
  }

  evict(axis: XColumn, window: Observations, delta: number, multiple: number, writable: boolean): Cadence {
    if (!multiple || this.#multiple === null || this.#matches === Number(multiple === 1)) return Cadence.read(axis, window);
    const next = writable ? this : this.fork();
    next.#span -= delta;
    next.#differences--;
    if (multiple === 1) next.#matches--;
    return next;
  }

  static read(axis: XColumn, observations: Observations): Cadence {
    const c = new Cadence();
    c.last = observations.last ?? -Infinity;
    if (!supportsSteps(axis)) return c;
    let last = observations.first!;
    let max = -Infinity;
    for (let i = 1, x = observations.at(1); x !== undefined; x = observations.at(++i)) {
      const delta = stepDelta(axis, last, x);
      last = x;
      c.#min = Math.min(c.#min, delta);
      max = Math.max(max, delta);
      c.#span += delta;
      c.#differences++;
    }
    // On regular data every interval has the same multiple. One check covers the whole prefix.
    if (max === c.#min && c.multiple(max) === 1) {
      c.#matches = c.#differences;
      return c;
    }
    for (let i = 1, x = observations.at(1); x !== undefined; x = observations.at(++i)) {
      const multiple = c.multiple(stepDelta(axis, observations.at(i - 1)!, x));
      if (multiple === 1) c.#matches++;
      if (!multiple) c.#multiple = false;
    }
    return c;
  }
}

let countObservations: (bytes: ByteCount, key: string, window: Observations) => void;

class Observations {
  cadence!: Cadence;
  duplicates: StoreMap<number, true> | null = null;
  #positions: Float64Array;
  #range: BufferWindow;
  #prefixStart: number;

  #prefix: Float64Array | null;

  constructor(
    prefix: Float64Array | null = null,
    positions: Float64Array = getNoPositions(),
    range: BufferWindow = new BufferWindow(),
    prefixStart = 0,
  ) {
    this.#prefix = prefix;
    this.#positions = positions;
    this.#range = range;
    this.#prefixStart = prefixStart;
  }

  static {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) {
      countObservations = (bytes, key, window) => {
        const label = `series ${key} x history`;
        bytes.add(label, window.#prefix);
        if (window.#positions.length) bytes.add(label, window.#positions);
      };
    }
  }

  get last(): number | undefined {
    return this.#range.end > this.#range.start ? this.#positions[this.#range.end - 1] : this.#prefix?.at(-1);
  }

  get first(): number | undefined { return this.at(0); }

  fork(): Observations {
    const draft = new Observations(this.#prefix, this.#positions, this.#range.fork(), this.#prefixStart);
    draft.cadence = this.cadence;
    draft.duplicates = this.duplicates?.size ? this.duplicates.fork() : null;
    return draft;
  }

  useWindow(positions: Float64Array, cadence: Cadence): void {
    this.#prefix = positions;
    this.#prefixStart = 0;
    if (this.#positions !== getNoPositions()) {
      this.#positions = getNoPositions();
      this.#range = new BufferWindow();
    }
    this.cadence = cadence;
  }

  at(index: number): number | undefined {
    if (this.#prefix) {
      const remaining = this.#prefix.length - this.#prefixStart;
      if (index < remaining) return this.#prefix[this.#prefixStart + index];
      index -= remaining;
    }
    const { start, end } = this.#range;
    return start + index < end ? this.#positions[start + index] : undefined;
  }

  add(position: number): void {
    const capacity = this.#range.reserve(1, this.#positions.length);
    if (capacity) this.#resize(capacity, 1);
    this.#positions[this.#range.end++] = position;
  }

  evict(): void {
    if (this.#prefix) {
      this.#prefixStart++;
      if (this.#prefixStart === this.#prefix.length) {
        this.#prefix = null;
        this.#prefixStart = 0;
      }
      return;
    }
    this.#range.start++;
    const capacity = this.#range.compact(this.#positions.length);
    if (capacity) this.#resize(capacity, 0);
  }

  /**
   * Points the prefix at the store's own window, whose first slots hold the same positions (a wide frame over
   * one sorted x column, no gap slots): one copy of x per window, and the caller's column is not pinned.
   * Falls back to a copy of the remainder once half of it is gone, as before, if the window does not match.
   */
  share(x: Float64Array, start: number, end: number): void {
    const prefix = this.#prefix;
    if (!prefix) return;
    const shared = shareRemainder(prefix, this.#prefixStart, x, start, end);
    if (shared === prefix) return;
    if (shared) this.#prefix = shared;
    else if (this.#prefixStart * 2 >= prefix.length) this.#prefix = prefix.slice(this.#prefixStart);
    else return;
    this.#prefixStart = 0;
  }

  #resize(capacity: number, extra: number): void {
    const retained = this.#positions.subarray(this.#range.start, this.#range.end);
    this.#positions = new Float64Array(capacity);
    this.#positions.set(retained);
    this.#range.rebase(extra);
  }
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
    window.cadence = Cadence.read(axis, window);
    return new Map(options.values.map(field => [field.field, window.fork()]));
  }
  const field = options.series;
  const observations = new Map<string, Observations>();
  function observe(key: string, position: number): void {
    const window = groupFor(observations, key, Observations);
    if (position === window.last) {
      (window.duplicates ??= new StoreMap()).set(position, true);
    } else {
      window.add(position);
    }
  }
  for (let i = 0, length = x.order?.length ?? x.positions.length; i < length; i++) {
    const row = x.order?.[i] ?? i;
    const position = x.positions[row]!;
    if (field !== null) {
      const key = nameOf(table.read(row, field));
      if (key != null) observe(key, position);
    } else for (const value of options.values) observe(value.field, position);
  }
  for (const window of observations.values()) window.cadence = Cadence.read(axis, window);
  return observations;
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

function valueCounts(table: Table, field: string, positions: Float64Array, counts = { decimal: 0, other: 0 }, allFinite = false): ValueCounts {
  for (let i = 0; i < table.length; i++) {
    if (!allFinite && !Number.isFinite(positions[i])) continue;
    const kind = valueMode(table.read(i, field), table.isColumnRow(i));
    if (kind !== 'empty') counts[kind]++;
  }
  return counts;
}

interface State {
  readonly axis: XColumn;
  readonly parser: XData['parser'];
  buffers: FrameBuffers;
  readonly observations: Map<string, Observations>;
  modes: Map<string, ValueCounts>;
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
  readonly observed: Uint8Array | null;
  readonly ascending: boolean;
  readonly modes: State['modes'];
  readonly diagnostics: StreamDiagnostics;
}

function ownNumber(row: Record<string, unknown>, key: string): number | undefined {
  // Accessors use the general validation path, where reads can raise diagnostics.
  const property = Object.getOwnPropertyDescriptor(row, key);
  if (!property || !Object.hasOwn(property, 'value')) return undefined;
  const value: unknown = property.value;
  return typeof value === 'number' && Number.isFinite(value) && Object.is(row[key], value) ? value : undefined;
}

function tail(
  positions: Float64Array, series: readonly BatchSeries[], lastX: number, ascending: boolean,
): { x: Float64Array; observed: Uint8Array | null } {
  let seen: Float64Array;
  if (ascending) seen = positions;
  else if (positions.length === 1) {
    seen = Number.isFinite(positions[0]) && positions[0]! > lastX ? positions : getNoPositions();
  } else {
    const distinct = new Float64Array(positions.length);
    let length = 0;
    for (const position of positions) {
      if (position > lastX && Number.isFinite(position) && position !== distinct[length - 1]) distinct[length++] = position;
    }
    seen = distinct.subarray(0, length);
  }
  const x = mergeGaps(seen, series);
  if (x === seen) return { x, observed: null };
  const observed = new Uint8Array(x.length);
  let next = 0;
  for (let i = 0; i < x.length; i++) {
    if (x[i] === seen[next]) {
      observed[i] = 1;
      next++;
    }
  }
  return { x, observed };
}

interface LazyReports {
  reports: Reports | null;
}

function extendSeries(
  key: string, field: ResolvedValueField, values: Values, rows: readonly number[],
  positions: Float64Array, state: State, axis: XColumn, lastX: number,
  duplicates: LazyReports, xField: string, diagnostics: StreamDiagnostics, firstRow: number, allFinite: boolean, label: string = key,
): BatchSeries | null {
  const previous = state.observations.get(key)?.cadence ?? new Cadence();
  const next = previous.fork();
  let unique: number[] | undefined;
  let repeated: number[] | undefined;
  let consecutive = true;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const position = positions[row]!;
    if (position === next.last) {
      unique ??= rows.slice(0, i);
      (repeated ??= []).push(position);
      (duplicates.reports ??= new Reports(xField, diagnostics)).add('AX108', 'series-disabled', firstRow + row, undefined, undefined, {
        series: label, position: axis.kind === 'category' ? JSON.stringify(state.parser.categoryName(position)) : positionName(axis, position),
      });
    } else {
      consecutive = next.extend(axis, position) && consecutive;
      unique?.push(row);
    }
  }
  if (next.ambiguous) return null;
  const oldStep = previous.step;
  const newStep = next.step;
  const oldAbsent = previous.absent(oldStep);
  const nextAbsent = next.absent(newStep);
  const oldSparse = previous.sparse(oldAbsent);
  const newSparse = next.sparse(nextAbsent);
  if (oldSparse !== newSparse || oldStep !== newStep && !newSparse &&
    (oldAbsent > 0 || previous.absent(newStep) > 0)) return null;

  const observed = unique ?? rows;
  let gapCount = 0;
  if (newStep && !newSparse && !consecutive) {
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
  const state = values.slot ? values.slot[row]! : SLOT_VALUE;
  const imputed = zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD);
  series.y[target] = values.y[row]!;
  writeSlot(series, target, imputed ? SLOT_VALUE : state);
  buffers.setRow(series, target, imputed ? -1 : base + row);
}

function forkAlignedData(data: AlignedData, rows: StreamRows): AlignedData {
  const draft = new AlignedData(data.type, data.environment, data.fields, data.named, rows);
  draft.current = data.current;
  const state = data.state;
  // commitBatch replaces modes, votes and date units before trimming the draft.
  draft.state = {
    ...state, parser: state.parser.kind === 'category' || state.parser.kind === 'date' ? state.parser.fork() : state.parser,
    buffers: state.buffers.fork(),
    observations: forkValues(state.observations),
    calendar: state.calendar?.fork() ?? null, diagnostics: state.diagnostics.fork(),
  };
  return draft;
}

function buildAlignedData(
  data: AlignedData, table: Table, version: FrameVersion,
  categories: readonly string[] | null = data.state?.parser.categories ?? null, normalized?: AlignedFrame,
) {
  const options = { ...data.fields, table };
  const seed = normalized && alignedSeed(normalized);
  const diagnostics = seed?.diagnostics.copy() ?? new StreamDiagnostics();
  const x = seed ? { ...seed.x, parser: seed.x.parser.copy() } :
    readX(data.type, options.valid ? options : { ...options, table: rowsTable([]) },
      data.environment, diagnostics, categories ?? undefined);
  const frame = normalized ?? (options.valid ? alignedFrame(options, x, diagnostics, version)
    : normalizeAligned(data.type, options, data.environment, diagnostics, version));
  const axis = x.parser.column(getNoPositions(), true);
  const overBudget = !seed && diagnostics.inputs().some(diagnostic => diagnostic.code === 'AX134');
  const buffers = new FrameBuffers(frame, x.positions, x.order);
  const state: State = {
    axis, parser: x.parser, buffers,
    observations: overBudget ? new Map() : cadences(options, table, x, frame.x, buffers),
    modes: seed ? mapValues(seed.counts, count => ({ ...count })) : overBudget ? new Map() : new Map(options.values.map(value => [value.field, valueCounts(table, value.field, x.positions)])),
    calendar: overBudget ? null : calendarFor(x, table),
    votes: options.x.type !== null ? null : seed ?
      { date: 0, wall: 0, number: 0, time: 0, category: 0, [axis.kind]: x.positions.length } :
      countKinds(table, options.x.field, options.series),
    overBudget, dateUnits: seed && x.dateUnits ? { ...x.dateUnits } : x.dateUnits, diagnostics,
  };
  return { frame, state, x };
}

function dataDiagnostics(data: AlignedData): readonly DiagnosticInput[] {
  const findings = data.state.diagnostics.retained();
  const calendar = data.state.calendar?.diagnostic(data.fields.x.field, data.current.x.values[0]!);
  return calendar ? [...findings, calendar] : findings;
}

function dataSnapshot(data: AlignedData, frame: AlignedFrame, skipSource = false): AlignedFrame {
  const { buffers, axis } = data.state;
  const last = buffers.x[buffers.end - 1];
  let history: State['observations'] | null = data.state.observations;
  const snapshot = buffers.frame(frame, axis, skipSource ? noSource : data.rows.source(), key => history!.get(key)?.cadence.last !== last);
  // frame() checks the open tail synchronously. Its lazy columns can outlive this history's borrowed x prefix.
  history = null;
  return snapshot;
}

class AlignedData {
  state!: State;
  current!: AlignedFrame;
  latest!: readonly DiagnosticInput[];

  constructor(
    readonly type: AlignedChartType, readonly environment: DataEnvironment,
    readonly fields: Fields, readonly named: readonly [string, string][], readonly rows: StreamRows,
  ) {}

  adoptNormalized(table: Table, version: FrameVersion, normalized: AlignedFrame) {
    return buildAlignedData(this, table, version, null, normalized);
  }

  #batch(table: Table, positions: Float64Array, axis: XColumn, lastX: number,
    diagnostics: StreamDiagnostics, allFinite: boolean, ascending: boolean): Batch | null {
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
      const wasDecimal = before && mode(before) === 'decimal';
      const counts = valueCounts(table, field.field, positions, before, allFinite);
      if (wasDecimal && counts.other) return null;
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
          reportMissingName(seriesReports, firstRow + i, raw);
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
      const dense = allFinite ? smallBatches[table.length] : undefined;
      if (dense) allRows = dense;
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
        reportGaps(diagnostics, xField, item.value.missing === 'zero', item.gaps, axis, this.#label(item.key), item.sparse, item.key);
      }
    }
    const { x, observed } = tail(positions, series, lastX, ascending);
    return { positions, axis, series, x, observed, ascending, modes, diagnostics };
  }

  #commitBatch(
    batch: Batch, rows: readonly unknown[], version: FrameVersion, dateUnits: State['dateUnits'], votes: State['votes'],
  ): boolean {
    const base = this.rows.next;
    this.rows.appendPositions(rows, batch.positions, batch.ascending);
    const { buffers, calendar } = this.state;
    if (calendar) for (let i = 0; i < batch.positions.length; i++) {
      const position = batch.positions[i]!;
      if (!Number.isFinite(position)) continue;
      calendar.observe(position);
      calendar.record(base + i);
    }

    const length = batch.x.length;
    const dense = batch.ascending && !batch.observed && this.fields.series === null &&
      batch.series.length === buffers.series.size;
    const hasCompetingWrites = buffers.hasCompetingWrites;
    const resized = buffers.reserve(length);
    const { end } = buffers;
    const lastX = end > buffers.start ? buffers.x[end - 1] : undefined;
    buffers.x.set(batch.x, end);
    buffers.markObserved(batch.observed, end, length);
    const only = batch.series.length === 1 ? batch.series[0] : undefined;
    const updates = !dense && batch.series.length > 1 ? new Map<string, BatchSeries>() : null;
    for (let s = 0; s < batch.series.length; s++) {
      const item = batch.series[s]!;
      updates?.set(item.key, item);
      let series = buffers.series.get(item.key);
      const zero = item.value.missing === 'zero';
      const first = item.rows[0];
      const replacingLast = !batch.ascending && replacesLast(item, batch.positions, lastX);
      if (series && replacingLast && !resized) series = buffers.writeTail(series, hasCompetingWrites);
      if (!series) {
        series = buffers.addSeries({
          ...seriesDescription(item.key, this.fields.series === null ? item.value.label : item.key, item.value),
          drawable: true,
        }, zero);
      }
      const window = groupFor(this.state.observations, item.key, Observations);
      if (item.duplicates.length) {
        const positions = window.duplicates ??= new StoreMap();
        for (const position of item.duplicates) positions.set(position, true);
        if (series.description.drawable) series.description = { ...series.description, drawable: false };
      }
      if (replacingLast) {
        writeObservation(buffers, series, end - 1, item.values, first!, base, zero);
      }
      window.cadence = item.cadence;
      for (let r = 0; r < item.rows.length; r++) window.add(batch.positions[item.rows[r]!]!);
      if (dense) {
        for (let r = 0; r < length; r++) writeObservation(buffers, series, end + r, item.values, r, base, zero);
      }
    }
    if (!dense) for (const [key, series] of buffers.series) {
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
          writeSlot(series, target, zero ? SLOT_VALUE : missing ? SLOT_GAP : SLOT_NO_ROW);
        }
      }
    }
    buffers.end += length;
    this.state.diagnostics.merge(batch.diagnostics);
    this.state = { ...this.state, axis: batch.axis, modes: batch.modes, dateUnits, votes };
    this.current = { ...this.current, ...version };
    return dense;
  }

  #label(key: string): string {
    return this.fields.series === null ? this.fields.values.find(value => value.field === key)?.label ?? key : key;
  }

  #failAppend(count: number, version: FrameVersion, diagnostics: readonly DiagnosticInput[], sink: DiagnosticSink): AlignedFrame {
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

  #evictObservation(key: string, window: Observations, position: number, first: number, writable: boolean): boolean {
    const { axis, buffers, diagnostics, observations } = this.state;
    if (window.first !== position) return false;
    window.evict();
    const next = window.first;
    const series = buffers.series.get(key)!;
    if (next === undefined) {
      observations.delete(key);
      diagnostics.evictSeries(key);
      if (this.fields.series !== null) buffers.deleteSeries(key);
      else if (!series.description.drawable) series.description = { ...series.description, drawable: true };
      return false;
    }
    const repeats = window.duplicates;
    repeats?.delete(position);
    if (repeats?.size === 0) {
      window.duplicates = null;
      series.description = { ...series.description, drawable: true };
    }
    if (!supportsSteps(axis)) return false;
    const before = window.cadence;
    const previousStep = before.step;
    const oldAbsent = before.absent(previousStep);
    const oldSparse = before.sparse(oldAbsent);
    const delta = stepDelta(axis, position, next);
    const multiple = before.multiple(delta);
    const after = before.evict(axis, window, delta, multiple, writable);
    window.cadence = after;
    const currentStep = after.step;
    const newAbsent = after.absent(currentStep);
    const newSparse = after.sparse(newAbsent);
    if (oldSparse && newSparse) {
      reportGaps(diagnostics, this.fields.x.field, false, null, axis, this.#label(key), newAbsent, key);
      return false;
    }
    if (oldSparse) diagnostics.evictSeries(key);
    return (oldAbsent !== 0 || newAbsent !== 0) &&
      (previousStep !== currentStep || oldSparse !== newSparse || !newSparse && multiple > 1 && next > first);
  }

  /** History that reads x positions reads them from the window, never from a copy of its own. */
  #sharePositions(): void {
    const { buffers, observations } = this.state;
    const { x, start, end } = buffers;
    for (const history of observations.values()) history.share(x, start, end);
    this.rows.shareSeed(x, start, end);
  }

  #trim(keep: number, writable: boolean): boolean {
    const { axis, buffers, diagnostics, calendar, observations, modes, votes, parser, dateUnits } = this.state;
    if (keep >= buffers.distinct && !this.rows.hasUnplaced) return false;
    let update = false;
    let mixedModes: Set<string> | undefined;
    for (const [field, counts] of modes) {
      if (counts.decimal && counts.other) (mixedModes ??= new Set()).add(field);
    }
    let categories = 0;
    const first = buffers.retainedStart(keep);
    const firstX = buffers.x[first] ?? Infinity;
    const discard = (row: number, column: boolean, placed = true) => {
      diagnostics.evict(row, false);
      calendar?.evictRow(row);
      const x = votes || dateUnits ? this.rows.read(row, this.fields.x.field) : undefined;
      if (votes && (this.fields.series === null || nameOf(this.rows.read(row, this.fields.series)) !== null)) {
        const kind = voteOf(x, column);
        if (kind) votes[kind]--;
      }
      if (!placed) return;
      if (dateUnits) dateUnits[dateUnitOf(x)]--;
      for (const [field, counts] of modes) {
        const kind = valueMode(this.rows.read(row, field), column);
        if (kind !== 'empty') counts[kind]--;
      }
    };
    if (keep < buffers.distinct) {
      buffers.trim(first, (position, observed) => {
        diagnostics.evict(position, true);
        if (!observed) return;
        if (parser.kind === 'category') categories++;
        calendar?.evictPosition(position);
        for (const [key, window] of observations) {
          update = this.#evictObservation(key, window, position, firstX, writable) || update;
        }
        this.rows.evictRead(position, discard);
      });
      buffers.shrink();
    }
    if (buffers.distinct === 0) buffers.clearSeries();
    if (this.rows.hasUnplaced) {
      this.rows.trimUnplacedRead(keep, firstX, buffers.distinct, (row, column) => discard(row, column, false));
    }
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
      this.state = { ...this.state, axis: parser.column(getNoPositions(), true) };
    }
    const inferred = votes && preferredKind(votes);
    return update || Boolean(inferred && inferred !== parser.kind);
  }

  append(rows: readonly unknown[], keep: number | undefined, sink: DiagnosticSink, skipSource = false): AlignedFrame {
    const { parser, buffers } = this.state;
    const categoryCount = parser.categoryCount;
    const dateUnit = parser.dateUnit;
    const version = nextVersion(this.current);
    const lastX = buffers.end > buffers.start ? buffers.x[buffers.end - 1]! : -Infinity;
    const diagnostics = new StreamDiagnostics();
    const issues = new Reports(this.fields.x.field, diagnostics);
    let ordering: StreamDiagnostics | undefined;
    let order: Reports | undefined;
    const table = new AppendTable(rows);
    const fields = this.fields;
    if (!checkFields(table, this.named, diagnostics)) return this.#failAppend(rows.length, version, diagnostics.inputs(), sink);

    const votes = this.state.votes && addKinds(table, fields.x.field, fields.series, { ...this.state.votes });
    const inferred = votes && preferredKind(votes);
    const positions = new Float64Array(rows.length);
    const dateUnits = this.state.dateUnits && { ...this.state.dateUnits };
    let needsUpdate = !fields.valid || this.state.overBudget || Boolean(inferred && inferred !== parser.kind);
    let highest = lastX;
    let allFinite = true;
    let ascending = rows.length > 0;
    for (let i = 0; i < rows.length; i++) {
      const position = readPosition(parser, table, i, fields.series, fields.values.length, issues, dateUnits, this.rows.next);
      positions[i] = position;
      if (!Number.isFinite(position)) {
        allFinite = false;
        ascending = false;
        continue;
      }
      if (position <= highest) ascending = false;
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
      ? this.state.axis : parser.column(getNoPositions(), true);
    let batch = needsUpdate ? null : this.#batch(table, positions, axis, lastX, diagnostics, allFinite, ascending);
    if (ordering) order?.flush(ordering);
    const orderInputs = ordering?.inputs();
    let writableCadence = false;
    if (batch) {
      let count = buffers.series.size;
      for (let i = 0; i < batch.series.length; i++) if (!buffers.series.has(batch.series[i]!.key)) count++;
      const limits = keep === undefined ? new DiagnosticCollector() : null;
      if (!alignmentFits(count, buffers.end - buffers.start + batch.x.length, limits ?? quiet)) {
        if (limits) {
          parser.restore(categoryCount, dateUnit);
          return this.#failAppend(rows.length, version, limits.inputs(), sink);
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
      writableCadence = this.#commitBatch(batch, rows, version, dateUnits, votes);
    } else {
      parser.restore(categoryCount, dateUnit);
      const combined = this.rows.table(rows);
      let prepared = buildAlignedData(this, combined, version);
      const window = prepared.state.overBudget && keep !== undefined ? keptTable(combined, prepared.x, keep) : null;
      if (window) prepared = buildAlignedData(this, window.table, version, window.categories);
      const { frame, state, x: read } = prepared;
      if (state.overBudget) return this.#failAppend(rows.length, version, state.diagnostics.inputs(), sink);
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
      while (this.#trim(keep, writableCadence)) {
        const retained = this.rows.table();
        const { frame, state, x: read } = buildAlignedData(this, retained, version);
        this.rows.resetPositions(retained, read.positions);
        this.state = state;
        this.current = frame;
        if (state.overBudget) break;
      }
    }
    // Growth may have moved the window to a new buffer: history must not pin the old one.
    this.#sharePositions();
    if (keep !== undefined) this.rows.compactColumns(this.state.buffers.x.buffer);
    this.current = dataSnapshot(this, this.current, skipSource);
    const findings = dataDiagnostics(this);
    this.latest = orderInputs?.length ? [...findings, ...orderInputs] : findings;
    return this.current;
  }
}

let installAlignedExtras: () => void;

export class AlignedStore extends RevisionStore<AlignedFrame> {
  #data: AlignedData;
  #writing = false;
  readonly #sink: DiagnosticSink;

  constructor(
    type: AlignedChartType,
    options: ResolvedOptions,
    environment: DataEnvironment,
    version: FrameVersion,
    sink: DiagnosticSink = quiet,
    normalized?: AlignedFrame,
  ) {
    super(options.table);
    this.#sink = sink;
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installAlignedExtras();
    const { table, ...fields } = options;
    const data = this.#data = new AlignedData(type, environment, fields, namedFields(fields), this.rows);
    const seed = normalized && alignedSeed(normalized);
    const reusable = seed?.type === type && sameNormalization(seed.options, options);
    const { frame, state, x } = reusable
      ? data.adoptNormalized(table, version, normalized!)
      : buildAlignedData(data, table, version, null);
    data.state = state;
    this.rows.resetPositions(table, x.positions, prefixPositions(table, fields.x.field, x, state.buffers));
    data.current = dataSnapshot(data, frame, true);
    this.latest = data.latest = dataDiagnostics(data);
    this.publish(data.current);
    data.current = this.current;
    forwardDiagnostics(this.latest, sink);
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
    return withoutTable(resolveFields(this.#data.type, input, sink, this.rows.table()));
  }

  #prepareSingle(base: AlignedFrame, data: AlignedData, row: unknown, keep: number | undefined): PreparedFrame<AlignedFrame> | null {
    const { fields, rows, current, state } = data;
    const { axis, buffers, observations } = state;
    const { start, end } = buffers;
    const length = end - start;
    if (!fields.valid || state.overBudget || fields.series !== null || fields.x.type !== axis.kind ||
      (axis.kind !== 'number' && axis.kind !== 'time') || data.latest.length ||
      length < 3 || buffers.distinct !== length || rows.size !== length || current.length !== length ||
      !fields.values.length || fields.values.length !== buffers.series.size ||
      typeof row !== 'object' || row === null) return null;
    const prototype: unknown = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null) return null;

    if ((keep !== undefined && keep < length) || !alignmentFits(buffers.series.size, length + 1, quiet)) return null;
    const object = row as Record<string, unknown>;
    const position = ownNumber(object, fields.x.field);
    const last = buffers.x[end - 1]!;
    if (position === undefined || !(position > last)) return null;
    const delta = position - last;
    if (axis.kind === 'time') {
      const magnitude = Math.abs(position);
      // A retained sub-day interval rules out AX111 both before and after a one-row slide.
      if (magnitude > MAX_DATE || (magnitude >= 1e9 && magnitude < 1e10) || delta >= DAY - HOUR) return null;
    }

    const first = keep === length ? buffers.x[start]! : undefined;
    const evicted = first === undefined ? undefined : rows.firstRowAt(first);
    if (first !== undefined && evicted === undefined) return null;
    const dropped = first === undefined ? undefined : stepDelta(axis, first, buffers.x[start + 1]!);
    const primary = observations.get(fields.values[0]!.field);
    const cadence = primary?.cadence;
    if (!cadence) return null;
    const span = cadence.regularSpan(delta, dropped);
    if (span === undefined) return null;

    // Keep the common one-field preview in a scalar. Reads of caller properties may reenter.
    let firstValue = 0;
    const rest: number[] | null = fields.values.length > 1 ? [] : null;
    const column = evicted !== undefined && rows.isColumn(evicted);
    // Column compaction can invoke a caller's typed-array species during preparation.
    if (keep !== undefined && rows.needsColumnCompaction(Number(column))) return null;
    const outgoingRow = evicted !== undefined && !column ? rows.rowAt(evicted) as Record<string, unknown> : null;
    let modes = state.modes;
    for (let i = 0; i < fields.values.length; i++) {
      const key = fields.values[i]!.field;
      const value = ownNumber(object, key);
      const window = i === 0 ? primary : observations.get(key);
      const counts = state.modes.get(key);
      if (value === undefined || window?.cadence.last !== last || window.duplicates?.size ||
        !buffers.series.has(key) || counts?.decimal !== 0) return null;
      if (i === 0) firstValue = value;
      else rest!.push(value);

      let raw: unknown;
      if (column) raw = rows.read(evicted!, key);
      else if (outgoingRow) {
        const property = Object.getOwnPropertyDescriptor(outgoingRow, key);
        if (property) {
          if (!Object.hasOwn(property, 'value')) return null;
          raw = outgoingRow[key];
        }
      }
      const outgoing = valueMode(raw, column);
      if (outgoing === 'other') continue;
      if (modes === state.modes) modes = new Map(modes);
      modes.set(key, { decimal: counts.decimal - Number(outgoing === 'decimal'), other: counts.other + 1 });
    }

    const draft = buffers.fork(true);
    const index = rows.next;
    draft.reserve(1);
    const target = draft.end;
    draft.x[target] = position;
    for (let i = 0; i < fields.values.length; i++) {
      const series = draft.series.get(fields.values[i]!.field)!;
      series.y[target] = i === 0 ? firstValue : rest![i - 1]!;
      // A dense series has no state column; the slot is SLOT_VALUE already.
      if (series.slot) series.slot[target] = SLOT_VALUE;
      draft.setRow(series, target, index);
    }
    draft.markObserved(null, target, 1);
    draft.end++;
    if (first !== undefined) draft.dropObservedHead();
    const source = rows.previewAppend(row, evicted);
    const frame = draft.frame(current, axis, source, undefined, current.revision + 1);
    for (let i = 0; i < frame.series.length; i++) {
      extendStatistics(current.series[i]!, frame.series[i]!, first !== undefined);
    }
    return this.preview(base, frame, rows, noDiagnostics, noDiagnostics, () => {
      this.#checkWriting('commit');
      if (evicted !== undefined) this.revisions.current.archive(evicted, true);
      const committed = data.state;
      const { calendar } = committed;
      rows.appendPosition(row, position);
      calendar?.observe(position);
      calendar?.record(index);
      if (first !== undefined) {
        rows.evictSingle(first, evicted!);
        calendar?.evictPosition(first);
        calendar?.evictRow(evicted!);
      }
      // Competing previews have their own spans. Only the winning commit advances this cadence.
      cadence.commitRegular(position, span, first !== undefined);
      // Every wide series can use the frame's own x window as its observation history.
      for (const history of committed.observations.values()) history.useWindow(frame.x.values, cadence);
      rows.shareSeed(draft.x, draft.start, draft.end);
      if (keep !== undefined) rows.compactColumns(draft.x.buffer);
      committed.buffers = draft;
      committed.modes = modes;
      data.current = frame;
    }, source);
  }

  #checkWriting(action: string): void {
    if (this.#writing) throw new Error(`Cannot ${action} a data change during an append.`);
  }

  prepareAppend(rows: readonly unknown[], options: StoreAppendOptions = {}): PreparedFrame<AlignedFrame> {
    this.#checkWriting('prepare');
    const base = this.current;
    const data = this.#data;
    const keep = retention(options);
    if (rows.length === 1) {
      const single = this.#prepareSingle(base, data, rows[0], keep);
      if (single) return single;
    }
    const rowsDraft = this.rows.fork();
    rowsDraft.trackEvictions = true;
    const draft = forkAlignedData(this.#data, rowsDraft);
    const call = new DiagnosticCollector();
    try {
      draft.append(rows, keep, call, true);
    } finally {
      rowsDraft.trackEvictions = false;
    }
    const evicted = rowsDraft.evicted;
    rowsDraft.evicted = null;
    return this.#transaction(base, draft, call, evicted);
  }

  prepareReencode(options: ResolvedOptions, version: FrameVersion): PreparedFrame<AlignedFrame> {
    return this.#prepareEncoding(this.rows.fork(), options, version, new DiagnosticCollector());
  }

  #prepareEncoding(
    rows: StreamRows, options: ResolvedOptions, version: FrameVersion, call: DiagnosticCollector,
    replacement?: { table: Table; valid: boolean },
  ): PreparedFrame<AlignedFrame> {
    this.#checkWriting('prepare');
    const base = this.current;
    checkVersion(base, version);
    const input = replacement?.table ?? rows.table();
    const { table, ...fields } = retargetOptions(options, input, call, replacement?.valid);
    const { type, environment } = this.#data;
    const draft = new AlignedData(type, environment, fields, namedFields(fields), rows);
    const built = buildAlignedData(draft, table, version, null);
    draft.state = built.state;
    draft.rows.resetPositions(table, built.x.positions);
    draft.current = dataSnapshot(draft, built.frame, true);
    forwardDiagnostics(dataDiagnostics(draft), call);
    draft.latest = call.inputs();
    return this.#transaction(base, draft, call, null, replacement !== undefined);
  }

  #transaction(
    base: AlignedFrame, draft: AlignedData, call: DiagnosticCollector, evicted: number | readonly number[] | null, replacement = false,
  ): PreparedFrame<AlignedFrame> {
    const candidate = this.preview(base, draft.current, draft.rows, draft.latest, call.inputs(), () => {
      this.#checkWriting('commit');
      this.commitRows(draft.rows, evicted, replacement);
      draft.state.parser.commit();
      draft.state.calendar?.commit();
      draft.state.diagnostics.commit();
      for (const window of draft.state.observations.values()) window.duplicates?.commit();
      this.#data = draft;
    });
    draft.current = candidate.frame;
    return candidate;
  }

  static {
    if (__DEV__ || (typeof __BENCH__ !== 'undefined' && __BENCH__)) installAlignedExtras = () => {
      if (Object.hasOwn(AlignedStore.prototype, 'ownedBytes')) return;
      const proto = AlignedStore.prototype;
      Object.defineProperty(proto, 'diagnostics', { configurable: true, get(this: AlignedStore) { return this.latest; } });
      proto.ownedBytes = function (this: AlignedStore, frames: readonly Frame[] = []): OwnedBytes {
        const bytes = new ByteCount(new CallerBuffers());
        const state = this.#data.state;
        countBuffers(state.buffers, bytes);
        for (const [key, window] of state.observations) countObservations(bytes, key, window);
        countRevisions(this.revisions, bytes);
        bytes.frame(this.current);
        for (const frame of frames) bytes.frame(frame);
        return bytes.result();
      };
      proto.append = function (this: AlignedStore, rows: readonly unknown[], options: { keep?: number } = {}, sink = this.#sink): AlignedFrame {
        if (retention(options) !== undefined) {
          const prepared = this.prepareAppend(rows, options);
          forwardDiagnostics(prepared.callDiagnostics, sink);
          prepared.commit();
          return prepared.frame;
        }
        this.#checkWriting('prepare');
        // Without an inspected candidate, the incremental path can safely reuse the owned buffers.
        once(() => this.current, () => {
          const parser = this.#data.state.parser;
          const count = parser.categoryCount;
          const unit = parser.dateUnit;
          this.#writing = true;
          try {
            this.publish(this.#data.append(rows, undefined, sink));
            this.#data.current = this.current;
            this.latest = this.#data.latest;
          } catch (error) {
            parser.restore(count, unit);
            throw error;
          } finally {
            this.#writing = false;
          }
        }, this.current)();
        return this.current;
      };
      installEncodingExtras<AlignedFrame, AlignedStore>(proto, function (rows, options, version, call, replacement) {
        return this.#prepareEncoding(rows, options, version, call, replacement);
      });
    };
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

/** AlignedStore.fromFrame as a plain function, for a chart kind's composition (a member read is not tree-shakable). */
export function openAlignedStore(
  frame: AlignedFrame, options: ResolvedOptions, data: unknown, environment: DataEnvironment, type: AlignedChartType,
): AlignedStore {
  return AlignedStore.fromFrame(frame, options, data, environment, type);
}
