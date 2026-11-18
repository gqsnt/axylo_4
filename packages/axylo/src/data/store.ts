import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticInput, type DiagnosticSink, type XColumn,
} from '../core/contracts';
import { DiagnosticCollector, report } from '../diagnostics';
import {
  alignedFrame, normalize, readX, reportCalendarDates, reportGaps, seriesDescription,
  type DataEnvironment, type FrameVersion, type XData,
} from './normalize';
import type { AlignedChartType, ResolvedOptions, ResolvedValueField } from './options';
import { Reports } from './reports';
import { gapPosition, stepDelta, stepMultiple, supportsSteps } from './steps';
import { FrameBuffers } from './store-buffers';
import { StreamRows } from './store-rows';
import { rowsTable, type Table } from './table';
import { inspectValues, readValues, type ValueMode, type Values } from './values';
import { dailyDelta, DAY, inferKind, nameOf, sameDailyTime } from './x';

const quiet: DiagnosticSink = { add: () => {} };
type Fields = Omit<ResolvedOptions, 'table'>;

interface Cadence {
  last: number;
  differences: number;
  min: number;
  max: number;
  matches: number;
  multiple: boolean;
}

function cadence(): Cadence {
  return { last: -Infinity, differences: 0, min: Infinity, max: 0, matches: 0, multiple: true };
}

function step(c: Cadence): number {
  return c.differences >= 2 && c.multiple && 2 * c.matches >= c.differences ? c.min : 0;
}

