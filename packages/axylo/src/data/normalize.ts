import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticSink, type DonutFrame, type Environment, type Frame, type PointFrame,
  type RowSource, type Series, type XColumn,
} from '../core/contracts';
import { report, type DiagnosticDetails } from '../diagnostics';
import { MAX_DATE } from '../scale/zone';
import type { AlignedChartType, ChartType, ResolvedOptions, ResolvedValueField } from './options';
import { denseSeries, denseSlots, fullStatistics } from './series';
import { Reports } from './reports';
import { calendarIntervals, inferGaps, snapGap } from './steps';
import { DiagnosticHistory, type DiagnosticTrace, type Sample } from './diagnostic-history';
import type { Table } from './table';
import { readValues, type ValueCounts, type Values } from './values';
import { dateUnitOf, inferKind, nameOf, positionName, XParser, type DateUnit } from './x';

export { normalize } from './index';

export type DataEnvironment = Pick<Environment, 'timeZone'>;
export interface FrameVersion { readonly epoch: number; readonly revision: number }

function base(source: RowSource, version: FrameVersion) {
  return { epoch: version.epoch, revision: version.revision, source };
}

function sourceRows(table: Table): Int32Array {
  const rows = new Int32Array(table.length);
  for (let i = 0; i < rows.length; i++) rows[i] = table.rowIndex(i);
  return rows;
}

export interface XData<P extends XParser = XParser> {
  readonly parser: P;
  readonly positions: Float64Array;
  readonly order: Int32Array | null;
  readonly dateUnits: Record<DateUnit, number> | null;
  readonly ties?: boolean;
  readonly regular?: boolean;
}

// A typed prefix already proved finite and ordered is skipped. Both static data and a stream batch
// parse the remaining rows with the same provenance, calendar precision and borrowing rules.
export function scanPositions(parser: XParser, table: Table, options: Pick<ResolvedOptions, 'series' | 'values'>,
  sink: DiagnosticSink, dateUnits: XData['dateUnits'], positions: Float64Array, i = 0,
  highest = -Infinity, start = 0, scatter = false, late?: (row: number) => void, input?: ArrayLike<unknown>,
) {
  const reports = new Reports(parser.field.field, sink);
  const { series, values } = options;
  let ascending = true, ties = false, valid = i;
  for (; i < table.length; i++) {
    let position = NaN;
    if (series === null || nameOf(table.read(i, series)) !== null) {
      const raw = input === undefined ? table.read(i, parser.field.field) : input[i];
      if (!Number.isNaN(raw) || !table.isColumnRow(i)) {
        position = parser.read(raw, start + table.rowIndex(i), reports, values.length);
        if (dateUnits && Number.isFinite(position)) dateUnits[dateUnitOf(raw)]++;
      }
    }
    if (positions === input && !Object.is(input[i], position)) positions = positions.slice();
    if (positions !== input) positions[i] = position;
    if (!Number.isFinite(position)) continue;
    valid++;
    if (position > highest) highest = position;
    else if (scatter && position === highest) ties = true;
    else {
      ascending = false;
      if (position < highest) late?.(start + i);
    }
  }
  reports.flush(sink);
  return { positions, ascending, ties, valid };
}

export function readX(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, categories?: readonly string[]): XData;
export function readX<P extends XParser>(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink,
  categories: readonly string[] | undefined, Parser: new (...args: ConstructorParameters<typeof XParser>) => P): XData<P>;
