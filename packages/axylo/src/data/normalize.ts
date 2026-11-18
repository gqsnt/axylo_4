import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type DiagnosticSink, type DonutFrame, type Environment, type Frame, type PointFrame,
  type RowSource, type Series, type XColumn,
} from '../core/contracts';
import { report, type DiagnosticDetails } from '../diagnostics';
import type { AlignedChartType, ChartType, ResolvedOptions, ResolvedValueField } from './options';
import { Reports } from './reports';
import { calendarIntervals, inferGaps, snapGap } from './steps';
import { recordDiagnostics, StreamDiagnostics, type DiagnosticTrace } from './store-diagnostics';
import type { Table } from './table';
import { readValues, type ValueCounts, type Values } from './values';
import { dateUnitOf, inferKind, nameOf, positionName, XParser, type DateUnit } from './x';

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
  let last = -Infinity;
  let i = 0;
  if (options.series === null && input instanceof Float64Array && kind === 'number') {
    // Skip parsing the strictly ascending numeric prefix, stopping before any row that can report a hint.
    const inferred = x.type === null;
    for (; i < table.length; i++) {
      const value = input[i]!;
      if (!(value > last && value < Infinity) || inferred && Math.abs(value) >= 1e11 && Math.abs(value) < 1e14) break;
      last = value;
    }
  }
  let valid = i;
  for (; i < table.length; i++) {
    const usableSeries = options.series === null || nameOf(table.read(i, options.series)) !== null;
    const raw = usableSeries ? input === undefined ? table.read(i, x.field) : input[i] : undefined;
    const value = usableSeries && !(Number.isNaN(raw) && table.isColumnRow(i))
      ? parser.read(raw, table.rowIndex(i), reports, options.values.length) : NaN;
    if (positions === input && !Object.is(positions[i], value)) positions = positions.slice();
    if (positions !== input) positions[i] = value;
    if (!Number.isFinite(value)) {
      ascending = false;
      continue;
    }
    if (!(value > last)) ascending = false;
    if (dateUnits) dateUnits[dateUnitOf(raw)]++;
    last = value;
    valid++;
  }
  reports.flush(sink);
  if (ascending) return { parser, positions, order: null, dateUnits };

  const order = new Int32Array(valid);
  let next = 0;
  for (let i = 0; i < positions.length; i++) if (Number.isFinite(positions[i])) order[next++] = i;
  order.sort((a, b) => positions[a]! - positions[b]!);
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
      if (raw === undefined) reports.add('AX102', 'omitted', table.rowIndex(i), undefined, undefined, { outcome: 'The affected row is not drawn.' });
      else reports.add('AX107', 'omitted', table.rowIndex(i), raw, 'Supply a name for the series in each row.');
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
  let sparse: number | undefined;
  const gaps = inferGaps(axis, order?.length ?? positions.length, i => positions[order?.[i] ?? i]!,
    (gap, a, b, step) => snapGap(gap, a, b, step, x.order?.length ?? positions.length, i => positions[x.order?.[i] ?? i]!),
    count => { sparse = count; });
  return { group, order, gaps, drawable, sparse };
}

function combinePositions(x: XData, groups: readonly AlignedGroup[]): Float64Array {
  const gapSets = new Set(groups.flatMap(group => group.gaps ? [group.gaps] : []));
  let gapCount = 0;
  for (const gaps of gapSets) gapCount += gaps.length;
  if (x.order === null && gapCount === 0) return x.positions;
  const observed = x.order?.length ?? x.positions.length;
  const positions = new Float64Array(observed + gapCount);
  if (x.order) {
    for (let i = 0; i < observed; i++) positions[i] = x.positions[x.order[i]!]!;
  } else {
    positions.set(x.positions);
  }
  let next = observed;
  for (const gaps of gapSets) {
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
  const observed = combinePositions(x, []);
  const groupsBySeries = groups(options, x, sink);
  if (!alignmentFits(groupsBySeries.length, observed.length, sink)) return empty();
  const aligned: AlignedGroup[] = [];
  for (const group of groupsBySeries) {
    aligned.push(alignGroup(group, x, axis, options.x.field, table, sink, options.series === null ? aligned[0] : undefined));
  }
  const positions = aligned.some(group => group.gaps) ? combinePositions(x, aligned) : observed;
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

export function pointFrame(options: ResolvedOptions, x: XData, sink: DiagnosticSink, version: FrameVersion): PointFrame {
  const { table } = options;
  const value = options.values[0]!;
  const included = x.order === null ? undefined : (row: number) => Number.isFinite(x.positions[row]);
  const members = groups(options, x, sink);
  const values = readValues(table, value, sink, true, 0, undefined, included, 'The affected points are not drawn.');
  if (value.missing === 'zero') {
    for (let row = 0; row < values.slot.length; row++) {
      if (values.slot[row] === SLOT_NULL || values.slot[row] === SLOT_ABSENT_FIELD) values.slot[row] = SLOT_VALUE;
    }
  }
  const series = members.map(group => {
    const length = group.order?.length ?? x.positions.length;
    if (!group.order && values.y instanceof Float64Array && values.slot.every(slot => slot === SLOT_VALUE)) {
      return {
        key: group.key, label: group.label, drawable: true, x: x.positions, y: values.y,
        row: table.columns ? null : sourceRows(table),
      };
    }
    const rows = new Int32Array(length);
    let next = 0;
    let missing = 0;
    for (let i = 0; i < length; i++) {
      const row = group.order?.[i] ?? i;
      if (values.slot[row] === SLOT_VALUE) rows[next++] = row;
      else missing++;
    }
    // The reader still needs each valid x when a diagnostic kept its y out of the plot.
    // Their source rows too, so a re-encode can read them again (another field may have a value there).
    const missingX = missing ? new Float64Array(missing) : undefined;
    const missingRow = missing ? new Int32Array(missing) : undefined;
    if (missingX && missingRow) {
      let index = 0;
      for (let i = 0; i < length; i++) {
        const row = group.order?.[i] ?? i;
        if (values.slot[row] === SLOT_VALUE) continue;
        missingX[index] = x.positions[row]!;
        missingRow[index++] = table.rowIndex(row);
      }
    }
    const kept = rows.subarray(0, next);
    kept.sort((a, b) => x.positions[a]! - x.positions[b]! || values.y[a]! - values.y[b]!);
    return {
      key: group.key, label: group.label, drawable: true, missingX, missingRow,
      x: Float64Array.from(kept, row => x.positions[row]!), y: Float64Array.from(kept, row => values.y[row]!), row: Int32Array.from(kept, table.rowIndex),
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
      if (raw === undefined) issues.add('AX102', 'omitted', table.rowIndex(i), undefined, undefined, { outcome: 'The affected slice is not drawn.' });
      else issues.add('AX107', 'omitted', table.rowIndex(i), raw, 'Supply a label for each donut value.');
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

export function normalize(type: AlignedChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): AlignedFrame;
export function normalize(type: 'scatter', options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): PointFrame;
export function normalize(type: 'donut', options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): DonutFrame;
export function normalize(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame;
export function normalize(type: ChartType, options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): Frame {
  if (type === 'donut') return normalizeDonut(options, env, sink, version);
  if (type === 'scatter') return normalizePoints(options, env, sink, version);
  return normalizeAligned(type, options, env, sink, version);
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

export function normalizePoints(options: ResolvedOptions, env: DataEnvironment, sink: DiagnosticSink, version: FrameVersion): PointFrame {
  const valid = usable(options);
  const x = readX('scatter', valid, env, sink);
  reportCalendarDates(x, valid.table, sink);
  return pointFrame(valid, x, sink, version);
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
