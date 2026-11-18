import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticSink, type DonutFrame, type Environment, type Frame, type PointFrame,
  type RowSource, type Series, type XColumn,
} from '../core/contracts';
import { report } from '../diagnostics';
import type { AlignedChartType, ChartType, ResolvedOptions, ResolvedValueField } from './options';
import { Reports } from './reports';
import { inferGaps } from './steps';
import type { Table } from './table';
import { readValues, type Values } from './values';
import { dailyDelta, DAY, inferKind, nameOf, sameDailyTime, XParser } from './x';

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

export interface XData {
  readonly parser: XParser;
  readonly positions: Float64Array;
  readonly order: Int32Array | null;
}

export function readX(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, categories?: readonly string[]): XData {
  const { x, table } = options;
  const kind = x.type ?? (categories ? 'category' : inferKind(table, x.field, options.series) ?? 'number');
  const parser = new XParser(x, kind, env, type === 'scatter', categories);
  const reports = new Reports(x.field);
  const input = table.columns?.[x.field];
  let positions = input instanceof Float64Array && (kind === 'number' || kind === 'time')
    ? input : new Float64Array(table.length);
  let ascending = true;
  let last = -Infinity;
  let valid = 0;
  for (let i = 0; i < table.length; i++) {
    const usableSeries = options.series === null || nameOf(table.read(i, options.series)) !== null;
    const value = usableSeries
      ? parser.read(input === undefined ? table.read(i, x.field) : input[i], table.rowIndex(i), reports)
      : NaN;
    if (positions === input && !Object.is(positions[i], value)) positions = positions.slice();
    if (positions !== input) positions[i] = value;
    if (!Number.isFinite(value)) {
      ascending = false;
      continue;
    }
    if (!(value > last)) ascending = false;
    last = value;
    valid++;
  }
  reports.flush(sink);
  if (ascending) return { parser, positions, order: null };

  const order = new Int32Array(valid);
  let next = 0;
  for (let i = 0; i < positions.length; i++) if (Number.isFinite(positions[i])) order[next++] = i;
  order.sort((a, b) => positions[a]! - positions[b]!);
  return { parser, positions, order };
}

export function reportCalendarDates(x: XData, table: Table, sink: DiagnosticSink): void {
  if (x.parser.kind !== 'time') return;
  const length = x.order?.length ?? x.positions.length;
  if (length < 2) return;
  const first = x.positions[x.order?.[0] ?? 0]!;
  let last = first;
  for (let i = 1; i < length; i++) {
    const position = x.positions[x.order?.[i] ?? i]!;
    if (position === last) continue;
    const delta = dailyDelta(position - last);
    if (delta < DAY || delta % DAY || !sameDailyTime(first, position)) return;
    last = position;
  }
  if (last === first) return;
  const rows: number[] = [];
  for (let i = 0; i < x.positions.length && rows.length < 10; i++) {
    if (Number.isFinite(x.positions[i])) rows.push(table.rowIndex(i));
  }
  report(sink, 'AX111', 'none', { field: x.parser.field.field, count: length, rows });
}

interface Group {
  readonly key: string;
  readonly label: string;
  readonly value: ResolvedValueField;
  readonly values: Values;
  readonly order: Int32Array | null;
}

function groups(options: ResolvedOptions, x: XData, sink: DiagnosticSink, impute: boolean): Group[] {
  const { table, series } = options;
  if (series === null) {
    return options.values.map(value => ({
      key: value.field, label: value.label, value, values: readValues(table, value, sink, impute), order: x.order,
    }));
  }

  const indexes = new Map<string, number>();
  const counts: number[] = [];
  const membership = new Int32Array(table.length).fill(-1);
  const reports = new Reports(series);
  for (let i = 0; i < table.length; i++) {
    const raw = table.read(i, series);
    const name = nameOf(raw);
    if (name === null) {
      if (raw === undefined) reports.add('AX102', 'omitted', table.rowIndex(i));
      else reports.add('AX107', 'omitted', table.rowIndex(i), raw, 'Supply a name for the series in each row.');
      continue;
    }
    let index = indexes.get(name);
    if (index === undefined) {
      index = indexes.size;
      indexes.set(name, index);
      counts.push(0);
    }
    if (!Number.isFinite(x.positions[i])) continue;
    membership[i] = index;
    counts[index] = counts[index]! + 1;
  }
  reports.flush(sink);

  const orders = counts.map(count => new Int32Array(count));
  counts.fill(0);
  for (let i = 0, n = x.order?.length ?? table.length; i < n; i++) {
    const row = x.order?.[i] ?? i;
    const index = membership[row]!;
    if (index < 0) continue;
    orders[index]![counts[index]!] = row;
    counts[index] = counts[index]! + 1;
  }
  const value = options.values[0]!;
  const values = readValues(table, value, sink, impute);
  return Array.from(indexes, ([key, index]) => ({ key, label: key, value, values, order: orders[index]! }));
}