export function readX(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink,
  categories?: readonly string[], Parser = XParser): XData {
  const { x, table } = options;
  const kind = x.type ?? inferKind(table, x.field, options.series) ?? (categories ? 'category' : 'number');
  const parser = new Parser(x, kind, env, type === 'scatter', categories);
  const dateUnits = kind === 'date' ? { day: 0, month: 0, year: 0 } : null;
  const input = table.columns?.[x.field];
  const target = input instanceof Float64Array && (kind === 'number' || kind === 'time')
    ? input : new Float64Array(table.length);
  let prefixTies = false;
  const scatter = type === 'scatter';
  let last = -Infinity;
  let i = 0;
  const epoch = x.type === 'time';
  if (options.series === null && input instanceof Float64Array && (kind === 'number' || epoch)) {
    // XParser owns AX109 and invalid instants. Hand it the first exceptional row and the whole suffix.
    const limit = epoch ? MAX_DATE : Number.MAX_VALUE;
    const hintStart = epoch ? 1e9 : x.type === null ? 1e11 : Infinity;
    const hintEnd = epoch ? 1e10 : 1e14;
    const first = input[0]!, end = input[input.length - 1]!;
    const step = input[1]! - first;
    // A positive finite constant delta proves ordering. Bounds then exclude invalid instants
    // and the two signed AX109 hint intervals for every interior position.
    if (input.length === table.length && step > 0 && Number.isFinite(step) && first >= -limit && end <= limit &&
      (end <= -hintEnd || first > -hintStart) && (end < hintStart || first >= hintEnd) &&
      sameStep(input)) {
      return { parser, positions: target, order: null, dateUnits, regular: true };
    }
    for (; i < table.length; i++) {
      const value = input[i]!;
      const abs = Math.abs(value);
      if (!(abs <= limit) || abs >= hintStart && abs < hintEnd) break;
      if (!(value > last)) {
        if (!scatter || value !== last) break;
        prefixTies = true;
      }
      last = value;
    }
  }
  const { positions, ascending, ties, valid } = scanPositions(parser, table, options, sink, dateUnits, target, i, last, 0, scatter, undefined, input);
  if (ascending && valid === table.length) return { parser, positions, order: null, dateUnits, ties: prefixTies || ties };

  const order = new Int32Array(valid);
  let next = 0;
  for (let i = 0; i < positions.length; i++) if (Number.isFinite(positions[i])) order[next++] = i;
  if (!ascending) order.sort((a, b) => positions[a]! - positions[b]!);
  return { parser, positions, order, dateUnits };
}

export function reportCalendarDates(x: XData, table: Table, sink: DiagnosticSink): void {
  if (x.parser.kind !== 'time') return;
  const { positions, order } = x;
  const length = order?.length ?? positions.length;
  if (length < 2) return;
  const first = positions[order?.[0] ?? 0]!;
  let last = first;
  const zone = x.parser.timeZone ?? 'UTC';
  let matches = 3;
  // For a constant UTC delta one pair stands for the entire (already validated) column.
  const stop = x.regular && order === null && zone === 'UTC' ? 2 : length;
  for (let i = 1; i < stop; i++) {
    const position = positions[order?.[i] ?? i]!;
    if (position === last) continue;
    matches &= calendarIntervals(last, position, zone);
    if (!matches) return;
    last = position;
  }
  if (last === first) return;
  const rows: number[] = [];
  for (let i = 0; i < positions.length && rows.length < 10; i++) {
    if (Number.isFinite(positions[i])) rows.push(table.rowIndex(i));
  }
  report(sink, 'AX111', 'none', { field: x.parser.field.field, count: length, rows });
}

export function reportMissingName(reports: Reports, row: number, raw: unknown, slice = false): void {
  if (raw === undefined) {
    reports.add('AX102', 'omitted', row, undefined, undefined, {
      outcome: slice ? 'The affected slice is not drawn.' : 'The affected row is not drawn.',
    });
  } else {
    reports.add('AX107', 'omitted', row, raw, slice ? 'Supply a label for each donut value.' : 'Supply a name for the series in each row.');
  }
}

interface Group {
  readonly key: string;
  readonly label: string;
  readonly value: ResolvedValueField;
  order: Int32Array | null;
  gaps: Float64Array | null;
  drawable: boolean;
  sparse?: number;
}

function groupOf(key: string, label: string, value: ResolvedValueField, order: Int32Array | null): Group {
  return { key, label, value, order, gaps: null, drawable: true };
}