function extend(c: Cadence, axis: XColumn, x: number): boolean {
  const previous = c.last;
  c.last = x;
  if (previous === -Infinity || !supportsSteps(axis)) return true;
  const delta = stepDelta(axis, previous, x);
  if (delta < c.min && stepMultiple(delta, c.min) !== 1) {
    if (c.differences !== c.matches) return false;
    c.multiple = c.differences === 0 || stepMultiple(c.min, delta) > 0;
    c.min = delta;
    c.matches = 1;
  } else {
    const multiple = stepMultiple(delta, c.min);
    if (multiple === 1) c.matches++;
    if (multiple === 0) c.multiple = false;
  }
  c.max = Math.max(c.max, delta);
  c.differences++;
  return true;
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

function cadences(options: Fields, table: Table, x: XData, axis: XColumn): Map<string, Cadence> {
  const keys = seriesKeys(table, options.series);
  const history = new Map<string, Cadence>();
  eachObservation(options, x, keys, (key, position) => {
    let c = history.get(key);
    if (!c) {
      c = cadence();
      history.set(key, c);
    }
    if (position !== c.last && c.last !== -Infinity && supportsSteps(axis)) {
      const delta = stepDelta(axis, c.last, position);
      c.min = Math.min(c.min, delta);
      c.max = Math.max(c.max, delta);
      c.differences++;
    }
    c.last = position;
  });
  for (const entry of history.values()) entry.last = -Infinity;
  eachObservation(options, x, keys, (key, position) => {
    const c = history.get(key)!;
    if (position !== c.last && c.last !== -Infinity && supportsSteps(axis)) {
      const multiple = stepMultiple(stepDelta(axis, c.last, position), c.min);
      if (multiple === 1) c.matches++;
      if (!multiple) c.multiple = false;
    }
    c.last = position;
  });
  return history;
}

interface Calendar {
  first: number;
  last: number;
  qualifies: boolean;
  count: number;
  rows: number[];
}

function calendar(): Calendar {
  return { first: -Infinity, last: -Infinity, qualifies: true, count: 0, rows: [] };
}

function calendarPosition(state: Calendar, position: number): void {
  if (state.count === 0 && state.last === -Infinity) state.first = position;
  if (state.last !== -Infinity && state.last !== position) {
    const delta = dailyDelta(position - state.last);
    if (delta < DAY || delta % DAY || !sameDailyTime(state.first, position)) state.qualifies = false;
  }
  state.last = position;
}

function calendarFor(x: XData, table: Table): Calendar {
  const state = calendar();
  if (x.parser.kind !== 'time') return state;
  for (let i = 0, n = x.order?.length ?? x.positions.length; i < n; i++) {
    calendarPosition(state, x.positions[x.order?.[i] ?? i]!);
  }
  state.count = x.order?.length ?? x.positions.length;
  for (let row = 0; row < table.length && state.rows.length < 10; row++) {
    if (Number.isFinite(x.positions[row])) state.rows.push(table.rowIndex(row));
  }
  return state;
}

interface State {
  readonly axis: XColumn;
  readonly parser: XData['parser'];
  readonly buffers: FrameBuffers;
  readonly history: Map<string, Cadence>;
  readonly modes: ReadonlyMap<string, ValueMode>;
  readonly calendar: Calendar;
  readonly inferred: boolean;
  readonly diagnostics: DiagnosticCollector;
}

interface BatchSeries {
  readonly key: string;
  readonly value: ResolvedValueField;
  readonly values: Values;
  readonly rows: readonly number[];
  readonly cadence: Cadence;
  readonly gaps: Float64Array | null;
}

interface Batch {
  readonly positions: Float64Array;
  readonly axis: XColumn;
  readonly series: readonly BatchSeries[];
  readonly x: Float64Array;
  readonly observed: Uint8Array;
  readonly modes: State['modes'];
  readonly calendar: Calendar;
  readonly diagnostics: DiagnosticCollector;
}

function tail(
  positions: Float64Array, series: readonly BatchSeries[],
): { x: Float64Array; observed: Uint8Array } {
  const gapCount = series.reduce((sum, item) => sum + (item.gaps?.length ?? 0), 0);
  const distinct = new Float64Array(positions.length + gapCount);
  let length = 0;
  for (const position of positions) {
    if (Number.isFinite(position) && (!length || position !== distinct[length - 1])) distinct[length++] = position;
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
): BatchSeries | null {
  const previous = state.history.get(key) ?? cadence();
  const next = { ...previous };
  let last = previous.last;
  for (const row of rows) {
    const position = positions[row]!;
    if (position === last || !extend(next, axis, position)) return null;
    last = position;
  }
  const oldStep = step(previous);
  const newStep = step(next);
  if (oldStep !== newStep &&
    (oldStep > 0 && previous.matches < previous.differences ||
      newStep > 0 && stepMultiple(previous.max, newStep) > 1)) return null;

  let gapCount = 0;
  if (newStep) {
    last = previous.last;
    for (const row of rows) {
      const position = positions[row]!;
      if (last !== -Infinity) gapCount += stepMultiple(stepDelta(axis, last, position), newStep) - 1;
      last = position;
    }
  }
  const gaps = gapCount ? new Float64Array(gapCount) : null;
  if (gaps) {
    let index = 0;
    last = previous.last;
    for (const row of rows) {
      const position = positions[row]!;
      const multiple = last === -Infinity ? 0 : stepMultiple(stepDelta(axis, last, position), newStep);
      for (let j = 1; j < multiple; j++) {
        const gap = gapPosition(axis, last, position, newStep, j);
        if (gap <= lastX) return null;
        gaps[index++] = gap;
      }
      last = position;
    }
  }
  return { key, value: field, values, rows, cadence: next, gaps };
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
    this.current = state.buffers.frame(frame, state.axis, this.rows.source());
    this.latest = state.diagnostics.inputs();
    for (const diagnostic of this.latest) this.sink.add(diagnostic);
  }

  get frame(): AlignedFrame {
    return this.current;
  }

  get diagnostics(): readonly DiagnosticInput[] {
    return this.latest;
  }

  private build(table: Table, version: FrameVersion) {
    const options = { ...this.fields, table };
    const diagnostics = new DiagnosticCollector();
    const x = readX(this.type, this.fields.valid ? options : { ...options, table: rowsTable([]) },
      this.environment, diagnostics, this.state?.parser.categories ?? undefined);
    const frame = options.valid ? alignedFrame(options, x, diagnostics, version)
      : normalize(this.type, options, this.environment, diagnostics, version);
    reportCalendarDates(x, table, diagnostics);
    const axis = x.parser.column(new Float64Array(), true);
    const state: State = {
      axis, parser: x.parser, buffers: new FrameBuffers(frame, x.positions, x.order),
      history: options.valid ? cadences(options, table, x, frame.x) : new Map(),
      modes: new Map(options.values.map(value => [value.field, inspectValues(table, value.field)])),
      calendar: calendarFor(x, table),
      inferred: options.x.type !== null || inferKind(table, options.x.field, options.series) !== null,
      diagnostics,
    };
    return { frame, state, x };
  }

  private batch(table: Table, positions: Float64Array, axis: XColumn, lastX: number, diagnostics: DiagnosticCollector): Batch | null {
    const { state, fields } = this;
    const modes = new Map(state.modes);
    const values = new Map<string, Values>();
    for (const field of fields.values) {
      const before = modes.get(field.field) ?? 'empty';
      const added = inspectValues(table, field.field);
      if (before === 'decimal' && added === 'other') return null;
      const mode = before === 'other' || added === 'empty' ? before : added;
      modes.set(field.field, mode);
      values.set(field.field, readValues(table, field, diagnostics, true, this.rows.next, mode));
    }

    const memberships = new Map<string, number[]>();
    const seriesReports = fields.series === null ? null : new Reports(fields.series);
    const dates = { ...state.calendar, rows: [...state.calendar.rows] };
    const allRows: number[] = [];
    for (let i = 0; i < table.length; i++) {
      const position = positions[i]!;
      if (Number.isFinite(position)) {
        if (axis.kind === 'time') {
          calendarPosition(dates, position);
          dates.count++;
          if (dates.rows.length < 10) dates.rows.push(this.rows.next + i);
        }
        if (!seriesReports) allRows.push(i);
      }
      if (!seriesReports) continue;
      const raw = table.read(i, fields.series!);
      const key = nameOf(raw);
      if (key === null) {
        if (raw === undefined) seriesReports.add('AX102', 'omitted', this.rows.next + i);
        else seriesReports.add('AX107', 'omitted', this.rows.next + i, raw, 'Supply a name for the series in each row.');
        continue;
      }
      let indexes = memberships.get(key);
      if (!indexes) memberships.set(key, indexes = []);
      if (Number.isFinite(position)) indexes.push(i);
    }
    seriesReports?.flush(diagnostics);

    const series: BatchSeries[] = [];
    if (fields.series !== null) {
      for (const [key, rows] of memberships) {
        const value = fields.values[0]!;
        const item = extendSeries(key, value, values.get(value.field)!, rows, positions, state, axis, lastX);
        if (!item) return null;
        series.push(item);
      }
    } else {
      for (const field of fields.values) {
        const item = extendSeries(field.field, field, values.get(field.field)!, allRows, positions, state, axis, lastX);
        if (!item) return null;
        series.push(item);
      }
    }
    for (const item of series) reportGaps(diagnostics, fields.x.field, item.value.missing === 'zero', item.gaps);
    return { positions, axis, series, ...tail(positions, series), modes, calendar: dates, diagnostics };
  }

  private commitBatch(batch: Batch, rows: readonly unknown[], version: FrameVersion): void {
    const base = this.rows.next;
    this.rows.append(rows);
    for (let i = 0; i < batch.positions.length; i++) this.rows.record(batch.positions[i]!, base + i);

    const { buffers } = this.state;
    buffers.reserve(batch.x.length);
    const { end } = buffers;
    buffers.x.set(batch.x, end);
    buffers.observed.set(batch.observed, end);
    for (const observed of batch.observed) buffers.distinct += observed;
    const updates = new Map(batch.series.map(item => [item.key, item]));
    for (const item of batch.series) {
      if (!buffers.series.has(item.key)) {
        buffers.addSeries({
          ...seriesDescription(item.key, this.fields.series === null ? item.value.label : item.key, item.value),
          drawable: true,
        }, item.value.missing === 'zero');
      }
      this.state.history.set(item.key, item.cadence);
    }
    const length = batch.x.length;
    for (const [key, series] of buffers.series) {
      const item = updates.get(key);
      const zero = (item?.value ?? this.fields.values.find(field => field.field === series.description.field))?.missing === 'zero';
      let next = 0;
      let gap = 0;
      for (let i = 0; i < length; i++) {
        const position = batch.x[i]!;
        const row = item?.rows[next];
        const target = end + i;
        series.row[target] = -1;
        if (row !== undefined && batch.positions[row] === position) {
          const state = item!.values.slot[row]!;
          series.y[target] = item!.values.y[row]!;
          series.slot[target] = zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD) ? SLOT_VALUE : state;
          if (!(zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD))) series.row[target] = base + row;
          next++;
        } else {
          const missing = item?.gaps?.[gap] === position;
          if (missing) gap++;
          series.y[target] = zero ? 0 : NaN;
          series.slot[target] = zero ? SLOT_VALUE : missing ? SLOT_GAP : SLOT_NO_ROW;
        }
      }
    }
    buffers.end += length;
    const diagnostics = new DiagnosticCollector();
    for (const diagnostic of this.state.diagnostics.inputs()) {
      if (diagnostic.code !== 'AX111') diagnostics.add(diagnostic);
    }
    for (const diagnostic of batch.diagnostics.inputs()) diagnostics.add(diagnostic);
    const dates = batch.calendar;
    if (dates.qualifies && dates.first !== dates.last) {
      report(diagnostics, 'AX111', 'none', { field: this.fields.x.field, count: dates.count, rows: dates.rows });
    }
    this.state = { ...this.state, axis: batch.axis, modes: batch.modes, calendar: dates, diagnostics };
    this.current = { ...this.current, ...version };
  }

  append(rows: readonly unknown[], options: { keep?: number } = {}, sink = this.sink): AlignedFrame {
    const { parser, inferred } = this.state;
    const { x } = this.current;
    const categoryCount = parser.categories?.length ?? 0;
    const dateUnit = parser.dateUnit;
    const keep = options.keep === undefined || !Number.isFinite(options.keep) ? undefined : Math.max(0, Math.floor(options.keep));
    const version = { epoch: this.current.epoch, revision: this.current.revision + 1 };
    const lastX = x.values[x.values.length - 1] ?? -Infinity;
    const diagnostics = new DiagnosticCollector();
    const issues = new Reports(this.fields.x.field);
    const order = new Reports(this.fields.x.field);
    const table = rowsTable(rows);
    const positions = new Float64Array(rows.length);
    let needsUpdate = !this.fields.valid || (!inferred && inferKind(table, this.fields.x.field, this.fields.series) !== null);
    let highest = lastX;
    for (let i = 0; i < rows.length; i++) {
      const validSeries = this.fields.series === null || nameOf(table.read(i, this.fields.series)) !== null;
      const position = validSeries ? parser.read(table.read(i, this.fields.x.field), this.rows.next + i, issues) : NaN;
      positions[i] = position;
      if (!Number.isFinite(position)) continue;
      if (position < highest) order.add('AX151', 'none', this.rows.next + i);
      if (position < highest || position === lastX) needsUpdate = true;
      highest = Math.max(highest, position);
    }
    if (dateUnit !== parser.dateUnit && this.current.length) needsUpdate = true;
    issues.flush(diagnostics);
    const axis = categoryCount === (parser.categories?.length ?? 0)
      ? { ...this.state.axis, dateUnit: parser.kind === 'date' ? parser.dateUnit ?? 'day' : null }
      : parser.column(new Float64Array(), true);
    const batch = needsUpdate ? null : this.batch(table, positions, axis, lastX, diagnostics);
    const ordering = new DiagnosticCollector();
    order.flush(ordering);

    if (batch) {
      try {
        for (const diagnostic of batch.diagnostics.inputs()) sink.add(diagnostic);
      } catch (error) {
        parser.restore(categoryCount, dateUnit);
        throw error;
      }
      this.commitBatch(batch, rows, version);
    } else {
      parser.restore(categoryCount, dateUnit);
      const combined = this.rows.table(rows);
      const { frame, state, x: read } = this.build(combined, version);
      for (const diagnostic of ordering.inputs()) sink.add(diagnostic);
      for (const diagnostic of state.diagnostics.inputs()) sink.add(diagnostic);
      this.rows.append(rows);
      this.rows.resetPositions(combined, read.positions);
      this.state = state;
      this.current = frame;
    }

    const { buffers } = this.state;
    buffers.trim(keep, position => this.rows.evict(position));
    this.current = buffers.frame(this.current, this.state.axis, this.rows.source());
    this.latest = [...this.state.diagnostics.inputs(), ...ordering.inputs()];
    return this.current;
  }
}