interface AlignedGroup {
  readonly group: Group;
  readonly order: Int32Array | null;
  readonly gaps: Float64Array | null;
  readonly drawable: boolean;
}

function alignGroup(group: Group, positions: Float64Array, axis: XColumn, field: string, table: Table, sink: DiagnosticSink): AlignedGroup {
  let order = group.order;
  let drawable = true;
  if (order) {
    const duplicates = new Reports(field);
    let distinct = 0;
    let kept = order;
    let previous = -Infinity;
    for (let i = 0; i < order.length; i++) {
      const row = order[i]!;
      const position = positions[row]!;
      if (position === previous) {
        duplicates.add('AX108', 'series-disabled', table.rowIndex(row), group.key);
        if (drawable) kept = order.slice();
        drawable = false;
      } else {
        kept[distinct++] = row;
        previous = position;
      }
    }
    duplicates.flush(sink);
    order = kept.subarray(0, distinct);
  }
  const gaps = inferGaps(axis, order?.length ?? positions.length, i => positions[order?.[i] ?? i]!);
  return { group, order, gaps, drawable };
}

function combinePositions(x: XData, groups: readonly AlignedGroup[]): Float64Array {
  const gapCount = groups.reduce((n, group) => n + (group.gaps?.length ?? 0), 0);
  if (x.order === null && gapCount === 0) return x.positions;
  const observed = x.order?.length ?? x.positions.length;
  const positions = new Float64Array(observed + gapCount);
  if (x.order) {
    for (let i = 0; i < observed; i++) positions[i] = x.positions[x.order[i]!]!;
  } else {
    positions.set(x.positions);
  }
  let next = observed;
  for (const { gaps } of groups) {
    if (!gaps) continue;
    positions.set(gaps, next);
    next += gaps.length;
  }
  if (gapCount) positions.sort();
  let distinct = 0;
  let last = -Infinity;
  for (let i = 0; i < positions.length; i++) {
    const position = positions[i]!;
    if (position > last) {
      positions[distinct++] = position;
      last = position;
    }
  }
  return positions.subarray(0, distinct);
}

export function seriesDescription(key: string, label: string, value: ResolvedValueField) {
  return { key, label, field: value.field, unit: value.unit, valueScale: value.scale };
}

export function reportGaps(
  sink: DiagnosticSink, field: string, changed: boolean, gaps: Float64Array | null,
): void {
  if (!gaps?.length) return;
  report(sink, 'AX105', changed ? 'changed' : 'none', {
    field, count: gaps.length, examples: Array.from(gaps.subarray(0, 10), String),
  });
}

function alignedSeries(aligned: AlignedGroup, axis: XColumn, x: XData, table: Table, sink: DiagnosticSink): Series {
  const { group, order, gaps, drawable } = aligned;
  const { values, value } = group;
  const zero = value.missing === 'zero';
  const description = seriesDescription(group.key, group.label, value);
  reportGaps(sink, x.parser.field.field, zero, gaps);

  if (order === null && axis.values === x.positions) {
    let row = table.columns ? null : sourceRows(table);
    if (zero) {
      for (let i = 0; i < values.slot.length; i++) {
        if (values.slot[i] !== SLOT_NULL && values.slot[i] !== SLOT_ABSENT_FIELD) continue;
        row ??= sourceRows(table);
        row[i] = -1;
        values.slot[i] = SLOT_VALUE;
      }
    }
    return { ...description, drawable, y: values.y, slot: values.slot, row };
  }
  const length = axis.values.length;
  const slot = new Uint8Array(length);
  const row = new Int32Array(length).fill(-1);
  const y = new Float64Array(length);
  const observations = order?.length ?? table.length;
  let observed = 0;
  let gap = 0;
  for (let i = 0; i < length; i++) {
    const position = axis.values[i]!;
    const source = order?.[observed] ?? observed;
    if (observed < observations && x.positions[source] === position) {
      const state = values.slot[source]!;
      if (zero && (state === SLOT_NULL || state === SLOT_ABSENT_FIELD)) {
        y[i] = 0;
      } else {
        slot[i] = state;
        row[i] = table.rowIndex(source);
        y[i] = values.y[source]!;
      }
      observed++;
    } else {
      const state = gaps?.[gap] === position ? SLOT_GAP : SLOT_NO_ROW;
      if (state === SLOT_GAP) gap++;
      if (!zero) slot[i] = state;
      y[i] = zero ? 0 : NaN;
    }
  }
  return { ...description, drawable, y, slot, row };
}

