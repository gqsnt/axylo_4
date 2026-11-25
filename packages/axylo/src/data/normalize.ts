import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticSink, type DonutFrame, type Environment, type Frame, type PointFrame,
  type RowSource, type Series, type XColumn,
} from '../core/contracts';
import { report, type DiagnosticDetails } from '../diagnostics';
import { MAX_DATE } from '../scale/zone';
import type { AlignedChartType, ChartType, ResolvedOptions, ResolvedValueField } from './options';
import { Reports } from './reports';
import { calendarIntervals, inferGaps, snapGap } from './steps';
import { recordDiagnostics, StreamDiagnostics, type DiagnosticTrace } from './store-diagnostics';
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

export interface XData {
  readonly parser: XParser;
  readonly positions: Float64Array;
  readonly order: Int32Array | null;
  readonly dateUnits: Record<DateUnit, number> | null;
  readonly ties?: boolean;
}

/** Read a position once, retaining the caller's row number for diagnostics on static and appended data. */
export function readPosition(
  parser: XParser, table: Table, row: number, series: string | null, omitted: number,
  reports: Reports, dateUnits: XData['dateUnits'], start = 0, column?: ArrayLike<unknown>,
): number {
  if (series !== null && nameOf(table.read(row, series)) === null) return NaN;
  const raw = column === undefined ? table.read(row, parser.field.field) : column[row];
  if (Number.isNaN(raw) && table.isColumnRow(row)) return NaN;
  const position = parser.read(raw, start + table.rowIndex(row), reports, omitted);
  if (dateUnits && Number.isFinite(position)) dateUnits[dateUnitOf(raw)]++;
  return position;
}

export function readX(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, categories?: readonly string[]): XData {
  const { x, table } = options;
  const kind = x.type ?? inferKind(table, x.field, options.series) ?? (categories ? 'category' : 'number');
  const parser = new XParser(x, kind, env, type === 'scatter', categories);
  const reports = new Reports(x.field, sink);
  const dateUnits = kind === 'date' ? { day: 0, month: 0, year: 0 } : null;
  const input = table.columns?.[x.field];
  let positions = input instanceof Float64Array && (kind === 'number' || kind === 'time')
    ? input : new Float64Array(table.length);
  let ascending = true;
  let ties = false;
  const scatter = type === 'scatter';
  let last = -Infinity;
  let i = 0;
  const epoch = x.type === 'time';
  if (options.series === null && input instanceof Float64Array && (kind === 'number' || epoch)) {
    // XParser owns AX109 and invalid instants. Hand it the first exceptional row and the whole suffix.
    const limit = epoch ? MAX_DATE : Number.MAX_VALUE;
    const hintStart = epoch ? 1e9 : x.type === null ? 1e11 : Infinity;
    const hintEnd = epoch ? 1e10 : 1e14;
    for (; i < table.length; i++) {
      const value = input[i]!;
      const abs = Math.abs(value);
      if (!(abs <= limit) || abs >= hintStart && abs < hintEnd) break;
      if (!(value > last)) {
        if (!scatter || value !== last) break;
        ties = true;
      }
      last = value;
    }
  }
  let valid = i;
  for (; i < table.length; i++) {
    const value = readPosition(parser, table, i, options.series, options.values.length, reports, dateUnits, 0, input);
    if (positions === input && !Object.is(positions[i], value)) positions = positions.slice();
    if (positions !== input) positions[i] = value;
    if (!Number.isFinite(value)) continue;
    if (!(value > last)) {
      if (scatter && value === last) ties = true;
      else ascending = false;
    }
    last = value;
    valid++;
  }
  reports.flush(sink);
  if (ascending && valid === table.length) return { parser, positions, order: null, dateUnits, ties };

  const order = new Int32Array(valid);
  let next = 0;
  for (let i = 0; i < positions.length; i++) if (Number.isFinite(positions[i])) order[next++] = i;
  if (!ascending) order.sort((a, b) => positions[a]! - positions[b]!);
  return { parser, positions, order, dateUnits };
}