export function seriesGroups(options: Pick<ResolvedOptions, 'values' | 'series'>, table: Table, positions: Float64Array,
  order: Int32Array | null, sink: DiagnosticSink, start?: number): Group[] {
  const { series } = options;
  if (series === null) return options.values.map(value => groupOf(value.field, value.label, value, order));

  const indexes = new Map<string, number>();
  const counts: number[] = [];
  // Group zero is implicit. A second group or an unplaced row is the first reason to store memberships.
  let membership: Int32Array | undefined;
  const reports = new Reports(series, sink);
  for (let i = 0; i < table.length; i++) {
    const raw = table.read(i, series);
    const name = nameOf(raw);
    let index = -1;
    if (name === null) {
      if (!Number.isNaN(raw) || !table.isColumnRow(i)) reportMissingName(reports, (start ?? 0) + table.rowIndex(i), raw);
    } else if (Number.isFinite(positions[i])) {
      index = indexes.get(name) ?? indexes.size;
      if (index === counts.length) {
        indexes.set(name, index);
        counts.push(0);
      }
      counts[index]!++;
    }
    if (index !== 0) (membership ??= new Int32Array(table.length))[i] = index;
  }
  reports.flush(sink);
  const value = options.values[0]!;
  if (!membership && start !== undefined) return Array.from(indexes.keys(), name => groupOf(name, name, value, order));
  const orders = counts.map(count => new Int32Array(count));
  counts.fill(0);
  for (let i = 0, n = order?.length ?? table.length; i < n; i++) {
    const row = order?.[i] ?? i;
    const index = membership?.[row] ?? 0;
    if (index >= 0) orders[index]![counts[index]!++] = row;
  }
  return Array.from(indexes, ([key, index]) => groupOf(key, key, value, orders[index]!));
}

function sameStep(positions: Float64Array): boolean {
  if (positions.length < 3) return true;
  let previous = positions[1]!;
  const step = previous - positions[0]!;
  for (let i = 2; i < positions.length; i++) {
    const current = positions[i]!;
    if (current - previous !== step) return false;
    previous = current;
  }
  return true;
}

function alignGroup(group: Group, x: XData, axis: XColumn, field: string, table: Table, sink: DiagnosticSink, grid?: Group): void {
  const { positions } = x;
  let order = group.order;
  if (order) {
    const duplicates = new Reports(field, sink);
    let distinct = 0;
    let kept = order;
    let previous = -Infinity;
    for (let i = 0; i < order.length; i++) {
      const row = order[i]!;
      const position = positions[row]!;
      if (position === previous) {
        duplicates.add('AX108', 'series-disabled', table.rowIndex(row), undefined, undefined, {
          series: group.label, position: positionName(axis, position),
        });
        if (group.drawable) kept = order.slice();
        group.drawable = false;
      } else {
        kept[distinct++] = row;
        previous = position;
      }
    }
    duplicates.flush(sink);
    group.order = order = kept.subarray(0, distinct);
  }
  if (grid) {
    group.gaps = grid.gaps;
    group.sparse = grid.sparse;
    return;
  }
  // Category axes have no inferred steps. Numeric, instant and wall-clock steps depend only on deltas.
  if (!order && (axis.kind === 'category' || axis.kind !== 'date' && sameStep(positions))) return;
  group.gaps = inferGaps(axis, order?.length ?? positions.length, i => positions[order?.[i] ?? i]!,
    (gap, a, b, step) => snapGap(gap, a, b, step, x.order?.length ?? positions.length, i => positions[x.order?.[i] ?? i]!),
    count => { group.sparse = count; });
}

function distinctPositions(sorted: Float64Array): Float64Array {
  let length = 0;
  for (const position of sorted) {
    if (!length || position !== sorted[length - 1]) sorted[length++] = position;
  }
  return sorted.subarray(0, length);
}

/** Wide series share one inferred grid. Long series can each contribute different gaps. */
export function mergeGaps(observed: Float64Array, groups: readonly { gaps: Float64Array | null }[], shared = false): Float64Array {
  const count = shared ? Math.min(1, groups.length) : groups.length;
  let length = observed.length;
  for (let i = 0; i < count; i++) length += groups[i]!.gaps?.length ?? 0;
  if (length === observed.length) return observed;
  const positions = new Float64Array(length);
  positions.set(observed);
  let next = observed.length;
  for (let i = 0; i < count; i++) {
    const gaps = groups[i]!.gaps;
    if (gaps) {
      positions.set(gaps, next);
      next += gaps.length;
    }
  }
  return distinctPositions(positions.sort());
}