export function alignedFrame(options: ResolvedOptions, x: XData, sink: DiagnosticSink, version: FrameVersion): AlignedFrame {
  const axis = x.parser.column(x.positions);
  const aligned = groups(options, x, sink, true).map(group => alignGroup(group, x.positions, axis, options.x.field, options.table, sink));
  const positions = combinePositions(x, aligned);
  const column = { ...axis, values: positions };
  return {
    ...base(options.table, version), shape: 'aligned', x: column, length: positions.length,
    series: aligned.map(group => alignedSeries(group, column, x, options.table, sink)),
    xLabel: options.x.label, yLabel: options.values.length === 1 ? options.values[0]!.label : null,
  };
}

function pointFrame(options: ResolvedOptions, x: XData, sink: DiagnosticSink, version: FrameVersion): PointFrame {
  const { table } = options;
  const value = options.values[0]!;
  const series = groups(options, x, sink, false).map(group => {
    const length = group.order?.length ?? x.positions.length;
    const rows = new Int32Array(length);
    let next = 0;
    let previous = -Infinity;
    const duplicates = new Reports(options.x.field);
    let drawable = true;
    for (let i = 0; i < length; i++) {
      const row = group.order?.[i] ?? i;
      const position = x.positions[row]!;
      if (position === previous) {
        duplicates.add('AX108', 'series-disabled', table.rowIndex(row), group.key);
        drawable = false;
      }
      previous = position;
      if (group.values.slot[row] === SLOT_VALUE) rows[next++] = row;
    }
    duplicates.flush(sink);
    const kept = rows.subarray(0, next);
    kept.sort((a, b) => x.positions[a]! - x.positions[b]! || group.values.y[a]! - group.values.y[b]!);
    return {
      key: group.key, label: group.label, drawable,
      x: Float64Array.from(kept, row => x.positions[row]!), y: Float64Array.from(kept, row => group.values.y[row]!), row: Int32Array.from(kept, table.rowIndex),
    };
  });

  return {
    ...base(options.table, version), shape: 'points', xKind: x.parser.kind === 'category' ? 'number' : x.parser.kind,
    timeZone: x.parser.timeZone, series, xLabel: options.x.label, yLabel: value.label, xUnit: options.x.unit, yUnit: value.unit,
  };
}

function donutFrame(options: ResolvedOptions, sink: DiagnosticSink, version: FrameVersion): DonutFrame {
  const { table, x } = options;
  const field = options.values[0]!;
  const values = readValues(table, field, sink, false);
  const labels: string[] = [];
  const seen = new Set<string>();
  const issues = new Reports(x.field);
  const negatives = new Reports(field.field);
  const rows = new Int32Array(table.length);
  for (let i = 0; i < table.length; i++) {
    const raw = table.read(i, x.field);
    const name = nameOf(raw);
    if (name === null) {
      if (raw === undefined) issues.add('AX102', 'omitted', table.rowIndex(i));
      else issues.add('AX107', 'omitted', table.rowIndex(i), raw, 'Supply a label for each donut value.');
    } else {
      if (seen.has(name)) issues.add('AX108', 'chart-error', table.rowIndex(i), name);
      seen.add(name);
      rows[labels.length] = i;
      labels.push(name);
    }
    const value = values.y[i]!;
    if (value < 0) negatives.add('AX120', 'chart-error', table.rowIndex(i), value);
  }
  issues.flush(sink);
  negatives.flush(sink);
  const order = rows.subarray(0, labels.length);
  return {
    ...base(table, version), shape: 'donut', labels,
    values: Float64Array.from(order, row => values.y[row]!), slot: Uint8Array.from(order, row => values.slot[row]!),
    row: table.columns && order.length === table.length ? null : Int32Array.from(order, table.rowIndex),
    valueLabel: field.label, unit: field.unit, valueScale: field.scale,
  };
}

export function normalize(type: AlignedChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): AlignedFrame;
export function normalize(type: 'scatter', options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): PointFrame;
export function normalize(type: 'donut', options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): DonutFrame;
export function normalize(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame;
export function normalize(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame {
  const valid = options.valid ? options : { ...options, table: { ...options.table, columns: null, length: 0 } };
  if (type === 'donut') return donutFrame(valid, sink, version);
  const x = readX(type, valid, env, sink);
  reportCalendarDates(x, valid.table, sink);
  return type === 'scatter' ? pointFrame(valid, x, sink, version) : alignedFrame(valid, x, sink, version);
}