export function reportCalendarDates(x: XData, table: Table, sink: DiagnosticSink): void {
  if (x.parser.kind !== 'time') return;
  const length = x.order?.length ?? x.positions.length;
  if (length < 2) return;
  const first = x.positions[x.order?.[0] ?? 0]!;
  let last = first;
  const zone = x.parser.timeZone ?? 'UTC';
  let matches = 3;
  for (let i = 1; i < length; i++) {
    const position = x.positions[x.order?.[i] ?? i]!;
    if (position === last) continue;
    matches &= calendarIntervals(last, position, zone);
    if (!matches) return;
    last = position;
  }
  if (last === first) return;
  const rows: number[] = [];
  for (let i = 0; i < x.positions.length && rows.length < 10; i++) {
    if (Number.isFinite(x.positions[i])) rows.push(table.rowIndex(i));
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
  readonly order: Int32Array | null;
}

function groups(options: ResolvedOptions, x: XData, sink: DiagnosticSink): Group[] {
  const { table, series } = options;
  if (series === null) {
    return options.values.map(value => ({
      key: value.field, label: value.label, value, order: x.order,
    }));
  }

  const indexes = new Map<string, number>();
  const counts: number[] = [];
  const membership = new Int32Array(table.length).fill(-1);
  const reports = new Reports(series, sink);
  for (let i = 0; i < table.length; i++) {
    const raw = table.read(i, series);
    const name = nameOf(raw);
    if (name === null) {
      if (Number.isNaN(raw) && table.isColumnRow(i)) continue;
      reportMissingName(reports, table.rowIndex(i), raw);
      continue;
    }
    if (!Number.isFinite(x.positions[i])) continue;
    let index = indexes.get(name);
    if (index === undefined) {
      index = indexes.size;
      indexes.set(name, index);
      counts.push(0);
    }
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
  return Array.from(indexes, ([key, index]) => ({ key, label: key, value, order: orders[index]! }));
}

interface AlignedGroup {
  readonly group: Group;
  readonly order: Int32Array | null;
  readonly gaps: Float64Array | null;
  readonly drawable: boolean;
  readonly sparse?: number;
}

function sameStep(positions: Float64Array): boolean {
  if (positions.length < 3) return true;
  const step = positions[1]! - positions[0]!;
  for (let i = 2; i < positions.length; i++) {
    if (positions[i]! - positions[i - 1]! !== step) return false;
  }
  return true;
}

function alignGroup(group: Group, x: XData, axis: XColumn, field: string, table: Table, sink: DiagnosticSink, grid?: AlignedGroup): AlignedGroup {
  const { positions } = x;
  let order = group.order;
  let drawable = true;
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
  if (grid) return { group, order, drawable, gaps: grid.gaps, sparse: grid.sparse };
  // Category axes have no inferred steps. Numeric, instant and wall-clock steps depend only on deltas.
  if (!order && (axis.kind === 'category' || axis.kind !== 'date' && sameStep(positions))) {
    return { group, order, drawable, gaps: null };
  }
  let sparse: number | undefined;
  const gaps = inferGaps(axis, order?.length ?? positions.length, i => positions[order?.[i] ?? i]!,
    (gap, a, b, step) => snapGap(gap, a, b, step, x.order?.length ?? positions.length, i => positions[x.order?.[i] ?? i]!),
    count => { sparse = count; });
  return { group, order, gaps, drawable, sparse };
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

function alignedSeries(aligned: AlignedGroup, axis: XColumn, x: XData, table: Table, values: Values): Series {
  const { group, order, gaps, drawable } = aligned;
  const { value } = group;
  const zero = value.missing === 'zero';
  const description = seriesDescription(group.key, group.label, value);

  if (order === null && axis.values === x.positions) {
    let row = table.columns ? null : sourceRows(table);
    if (zero && !values.allValid) {
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
  const frame = {
    ...base(table, version), shape: 'aligned' as const,
    xLabel: options.x.label, yLabel: options.values.length === 1 ? options.values[0]!.label : null,
  };
  const empty = () => ({ ...frame, x: { ...axis, values: new Float64Array(), categories: axis.categories && [] }, length: 0, series: [] });
  let observed = x.positions;
  if (x.order) {
    const sorted = new Float64Array(x.order.length);
    for (let i = 0; i < sorted.length; i++) sorted[i] = x.positions[x.order[i]!]!;
    observed = distinctPositions(sorted);
  }
  const groupsBySeries = groups(options, x, sink);
  if (!alignmentFits(groupsBySeries.length, observed.length, sink)) return empty();
  const aligned: AlignedGroup[] = [];
  for (const group of groupsBySeries) {
    aligned.push(alignGroup(group, x, axis, options.x.field, table, sink, options.series === null ? aligned[0] : undefined));
  }
  const positions = mergeGaps(observed, aligned, options.series === null);
  if (!alignmentFits(aligned.length, positions.length, sink)) return empty();
  const column = { ...axis, values: positions };
  const included = x.order === null ? undefined : (row: number) => Number.isFinite(x.positions[row]);
  const shared = options.series === null ? undefined : readValues(table, options.values[0]!, sink, true, 0, undefined, included);
  const series = aligned.map(group => {
    const value = group.group.value;
    const count = counts ? { decimal: 0, other: 0 } : undefined;
    const values = shared ?? readValues(table, value, sink, true, 0, undefined, included, undefined, count);
    if (count) counts!.set(value.field, count);
    return alignedSeries(group, column, x, table, values);
  });
  for (const { group, gaps, sparse } of aligned) {
    reportGaps(sink, options.x.field, group.value.missing === 'zero', gaps, axis, group.label, sparse, group.key);
  }
  return { ...frame, x: column, length: positions.length, series };
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
  const members = groups(options, x, sink);
  const values = readValues(table, value, sink, true, 0, undefined, included, 'The affected points are not drawn.', undefined, false);
  let allValid = values.allValid;
  if (value.missing === 'zero' && !allValid) {
    allValid = !included;
    for (let row = 0; row < values.slot.length; row++) {
      const state = values.slot[row];
      if (state === SLOT_NULL || state === SLOT_ABSENT_FIELD) values.slot[row] = SLOT_VALUE;
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
      if (allValid || values.slot[row] === SLOT_VALUE) rows[next++] = row;
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

function donutFrame(options: ResolvedOptions, sink: DiagnosticSink, version: FrameVersion): DonutFrame {
  const { table, x } = options;
  const field = options.values[0]!;
  const labels: string[] = [];
  const seen = new Set<string>();
  const issues = new Reports(x.field, sink);
  const negatives = new Reports(field.field, sink);
  const rows = new Int32Array(table.length);
  const included = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) {
    const raw = table.read(i, x.field);
    const name = nameOf(raw);
    if (name === null) {
      if (Number.isNaN(raw) && table.isColumnRow(i)) continue;
      reportMissingName(issues, table.rowIndex(i), raw, true);
    } else {
      if (seen.has(name)) issues.add('AX108', 'chart-error', table.rowIndex(i), name);
      seen.add(name);
      rows[labels.length] = i;
      labels.push(name);
      included[i] = 1;
    }
  }
  issues.flush(sink);
  const order = rows.subarray(0, labels.length);
  const values = readValues(table, field, sink, true, 0, undefined, i => included[i] === 1);
  const provenance = table.columns && order.length === table.length && field.missing !== 'zero'
    ? null : Int32Array.from(order, table.rowIndex);
  for (let i = 0; i < order.length; i++) {
    const row = order[i]!;
    const value = values.y[row]!;
    if (value < 0) negatives.add('AX120', 'chart-error', table.rowIndex(row), value);
    if (field.missing === 'zero' && (values.slot[row] === SLOT_NULL || values.slot[row] === SLOT_ABSENT_FIELD)) {
      values.slot[row] = SLOT_VALUE;
      provenance![i] = -1;
    }
  }
  negatives.flush(sink);
  const allRows = order.length === table.length;
  return {
    ...base(table, version), shape: 'donut', labels,
    values: allRows && values.y instanceof Float64Array ? values.y : Float64Array.from(order, row => values.y[row]!),
    slot: allRows ? values.slot : Uint8Array.from(order, row => values.slot[row]!),
    row: provenance,
    valueLabel: field.label, unit: field.unit, valueScale: field.scale,
  };
}

interface AlignedSeed {
  readonly options: ResolvedOptions;
  readonly type: AlignedChartType;
  readonly x: XData;
  readonly counts: Map<string, ValueCounts>;
  readonly diagnostics: StreamDiagnostics;
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

export function normalizePoints(options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): PointFrame {
  return buildPoints(options, env, sink, version).frame;
}

export function normalizeAligned(type: AlignedChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): AlignedFrame {
  const valid = usable(options);
  const diagnostics = options.valid && options.series === null ? new StreamDiagnostics() : null;
  const observe = diagnostics ? recordDiagnostics(sink, diagnostics) : sink;
  const x = readX(type, valid, env, observe);
  reportCalendarDates(x, valid.table, sink);
  // Ascending wide axes can initialize the streaming indexes from normalized positions.
  const counts = diagnostics && x.order === null ? new Map<string, ValueCounts>() : undefined;
  const frame = alignedFrame(valid, x, observe, version, counts);
  if (counts && diagnostics && frame.series.length === options.values.length) {
    alignedSeeds.set(frame, { options, type, x, counts, diagnostics });
  }
  return frame;
}