export function seriesDescription(key: string, label: string, value: ResolvedValueField) {
  return { key, label, field: value.field, unit: value.unit, valueScale: value.scale };
}

export function reportGaps(
  sink: DiagnosticSink, field: string, changed: boolean, gaps: Float64Array | null,
  axis?: XColumn, name?: string, sparse?: number, seriesKey?: string,
): void {
  if (!gaps?.length && !sparse) return;
  const details: DiagnosticDetails = {
    field, count: sparse ?? gaps?.length, series: name === undefined ? undefined : [name],
    sparseSeries: sparse && name !== undefined ? [name] : undefined,
    examples: gaps ? Array.from(gaps.subarray(0, 10), position => axis ? positionName(axis, position) : String(position)) : undefined,
    zeroSeries: changed && !sparse ? name === undefined ? [] : [name] : undefined,
  };
  const trace = sink as DiagnosticTrace;
  if (sparse && trace.traceSparseGaps) {
    trace.traceSparseGaps(details, seriesKey);
    return;
  }
  if (gaps) trace.traceGaps?.(field, 'none', gaps, details, axis);
  report(sink, 'AX105', 'none', details);
}

/** From this many slots, a series whose every slot is SLOT_VALUE makes its state column only when read. */
const LAZY_SLOTS = 4096;

function isImputable(state: number): boolean {
  return state === SLOT_NULL || state === SLOT_ABSENT_FIELD;
}

function alignedSeries(group: Group, axis: XColumn, x: XData, table: Table, values: Values): Series {
  const { order, gaps, drawable, value } = group;
  const zero = value.missing === 'zero';
  const description = seriesDescription(group.key, group.label, value);

  if (order === null && axis.values === x.positions) {
    let row = table.columns ? null : sourceRows(table);
    let slot = values.slot;
    if (zero && slot) {
      for (let i = 0; i < slot.length; i++) {
        if (!isImputable(slot[i]!)) continue;
        row ??= sourceRows(table);
        row[i] = -1;
        slot[i] = SLOT_VALUE;
      }
    }
    if (!slot && values.y.length < LAZY_SLOTS) {
      // A few kilobytes at most: an ordinary column keeps the series a plain data object.
      slot = new Uint8Array(values.y.length);
      denseSlots.set(slot, 'fresh');
    }
    const series = slot ? { ...description, drawable, y: values.y, slot, row }
      : denseSeries({ ...description, drawable, y: values.y, row });
    if (values.statistics) fullStatistics.set(series, values.statistics);
    return series;
  }
  const length = axis.values.length;
  const slot = new Uint8Array(length);
  const row = new Int32Array(length);
  const y = new Float64Array(length);
  projectSeries({ y, slot, row }, 0, axis.values, x.positions, order, order?.length ?? table.length, values, gaps, zero, table);
  return { ...description, drawable, y, slot, row };
}

interface Projection {
  readonly y: Float64Array;
  slot: Uint8Array | null;
  row: Int32Array | null;
}

// Both an aligned frame and its incremental tail join sorted observations and gaps onto the same x grid.
// Stream columns that are implicit need a writer only when a slot first stops being the identity.
export function projectSeries<T extends Projection>(
  output: T, start: number, axis: Float64Array, positions: Float64Array, rows: ArrayLike<number> | null,
  length: number, values: Values | undefined, gaps: Float64Array | null | undefined, zero: boolean,
  source: Table | number, observed = 0, implicit?: {
    setRow(series: T, target: number, row: number): void;
  }, setSlot?: (series: T, target: number, state: number) => void,
): void {
  let gap = 0;
  for (let i = 0; i < axis.length; i++) {
    const target = start + i;
    const position = axis[i]!;
    const row = rows?.[observed] ?? observed;
    let state: number, value: number, provenance = -1;
    if (observed < length && positions[row] === position) {
      state = values!.slot?.[row] ?? SLOT_VALUE;
      value = values!.y[row]!;
      if (zero && isImputable(state)) state = SLOT_VALUE;
      else provenance = typeof source === 'number' ? source + row : source.rowIndex(row);
      observed++;
    } else {
      const expected = gaps?.[gap] === position;
      if (expected) gap++;
      state = zero ? SLOT_VALUE : expected ? SLOT_GAP : SLOT_NO_ROW;
      value = zero ? 0 : NaN;
    }
    output.y[target] = value;
    if (output.row) output.row[target] = provenance;
    else implicit!.setRow(output, target, provenance);
    if (output.slot) output.slot[target] = state;
    else if (state !== SLOT_VALUE) setSlot!(output, target, state);
  }
}

