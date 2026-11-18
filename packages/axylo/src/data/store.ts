import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticInput, type DiagnosticSink, type XColumn,
} from '../core/contracts';
import { DiagnosticCollector } from '../diagnostics';
import {
  alignedFrame, alignmentFits, normalize, readX, reportGaps, seriesDescription,
  type DataEnvironment, type FrameVersion, type XData,
} from './normalize';
import { checkFields, type AlignedChartType, type ResolvedOptions, type ResolvedValueField } from './options';
import { Reports } from './reports';
import { gapPosition, snapGap, stepDelta, stepMultiple, supportsSteps, tooSparse } from './steps';
import { FrameBuffers, type SeriesBuffers } from './store-buffers';
import { CalendarWindow } from './store-calendar';
import { StreamDiagnostics } from './store-diagnostics';
import { StreamRows } from './store-rows';
import { rowValue, rowsTable, type Table } from './table';
import { readValues, valueMode, type ValueMode, type Values } from './values';
import { countKinds, dateUnitOf, kindOf, nameOf, positionName, preferredKind, type DateUnit, type KindVotes } from './x';

const quiet: DiagnosticSink = { add: () => {} };
type Fields = Omit<ResolvedOptions, 'table'>;

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
  private positions = new Float64Array();
  private start = 0;
  private end = 0;

  get first(): number | undefined { return this.at(0); }

  at(index: number): number | undefined {
    return this.start + index < this.end ? this.positions[this.start + index] : undefined;
  }

  add(position: number): void {
    if (this.end === this.positions.length) this.resize(1);
    this.positions[this.end++] = position;
  }

  evict(): void {
    this.start++;
    if (this.positions.length > Math.max(8, 4 * (this.end - this.start))) this.resize(0);
  }

  private resize(extra: number): void {
    const retained = this.positions.subarray(this.start, this.end);
    this.positions = new Float64Array(Math.max(4, 2 * (retained.length + extra)));
    this.positions.set(retained);
    this.start = 0;
    this.end = retained.length;
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

function seriesKeys(table: Table, field: string | null): (string | null)[] | null {
  if (field === null) return null;
  const keys = new Array<string | null>(table.length);
  for (let row = 0; row < table.length; row++) keys[row] = nameOf(table.read(row, field));
  return keys;
}

function eachObservation(
  options: Fields, x: XData, keys: readonly (string | null)[] | null,
  visit: (key: string, position: number) => void,
): void {
  const length = x.order?.length ?? x.positions.length;
  for (let i = 0; i < length; i++) {
    const row = x.order?.[i] ?? i;
    const position = x.positions[row]!;
    if (keys) {
      const key = keys[row];
      if (key != null) visit(key, position);
    } else {
      for (const field of options.values) visit(field.field, position);
    }
  }
}

function cadences(options: Fields, table: Table, x: XData, axis: XColumn) {
  const keys = seriesKeys(table, options.series);
  const observations = new Map<string, Observations>();
  const duplicates = new Map<string, Set<number>>();
  const last = new Map<string, number>();
  eachObservation(options, x, keys, (key, position) => {
    let window = observations.get(key);
    if (!window) observations.set(key, window = new Observations());
    if (position === last.get(key)) {
      let positions = duplicates.get(key);
      if (!positions) duplicates.set(key, positions = new Set());
      positions.add(position);
    } else {
      window.add(position);
      last.set(key, position);
    }
  });
  const history = new Map(Array.from(observations, ([key, window]) => [key, readCadence(axis, window)]));
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

interface ValueCounts {
  decimal: number;
  other: number;
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
  readonly duplicates: Map<string, Set<number>>;
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
  const gapCount = series.reduce((sum, item) => sum + (item.gaps?.length ?? 0), 0);
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

function extendSeries(
  key: string, field: ResolvedValueField, values: Values, rows: readonly number[],
  positions: Float64Array, state: State, axis: XColumn, lastX: number,
  duplicates: Reports, firstRow: number, observedX: () => Float64Array, label: string = key,
): BatchSeries | null {
  const previous = state.history.get(key) ?? cadence();
  const next = { ...previous };
  const observed: number[] = [];
  const repeated: number[] = [];
  for (const row of rows) {
    const position = positions[row]!;
    if (position === next.last) {
      repeated.push(position);
      duplicates.add('AX108', 'series-disabled', firstRow + row, undefined, undefined, {
        series: label, position: axis.kind === 'category' ? JSON.stringify(state.parser.categoryName(position)) : positionName(axis, position),
      });
    } else {
      extend(next, axis, position);
      observed.push(row);
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
  if (newSparse) return { key, value: field, values, rows: observed, cadence: next, gaps: null, duplicates: repeated, sparse: nextAbsent };

  let gapCount = 0;
  if (newStep) {
    let last = previous.last;
    for (const row of observed) {
      const position = positions[row]!;
      if (last !== -Infinity) gapCount += stepMultiple(stepDelta(axis, last, position), newStep) - 1;
      last = position;
    }
  }
  const gaps = gapCount ? new Float64Array(gapCount) : null;
  if (gaps) {
    let index = 0;
    let last = previous.last;
    for (const row of observed) {
      const position = positions[row]!;
      const multiple = last === -Infinity ? 0 : stepMultiple(stepDelta(axis, last, position), newStep);
      for (let j = 1; j < multiple; j++) {
        let gap = gapPosition(axis, last, position, newStep, j, multiple);
        if (axis.kind === 'number') {
          const x = observedX();
          const previous = Number.isFinite(lastX) ? 1 : 0;
          gap = snapGap(gap, last, position, newStep, x.length + previous, i => previous && i === 0 ? lastX : x[i - previous]!);
        }
        if (gap <= lastX) return null;
        gaps[index++] = gap;
      }
      last = position;
    }
  }
  return { key, value: field, values, rows: observed, cadence: next, gaps, duplicates: repeated, sparse: 0 };
}

function keptTable(table: Table, x: XData, keep: number): {
  table: Table; discarded: readonly number[]; categories: readonly string[] | null;
} | null {
  const { positions, order, parser } = x;
  let first = Infinity;
  let distinct = 0;
  if (keep > 0) {
    for (let i = (order?.length ?? positions.length) - 1; i >= 0; i--) {
      const position = positions[order?.[i] ?? i]!;
      if (position === first) continue;
      if (distinct === keep) break;
      first = position;
      distinct++;
    }
    if (distinct < keep) return null;
  }

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
  series: SeriesBuffers, target: number, values: Values, row: number, base: number, zero: boolean,
): void {
  const state = values.slot[row]!;
  const imputed = zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD);
  series.y[target] = values.y[row]!;
  series.slot[target] = imputed ? SLOT_VALUE : state;
  series.row[target] = imputed ? -1 : base + row;
}

export class AlignedStore {
  private readonly rows: StreamRows;
  private readonly fields: Fields;
  private state: State;
  private current: AlignedFrame;
  private latest: readonly DiagnosticInput[];

  constructor(
    private readonly type: AlignedChartType,
    options: ResolvedOptions,
    private readonly environment: DataEnvironment,
    version: FrameVersion,
    private readonly sink: DiagnosticSink = quiet,
  ) {
    const { table, ...fields } = options;
    this.rows = new StreamRows(table);
    this.fields = fields;
    const { frame, state, x } = this.build(table, version);
    this.state = state;
    this.rows.resetPositions(table, x.positions);
    this.current = this.snapshot(frame);
    this.latest = this.currentDiagnostics();
    for (const diagnostic of this.latest) this.sink.add(diagnostic);
  }

  get frame(): AlignedFrame {
    return this.current;
  }

  get diagnostics(): readonly DiagnosticInput[] {
    return this.latest;
  }

  private build(table: Table, version: FrameVersion, categories: readonly string[] | null = this.state?.parser.categories ?? null) {
    const options = { ...this.fields, table };
    const diagnostics = new StreamDiagnostics();
    const x = readX(this.type, this.fields.valid ? options : { ...options, table: rowsTable([]) },
      this.environment, diagnostics, categories ?? undefined);
    const frame = options.valid ? alignedFrame(options, x, diagnostics, version)
      : normalize(this.type, options, this.environment, diagnostics, version);
    const axis = x.parser.column(new Float64Array(), true);
    const overBudget = diagnostics.inputs().some(diagnostic => diagnostic.code === 'AX134');
    const dateUnits = axis.kind === 'date' ? { day: 0, month: 0, year: 0 } : null;
    if (dateUnits && !overBudget) {
      for (let i = 0; i < table.length; i++) {
        if (Number.isFinite(x.positions[i])) dateUnits[dateUnitOf(table.read(i, options.x.field))]++;
      }
    }
    const state: State = {
      axis, parser: x.parser, buffers: new FrameBuffers(frame, x.positions, x.order),
      ...(overBudget ? { history: new Map(), observations: new Map(), duplicates: new Map() } : cadences(options, table, x, frame.x)),
      modes: overBudget ? new Map() : new Map(options.values.map(value => [value.field, valueCounts(table, value.field, x.positions)])),
      calendar: overBudget ? null : calendarFor(x, table),
      votes: options.x.type === null ? countKinds(table, options.x.field, options.series) : null,
      overBudget, dateUnits, diagnostics,
    };
    return { frame, state, x };
  }

  private batch(table: Table, positions: Float64Array, axis: XColumn, lastX: number, diagnostics: StreamDiagnostics): Batch | null {
    const { state, fields } = this;
    const modes = new Map(state.modes);
    const values = new Map<string, Values>();
    const included = (i: number) => Number.isFinite(positions[i]);
    for (const field of fields.values) {
      const before = modes.get(field.field) ?? { decimal: 0, other: 0 };
      const added = valueCounts(table, field.field, positions);
      if (mode(before) === 'decimal' && added.other) return null;
      const counts = { decimal: before.decimal + added.decimal, other: before.other + added.other };
      modes.set(field.field, counts);
      values.set(field.field, readValues(table, field, diagnostics, true, this.rows.next, mode(counts), included));
    }

    const memberships = new Map<string, number[]>();
    const seriesReports = fields.series === null ? null : new Reports(fields.series, diagnostics);
    const allRows: number[] = [];
    for (let i = 0; i < table.length; i++) {
      const position = positions[i]!;
      if (Number.isFinite(position) && !seriesReports) allRows.push(i);
      if (!seriesReports) continue;
      const raw = table.read(i, fields.series!);
      const key = nameOf(raw);
      if (key === null) {
        if (raw === undefined) seriesReports.add('AX102', 'omitted', this.rows.next + i, undefined, undefined, { outcome: 'The affected row is not drawn.' });
        else seriesReports.add('AX107', 'omitted', this.rows.next + i, raw, 'Supply a name for the series in each row.');
        continue;
      }
      if (!Number.isFinite(position)) continue;
      let indexes = memberships.get(key);
      if (!indexes) memberships.set(key, indexes = []);
      indexes.push(i);
    }
    seriesReports?.flush(diagnostics);

    const series: BatchSeries[] = [];
    const duplicates = new Reports(fields.x.field, diagnostics);
    let validX: Float64Array | undefined;
    const observedX = () => validX ??= positions.every(Number.isFinite) ? positions : positions.filter(Number.isFinite);
    if (fields.series !== null) {
      for (const [key, rows] of memberships) {
        const value = fields.values[0]!;
        const item = extendSeries(key, value, values.get(value.field)!, rows, positions, state, axis, lastX, duplicates, this.rows.next, observedX);
        if (!item) return null;
        series.push(item);
      }
    } else {
      for (const field of fields.values) {
        const item = extendSeries(field.field, field, values.get(field.field)!, allRows, positions, state, axis, lastX, duplicates, this.rows.next, observedX, field.label);
        if (!item) return null;
        series.push(item);
      }
    }
    duplicates.flush(diagnostics);
    for (const item of series) {
      reportGaps(diagnostics, fields.x.field, item.value.missing === 'zero', item.gaps, axis, this.label(item.key), item.sparse, item.key);
    }
    return { positions, axis, series, ...tail(positions, series, lastX), modes, diagnostics };
  }

  private commitBatch(batch: Batch, rows: readonly unknown[], version: FrameVersion): void {
    const base = this.rows.next;
    this.rows.append(rows);
    for (let i = 0; i < batch.positions.length; i++) {
      const position = batch.positions[i]!;
      const row = base + i;
      this.rows.record(position, row);
      if (!Number.isFinite(position)) continue;
      if (this.state.dateUnits) this.state.dateUnits[dateUnitOf(rowValue(rows[i], this.fields.x.field))]++;
      this.state.calendar?.observe(position);
      this.state.calendar?.record(row);
    }

    const { buffers } = this.state;
    buffers.reserve(batch.x.length);
    const { end } = buffers;
    const lastX = buffers.x[end - 1];
    buffers.x.set(batch.x, end);
    buffers.observed.set(batch.observed, end);
    for (const observed of batch.observed) buffers.distinct += observed;
    const updates = new Map(batch.series.map(item => [item.key, item]));
    const priorWrites = new Set<string>();
    for (const item of batch.series) {
      let series = buffers.series.get(item.key);
      const zero = item.value.missing === 'zero';
      const first = item.rows[0];
      const replacingLast = first !== undefined && batch.positions[first] === lastX;
      if (!series) {
        series = buffers.addSeries({
          ...seriesDescription(item.key, this.fields.series === null ? item.value.label : item.key, item.value),
          drawable: true,
        }, zero);
      }
      if (item.duplicates.length) {
        let positions = this.state.duplicates.get(item.key);
        if (!positions) this.state.duplicates.set(item.key, positions = new Set());
        for (const position of item.duplicates) positions.add(position);
        if (series.description.drawable) series.description = { ...series.description, drawable: false };
      }
      if (replacingLast) {
        writeObservation(series, end - 1, item.values, first, base, zero);
        priorWrites.add(item.key);
      }
      this.state.history.set(item.key, item.cadence);
      let window = this.state.observations.get(item.key);
      if (!window) this.state.observations.set(item.key, window = new Observations());
      for (const row of item.rows) window.add(batch.positions[row]!);
    }
    const length = batch.x.length;
    for (const [key, series] of buffers.series) {
      const item = updates.get(key);
      const zero = (item?.value ?? this.fields.values.find(field => field.field === series.description.field))?.missing === 'zero';
      let next = priorWrites.has(key) ? 1 : 0;
      let gap = 0;
      for (let i = 0; i < length; i++) {
        const position = batch.x[i]!;
        const row = item?.rows[next];
        const target = end + i;
        if (item && row !== undefined && batch.positions[row] === position) {
          writeObservation(series, target, item.values, row, base, zero);
          next++;
        } else {
          const missing = item?.gaps?.[gap] === position;
          if (missing) gap++;
          series.row[target] = -1;
          series.y[target] = zero ? 0 : NaN;
          series.slot[target] = zero ? SLOT_VALUE : missing ? SLOT_GAP : SLOT_NO_ROW;
        }
      }
    }
    buffers.end += length;
    this.state.diagnostics.merge(batch.diagnostics);
    this.state = { ...this.state, axis: batch.axis, modes: batch.modes };
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

  private snapshot(frame: AlignedFrame): AlignedFrame {
    const { buffers, axis, history } = this.state;
    const last = buffers.x[buffers.end - 1];
    return buffers.frame(frame, axis, this.rows.source(), key => history.get(key)?.last !== last);
  }

  private failAppend(count: number, version: FrameVersion, diagnostics: readonly DiagnosticInput[], sink: DiagnosticSink): AlignedFrame {
    for (const diagnostic of diagnostics) sink.add(diagnostic);
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
      duplicates.delete(key);
      diagnostics.evictSeries(key);
      if (this.fields.series !== null) buffers.series.delete(key);
      else if (!series.description.drawable) series.description = { ...series.description, drawable: true };
      return false;
    }
    const repeats = duplicates.get(key);
    repeats?.delete(position);
    if (repeats?.size === 0) {
      duplicates.delete(key);
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

  private trim(keep: number, ordering: StreamDiagnostics): boolean {
    const { buffers, diagnostics, calendar, observations, modes, votes, parser, dateUnits } = this.state;
    let update = false;
    const priorModes = new Map(Array.from(modes, ([field, counts]) => [field, mode(counts)]));
    let categories = 0;
    let remove = buffers.distinct - keep;
    let first = buffers.start;
    while (remove > 0 && first < buffers.end) remove -= buffers.observed[first++]!;
    while (first < buffers.end && !buffers.observed[first]) first++;
    const firstX = buffers.x[first] ?? Infinity;
    const discard = (row: number, value?: unknown, column?: boolean, placed = true) => {
      diagnostics.evict(row, false);
      ordering.evict(row, false);
      calendar?.evictRow(row);
      if (votes && (this.fields.series === null || nameOf(rowValue(value, this.fields.series)) !== null)) {
        const x = rowValue(value, this.fields.x.field);
        if (x != null && x !== '') votes[kindOf(x) ?? 'category']--;
      }
      if (!placed) return;
      if (dateUnits) dateUnits[dateUnitOf(rowValue(value, this.fields.x.field))]--;
      for (const [field, counts] of modes) {
        const kind = valueMode(rowValue(value, field), column ?? false);
        if (kind !== 'empty') counts[kind]--;
      }
    };
    buffers.trim(keep, (position, observed) => {
      diagnostics.evict(position, true);
      if (!observed) return;
      if (parser.kind === 'category') categories++;
      calendar?.evictPosition(position);
      for (const [key, window] of observations) {
        update = this.evictObservation(key, window, position, firstX) || update;
      }
      this.rows.evict(position, discard);
    });
    buffers.shrink();
    if (buffers.distinct === 0) buffers.series.clear();
    this.rows.trimUnplaced(keep, firstX, buffers.distinct, (row, value, column) => discard(row, value, column, false));
    this.rows.compact(keep);
    if (categories) parser.evictCategories(categories);
    for (const [field, counts] of modes) {
      if (priorModes.get(field) === 'other' && mode(counts) === 'decimal') update = true;
    }
    if (dateUnits) {
      const precision = dateUnits.day ? 'day' : dateUnits.month ? 'month' : dateUnits.year ? 'year' : null;
      if (precision === null) parser.restore(parser.categoryCount, null);
      else if (precision !== parser.dateUnit) update = true;
    }
    const inferred = votes && preferredKind(votes);
    return update || Boolean(inferred && inferred !== parser.kind);
  }

  append(rows: readonly unknown[], options: { keep?: number } = {}, sink = this.sink): AlignedFrame {
    const { parser, buffers } = this.state;
    const categoryCount = parser.categoryCount;
    const dateUnit = parser.dateUnit;
    const keep = options.keep === undefined || !Number.isFinite(options.keep) ? undefined : Math.max(0, Math.floor(options.keep));
    const version = { epoch: this.current.epoch, revision: this.current.revision + 1 };
    const lastX = buffers.x[buffers.end - 1] ?? -Infinity;
    const diagnostics = new StreamDiagnostics();
    const issues = new Reports(this.fields.x.field, diagnostics);
    const ordering = new StreamDiagnostics();
    const order = new Reports(this.fields.x.field, ordering);
    const table = rowsTable(rows);
    const fields = this.fields;
    const named: [string, string][] = [[fields.x.field, 'x'], ...fields.values.map(value => [value.field, 'y'] as [string, string])];
    if (fields.series !== null) named.push([fields.series, 'series']);
    if (!checkFields(table, named, diagnostics)) return this.failAppend(rows.length, version, diagnostics.inputs(), sink);

    const votes = this.state.votes && countKinds(table, fields.x.field, fields.series);
    if (votes) for (const kind of Object.keys(votes) as (keyof KindVotes)[]) votes[kind] += this.state.votes![kind];
    const inferred = votes && preferredKind(votes);
    const positions = new Float64Array(rows.length);
    let needsUpdate = !fields.valid || this.state.overBudget || Boolean(inferred && inferred !== parser.kind);
    let highest = lastX;
    for (let i = 0; i < rows.length; i++) {
      const validSeries = fields.series === null || nameOf(table.read(i, fields.series)) !== null;
      const position = validSeries ? parser.read(table.read(i, fields.x.field), this.rows.next + i, issues, fields.values.length) : NaN;
      positions[i] = position;
      if (!Number.isFinite(position)) continue;
      if (position < highest) order.add('AX151', 'none', this.rows.next + i);
      if (position < highest) needsUpdate = true;
      highest = Math.max(highest, position);
    }
    if (dateUnit !== parser.dateUnit && buffers.distinct) needsUpdate = true;
    issues.flush(diagnostics);
    const axis = categoryCount === parser.categoryCount && dateUnit === parser.dateUnit
      ? this.state.axis : parser.column(new Float64Array(), true);
    let batch = needsUpdate ? null : this.batch(table, positions, axis, lastX, diagnostics);
    order.flush(ordering);
    if (batch) {
      const count = buffers.series.size + batch.series.filter(item => !buffers.series.has(item.key)).length;
      const limits = new DiagnosticCollector();
      if (!alignmentFits(count, buffers.end - buffers.start + batch.x.length, limits)) {
        if (keep === undefined) {
          parser.restore(categoryCount, dateUnit);
          return this.failAppend(rows.length, version, limits.inputs(), sink);
        }
        batch = null;
      }
    }

    if (batch) {
      try {
        for (const diagnostic of batch.diagnostics.inputs()) sink.add(diagnostic);
        const hint = this.state.calendar?.preview(fields.x.field, buffers.x[buffers.start] ?? -Infinity, positions, this.rows.next);
        if (hint) sink.add(hint);
      } catch (error) {
        parser.restore(categoryCount, dateUnit);
        throw error;
      }
      this.commitBatch(batch, rows, version);
      this.state = { ...this.state, votes };
    } else {
      parser.restore(categoryCount, dateUnit);
      const combined = this.rows.table(rows);
      let prepared = this.build(combined, version);
      const window = prepared.state.overBudget && keep !== undefined ? keptTable(combined, prepared.x, keep) : null;
      if (window) prepared = this.build(window.table, version, window.categories);
      const { frame, state, x: read } = prepared;
      if (state.overBudget) return this.failAppend(rows.length, version, state.diagnostics.inputs(), sink);
      for (const diagnostic of ordering.inputs()) sink.add(diagnostic);
      for (const diagnostic of state.diagnostics.inputs()) sink.add(diagnostic);
      const hint = state.calendar?.diagnostic(fields.x.field, frame.x.values[0]!);
      if (hint) sink.add(hint);
      this.rows.append(rows);
      for (const row of window?.discarded ?? []) {
        ordering.evict(row, false);
        this.rows.forget(row);
      }
      this.rows.resetPositions(window?.table ?? combined, read.positions);
      this.state = state;
      this.current = frame;
    }

    if (keep !== undefined) {
      while (this.trim(keep, ordering)) {
        const retained = this.rows.table([]);
        const { frame, state, x: read } = this.build(retained, version);
        this.rows.resetPositions(retained, read.positions);
        this.state = state;
        this.current = frame;
        if (state.overBudget) break;
      }
      this.state = { ...this.state, axis: this.state.parser.column(new Float64Array(), true) };
    }
    this.current = this.snapshot(this.current);
    this.latest = [...this.currentDiagnostics(), ...ordering.inputs()];
    return this.current;
  }
}