const maxAlignedSlots = 20_000_000;

export function alignmentFits(series: number, positions: number, sink: DiagnosticSink): boolean {
  if (series * positions <= maxAlignedSlots) return true;
  report(sink, 'AX134', 'chart-error', {
    count: 1, detail: 'The aligned frame has ' + series + ' series and ' + positions + ' x positions, exceeding 20,000,000 slots.',
  });
  return false;
}

export function alignedFrame(
  options: ResolvedOptions, x: XData, sink: DiagnosticSink, version: FrameVersion, counts?: Map<string, ValueCounts>,
): AlignedFrame {
  const axis = x.parser.column(x.positions);
  const { table } = options;
  const { epoch, revision } = version;
  const xLabel = options.x.label, yLabel = options.values.length === 1 ? options.values[0]!.label : null;
  const frame = (x: XColumn, series: Series[]): AlignedFrame => ({
    epoch, revision, source: table, shape: 'aligned', xLabel, yLabel, x, length: x.values.length, series,
  });
  const empty = () => frame({ ...axis, values: new Float64Array(), categories: axis.categories && [] }, []);
  let observed = x.positions;
  if (x.order) {
    const sorted = new Float64Array(x.order.length);
    for (let i = 0; i < sorted.length; i++) sorted[i] = x.positions[x.order[i]!]!;
    observed = distinctPositions(sorted);
  }
  const aligned = seriesGroups(options, table, x.positions, x.order, sink);
  if (!alignmentFits(aligned.length, observed.length, sink)) return empty();
  let positions = observed;
  // readX certifies strictly increasing regular numeric or time positions only for wide input.
  if (!x.regular) {
    const wide = options.series === null;
    for (let i = 0; i < aligned.length; i++) {
      alignGroup(aligned[i]!, x, axis, options.x.field, table, sink, wide && i > 0 ? aligned[0] : undefined);
    }
    positions = mergeGaps(observed, aligned, wide);
    if (positions !== observed && !alignmentFits(aligned.length, positions.length, sink)) return empty();
  }
  const column = positions === axis.values ? axis : { ...axis, values: positions };
  const included = x.order === null ? undefined : (row: number) => Number.isFinite(x.positions[row]);
  const shared = options.series === null ? undefined : readValues(table, options.values[0]!, sink, true, 0, undefined, included);
  const series = aligned.map(group => {
    const { value } = group;
    const count = counts ? { decimal: 0, other: 0 } : undefined;
    const values = shared ?? readValues(table, value, sink, true, 0, undefined, included, undefined, count);
    if (count) counts!.set(value.field, count);
    return alignedSeries(group, column, x, table, values);
  });
  if (!x.regular) for (const group of aligned) {
    reportGaps(sink, options.x.field, group.value.missing === 'zero', group.gaps, axis, group.label, group.sparse, group.key);
  }
  return frame(column, series);
}

function orderedTies(x: Float64Array, y: Values['y']): boolean {
  for (let i = 1; i < x.length; i++) {
    if (x[i] === x[i - 1] && y[i]! < y[i - 1]!) return false;
  }
  return true;
}

function sortTies(rows: Int32Array, x: Float64Array, y: Values['y']): void {
  const compare = (a: number, b: number) => y[a]! - y[b]!;
  for (let start = 0; start < rows.length;) {
    const position = x[rows[start]!]!;
    let descending = false;
    let end = start + 1;
    for (; end < rows.length && x[rows[end]!] === position; end++) {
      descending ||= y[rows[end]!]! < y[rows[end - 1]!]!;
    }
    if (descending) rows.subarray(start, end).sort(compare);
    start = end;
  }
}

export function pointFrame(options: ResolvedOptions, x: XData, sink: DiagnosticSink, version: FrameVersion): PointFrame {
  const { table } = options;
  const value = options.values[0]!;
  const included = x.order === null ? undefined : (row: number) => Number.isFinite(x.positions[row]);
  const members = seriesGroups(options, table, x.positions, x.order, sink);
  const values = readValues(table, value, sink, true, 0, undefined, included, 'The affected points are not drawn.', undefined, false);
  let allValid = values.allValid;
  const slots = values.slot;
  if (value.missing === 'zero' && !allValid && slots) {
    allValid = !included;
    for (let row = 0; row < slots.length; row++) {
      const state = slots[row]!;
      if (isImputable(state)) slots[row] = SLOT_VALUE;
      else if (state !== SLOT_VALUE) allValid = false;
    }
  }
  const series = members.map(group => {
    const length = group.order?.length ?? x.positions.length;
    if (!group.order && allValid && (!x.ties || orderedTies(x.positions, values.y))) {
      return {
        key: group.key, label: group.label, drawable: true, x: x.positions,
        y: values.y instanceof Float64Array ? values.y : new Float64Array(values.y),
        row: table.columns ? null : sourceRows(table),
      };
    }
    const rows = new Int32Array(length);
    let next = 0;
    let missingStart = length;
    for (let i = 0; i < length; i++) {
      const row = group.order?.[i] ?? i;
      if (allValid || !slots || slots[row] === SLOT_VALUE) rows[next++] = row;
      else rows[--missingStart] = row;
    }
    // The reader still needs each valid x when a diagnostic kept its y out of the plot.
    // Their source rows too, so a re-encode can read them again (another field may have a value there).
    const missing = length - missingStart;
    const missingX = missing ? new Float64Array(missing) : undefined;
    const missingRow = missing ? new Int32Array(missing) : undefined;
    for (let i = 0; i < missing; i++) {
      const row = rows[length - 1 - i]!;
      missingX![i] = x.positions[row]!;
      missingRow![i] = table.rowIndex(row);
    }
    const kept = rows.subarray(0, next);
    if (group.order || x.ties) sortTies(kept, x.positions, values.y);
    const xs = new Float64Array(next), ys = new Float64Array(next), provenance = new Int32Array(next);
    for (let i = 0; i < next; i++) {
      const row = kept[i]!;
      xs[i] = x.positions[row]!;
      ys[i] = values.y[row]!;
      provenance[i] = table.rowIndex(row);
    }
    return {
      key: group.key, label: group.label, drawable: true, missingX, missingRow,
      x: xs, y: ys, row: provenance,
    };
  });

  return {
    ...base(options.table, version), shape: 'points', xKind: x.parser.kind === 'category' ? 'number' : x.parser.kind,
    timeZone: x.parser.timeZone, series, xLabel: options.x.label, yLabel: value.label, xUnit: options.x.unit, yUnit: value.unit,
  };
}

function donutFrame(options: ResolvedOptions, sink: DiagnosticSink, version: FrameVersion,
  index?: { positions: Float64Array; order: Int32Array | null }): DonutFrame {
  const { table, x } = options;
  const field = options.values[0]!;
  const labels: string[] = [];
  const seen = index ? null : new Set<string>();
  const ordinals = index ? new Map<string, number>() : null;
  let repeated = false;
  const issues = new Reports(x.field, sink);
  const negatives = new Reports(field.field, sink);
  const rows = new Int32Array(table.length);
  const included = index ? null : new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) {
    const raw = table.read(i, x.field);
    const name = nameOf(raw);
    if (name === null) {
      if (Number.isNaN(raw) && table.isColumnRow(i)) continue;
      reportMissingName(issues, table.rowIndex(i), raw, true);
    } else {
      if (ordinals ? ordinals.has(name) : seen!.has(name)) {
        repeated = true;
        issues.add('AX108', 'chart-error', table.rowIndex(i), name);
      }
      if (index) {
        const position = ordinals!.get(name) ?? ordinals!.size;
        ordinals!.set(name, position);
        index.positions[i] = position;
      } else {
        seen!.add(name);
        included![i] = 1;
      }
      rows[labels.length] = i;
      labels.push(name);
    }
  }
  issues.flush(sink);
  const order = rows.subarray(0, labels.length);
  const values = readValues(table, field, sink, true, 0, undefined, i => included ? included[i] === 1 : Number.isFinite(index!.positions[i]));
  // The donut frame always carries its own state column; it is one byte per category.
  const slots = values.slot ?? new Uint8Array(table.length);
  const provenance = table.columns && order.length === table.length && field.missing !== 'zero'
    ? null : Int32Array.from(order, table.rowIndex);
  for (let i = 0; i < order.length; i++) {
    const row = order[i]!;
    const value = values.y[row]!;
    if (value < 0) negatives.add('AX120', 'chart-error', table.rowIndex(row), value);
    if (field.missing === 'zero' && isImputable(slots[row]!)) {
      slots[row] = SLOT_VALUE;
      provenance![i] = -1;
    }
  }
  negatives.flush(sink);
  const allRows = order.length === table.length;
  const frame: DonutFrame = {
    ...base(table, version), shape: 'donut', labels,
    values: allRows && values.y instanceof Float64Array ? values.y : Float64Array.from(order, row => values.y[row]!),
    slot: allRows ? slots : Uint8Array.from(order, row => slots[row]!),
    row: provenance,
    valueLabel: field.label, unit: field.unit, valueScale: field.scale,
  };
  if (index) {
    // The source order is already category order until a label occurs a second time.
    index.order = repeated ? order.sort((a, b) => index.positions[a]! - index.positions[b]!) : order;
  }
  return frame;
}

interface AlignedSeed {
  readonly options: ResolvedOptions;
  readonly type: AlignedChartType;
  readonly x: XData;
  readonly counts: Map<string, ValueCounts>;
  readonly diagnostics: DiagnosticHistory;
}

const alignedSeeds = new WeakMap<AlignedFrame, AlignedSeed>();

export function alignedSeed(frame: AlignedFrame): AlignedSeed | undefined {
  return alignedSeeds.get(frame);
}

/** Options whose data could not be read normalize as no rows. */
function usable(options: ResolvedOptions): ResolvedOptions {
  return options.valid ? options : { ...options, table: { ...options.table, columns: null, length: 0 } };
}

// One entry per frame shape, so a chart kind's composition reaches only its own (normalize above is the
// dispatch for callers that hold the chart type as a value, such as validate()).

export function normalizeDonut(options: ResolvedOptions, _env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): DonutFrame {
  return donutFrame(usable(options), sink, version);
}

export function buildPoints(options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion) {
  const valid = usable(options);
  const x = readX('scatter', valid, env, sink);
  reportCalendarDates(x, valid.table, sink);
  return { frame: pointFrame(valid, x, sink, version), positions: x.positions, order: x.order };
}

export function buildDonut(options: ResolvedOptions, _env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion) {
  const valid = usable(options);
  const index = { positions: new Float64Array(valid.table.length).fill(NaN), order: null as Int32Array | null };
  return { frame: donutFrame(valid, sink, version, index), ...index };
}

export function normalizePoints(options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): PointFrame {
  return buildPoints(options, env, sink, version).frame;
}

export function normalizeAligned(type: AlignedChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): AlignedFrame {
  const valid = usable(options);
  const diagnostics = options.valid && options.series === null ? new DiagnosticHistory<Map<number, Sample>>(Map, sink) : null;
  const observe = diagnostics ?? sink;
  const x = readX(type, valid, env, observe);
  reportCalendarDates(x, valid.table, sink);
  // Ascending wide axes can initialize the streaming indexes from normalized positions.
  const counts = diagnostics && x.order === null ? new Map<string, ValueCounts>() : undefined;
  const frame = alignedFrame(valid, x, observe, version, counts);
  if (counts && diagnostics && frame.series.length === options.values.length) {
    diagnostics.sink = undefined;
    alignedSeeds.set(frame, { options, type, x, counts, diagnostics });
  }
  return frame;
}
