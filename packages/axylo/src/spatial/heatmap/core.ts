/**
 * Options, validation (AX182–AX186), normalization and view of the heatmap (`axylo/spatial`).
 *
 * The chart runs on the shared controller as a one-series aligned chart: the controller sees an AlignedFrame
 * whose x positions are the cell indexes 0 … rows × columns - 1 (row-major) and whose single series holds every
 * cell's value, state and source row. The matrix itself (dimensions, category keys, color domain, per-cell bin)
 * is the frame's MatrixFrame, kept beside it in a WeakMap, so no shared contract changes and the frame the
 * controller holds, commits and rolls back is the very one every heatmap stage reads.
 *
 * Every heatmap option that the controller does not see (fields, categories, color scheme, domain, bins) is part
 * of the frame: a change to one of them is handed to the controller as new data (chart.ts), so it is validated,
 * accepted or rolled back with the frame, under the same `strict` rules as data.
 */
import {
  SLOT_INVALID, SLOT_NULL, SLOT_VALUE,
  type AlignedFrame, type AlignedView, type DiagnosticEffect, type DiagnosticInput, type DiagnosticSink, type Series,
} from '../../core/contracts';
import type { Composition } from '../../core/composition';
import { sameValue } from '../../core/options';
import { resolveOptions, type ChartType, type ResolvedOptions } from '../../data/options';
import type { DataEnvironment, FrameVersion } from '../../data/normalize';
import type { Table } from '../../data/table';
import type { AlignedViewState } from '../../view';
import {
  binOf, DEFAULT_BINS, makeDomain, validBins, type ColorScheme, type ScaleDomain,
} from '../color-scale';

export type HeatmapDiagnosticCode = 'AX182' | 'AX183' | 'AX184' | 'AX185' | 'AX186';

/** More cells than this draw correctly but slowly: AX186 says so (hint). */
export const DENSE_CELLS = 50_000;
/** More cells than this are not built at all (error state): rows × columns of a sparse long table can explode. */
export const MAX_CELLS = 4_000_000;
/** Stored in a cell's bin when it has no color: missing or invalid. */
export const NO_BIN = 255;

export type LegendPlacement = false | 'top' | 'right' | 'bottom';

export interface HeatmapMeta {
  readonly xField: string;
  readonly yField: string;
  readonly valueField: string;
  readonly xLabel: string;
  readonly yLabel: string;
  readonly valueLabel: string;
  /** The value field's `unit` and `format` as given: readings use them through the controller's formatters. */
  readonly valueUnit: unknown;
  readonly valueFormat: unknown;
  readonly xCategories: readonly string[] | null;
  readonly yCategories: readonly string[] | null;
  readonly scheme: ColorScheme;
  /** The author's domain as given (validated in normalization), or null for the data's own range. */
  readonly domain: readonly [number, number] | null;
  /** The diverging midpoint as given (default 0). */
  readonly mid: number;
  readonly bins: number;
  readonly legend: LegendPlacement;
}

export interface HeatmapIssue {
  readonly code: 'AX150' | 'AX184';
  readonly field: string;
  readonly detail: string;
}

/** The matrix behind one frame. Row-major: cell = row × cols + col. */
export interface MatrixFrame {
  readonly meta: HeatmapMeta;
  readonly rows: number;
  readonly cols: number;
  /** NaN wherever `state` is not SLOT_VALUE. The frame's series `y` is this very array. */
  readonly values: Float64Array;
  /** SLOT_VALUE (0), SLOT_NULL (1: missing or absent), SLOT_INVALID (2: present but not a finite number). */
  readonly state: Uint8Array;
  /** Source row of each cell, -1 for a cell no row gave. */
  readonly source: Int32Array;
  /** Color bin of each cell, NO_BIN for missing and invalid cells. */
  readonly bin: Uint8Array;
  readonly xKeys: readonly string[];
  readonly yKeys: readonly string[];
  /** Range of the finite values (NaN when there are none). */
  readonly min: number;
  readonly max: number;
  readonly valueCount: number;
  readonly missingCount: number;
  readonly invalidCount: number;
  /** The resolved color domain, or null when no cell has a value. */
  readonly domain: ScaleDomain | null;
  /** Whether the domain came from the author (true) or from the data (false). */
  readonly explicitDomain: boolean;
  /** Raw text of each invalid cell's value, by cell (for readings). */
  readonly invalidText: ReadonlyMap<number, string>;
  /**
   * The later rows of each duplicate cell (AX182): how many, and the first few values as given. They are not
   * drawn, but every reading of the cell (tooltip, keyboard, table) names them, so the reader's note that sends
   * the reader to the table is true. Entries exist only for duplicate cells.
   */
  readonly duplicates: ReadonlyMap<number, Duplicates>;
}

export interface Duplicates {
  count: number;
  readonly values: unknown[];
}

/** Values of a duplicate cell named in its readings. */
export const DUPLICATES_SHOWN = 3;

/**
 * The meta of the call the controller resolves next. The chart wrapper sets it before each create or update and
 * restores the accepted one after; stages never read it while drawing, they read the frame's own record.
 */
export interface HeatmapStateRef {
  meta: HeatmapMeta;
}

let frameRecords: WeakMap<AlignedFrame, MatrixFrame> | undefined;

/** The matrix of a heatmap frame, or undefined for a frame this module did not make. */
export function matrixOf(frame: AlignedFrame): MatrixFrame | undefined {
  return frameRecords?.get(frame);
}

// ───────────────────────────── diagnostics ─────────────────────────────

const LEVELS: Readonly<Record<HeatmapDiagnosticCode, 'warning' | 'hint'>> = {
  AX182: 'warning', AX183: 'warning', AX184: 'warning', AX185: 'hint', AX186: 'hint',
};

export interface HeatmapDiagnosticDetails {
  readonly field?: string;
  readonly rows?: readonly number[];
  readonly count?: number;
  readonly detail?: string;
}

function rowsText(rows: readonly number[] | undefined): string {
  return rows?.length ? ` (${rows.length === 1 ? 'row' : 'rows'} ${rows.join(', ')})` : '';
}

function plural(n: number, word: string, many = word + 's'): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** A heatmap finding. Messages say what is wrong, where, and what the chart does about it. */
export function heatmapDiagnostic(
  code: HeatmapDiagnosticCode, effect: DiagnosticEffect, details: HeatmapDiagnosticDetails = {},
  origin: DiagnosticInput['origin'] = 'call',
): DiagnosticInput {
  const rows = details.rows ? [...new Set(details.rows)].slice(0, 10) : undefined;
  const count = details.count ?? rows?.length;
  const n = count ?? 0;
  const field = details.field === undefined ? 'The heatmap' : `Field ${JSON.stringify(details.field)}`;
  let message: string;
  switch (code) {
    case 'AX182':
      message = `${field} has ${plural(n, 'duplicate cell')}${rowsText(rows)}: more than one row for the same row and column. `
        + 'The first row of each cell is drawn; the later ones are not drawn, and each such cell\'s reading and table entry names them.';
      break;
    case 'AX183':
      message = details.detail ?? `${field} has ${plural(n, 'value')} that ${n === 1 ? 'is' : 'are'} not a finite number${rowsText(rows)}. `
        + 'Those cells are crossed out as invalid, apart from missing cells, and read "Invalid value".';
      break;
    case 'AX184':
      message = details.detail ?? `${field} has a color domain that cannot be used.`;
      break;
    case 'AX185':
      message = details.detail ?? 'Heatmap cells are narrower or shorter than 1 CSS px, so neighbouring cells merge on screen. '
        + 'Exact values stay in the readings and the table.';
      break;
    default:
      message = `The heatmap has ${n} cells (more than ${DENSE_CELLS}). It is drawn as one batched path per color, `
        + 'but building it may be slow; consider aggregating rows or columns.';
  }
  return {
    code, level: LEVELS[code], effect, origin, message,
    ...(details.field !== undefined ? { field: details.field } : {}),
    ...(rows?.length ? { rows } : {}),
    ...(count !== undefined ? { count } : {}),
  };
}

// ───────────────────────────── options ─────────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function fieldName(spec: unknown): string {
  if (typeof spec === 'string') return spec;
  if (isObj(spec) && typeof spec.field === 'string') return spec.field;
  return '';
}

function fieldLabel(spec: unknown, fallback: string): string {
  return isObj(spec) && typeof spec.label === 'string' && spec.label.trim() ? spec.label : fallback;
}

function categoriesOf(spec: unknown, path: string, issues: HeatmapIssue[]): readonly string[] | null {
  if (!isObj(spec) || spec.categories === undefined) return null;
  const given = spec.categories;
  if (!Array.isArray(given) || !given.every(c => typeof c === 'string' || (typeof c === 'number' && Number.isFinite(c)))) {
    issues.push({ code: 'AX150', field: `${path}.categories`, detail: `Option "${path}.categories" must be an array of strings or numbers; it is ignored.` });
    return null;
  }
  const out = given.map(String);
  if (new Set(out).size !== out.length) {
    issues.push({ code: 'AX150', field: `${path}.categories`, detail: `Option "${path}.categories" lists a category twice; it is ignored.` });
    return null;
  }
  return out;
}

const COMMON_KEYS = new Set([
  'data', 'title', 'labelledBy', 'subtitle', 'description', 'state', 'legend', 'tooltip', 'table', 'messages',
  'locale', 'strict', 'onDiagnostic',
]);
const HEATMAP_KEYS = new Set(['x', 'y', 'value', 'color']);
const AXIS_KEYS = new Set(['field', 'label', 'categories']);
const VALUE_KEYS = new Set(['field', 'label', 'unit', 'format']);
const COLOR_KEYS = new Set(['scheme', 'domain', 'mid', 'bins']);

function unknownKeys(input: unknown, known: ReadonlySet<string>, prefix: string, issues: HeatmapIssue[]): void {
  if (!isObj(input)) return;
  for (const key of Object.keys(input)) {
    if (known.has(key)) continue;
    issues.push({ code: 'AX150', field: prefix + key, detail: `Unknown option "${prefix + key}" for a heatmap; it is ignored.` });
  }
}

/** Built-in text of the heatmap that differs from the line chart the controller runs as. */
export const HEATMAP_MESSAGES = {
  typeLine: 'Heatmap',
  pointOf: '{series}, {x}, {value}. Cell {index} of {count}.',
  plotInstructions: 'Arrow keys move between cells: left and right along a row, up and down along a column. '
    + 'Home and End go to the ends of the row, Page Up and Page Down move 8 rows. Enter selects.',
} as const;

export interface ParsedHeatmap {
  readonly meta: HeatmapMeta;
  readonly issues: readonly HeatmapIssue[];
  /** What the controller is given: a line chart over the value field, its legend and messages. */
  readonly translated: Record<string, unknown>;
}

function legendOf(input: unknown, issues: HeatmapIssue[]): LegendPlacement {
  if (input === undefined || input === 'auto') return 'bottom';
  if (input === false || input === 'top' || input === 'right' || input === 'bottom') return input;
  issues.push({ code: 'AX150', field: 'legend', detail: 'Option "legend" must be false, "auto", "top", "right" or "bottom"; the color bar is shown below.' });
  return 'bottom';
}

/**
 * Splits heatmap options into the meta the heatmap stages read and the options the controller runs on.
 * `previous` keeps equal arrays (domain, categories) identical, so an unchanged option keeps the frame.
 */
export function parseHeatmapInput(input: unknown, previous?: HeatmapMeta | null): ParsedHeatmap {
  const src = isObj(input) ? input : {};
  const issues: HeatmapIssue[] = [];
  for (const key of Object.keys(src)) {
    if (!COMMON_KEYS.has(key) && !HEATMAP_KEYS.has(key)) {
      issues.push({
        code: 'AX150', field: key,
        detail: key === 'colors'
          ? 'Option "colors" does not apply to a heatmap (it has no series); style the scale with --axylo-sequential-0 … 4 or --axylo-diverging-0 … 4. It is ignored.'
          : `Unknown option "${key}" for a heatmap; it is ignored.`,
      });
    }
  }
  if (typeof src.x !== 'string') unknownKeys(src.x, AXIS_KEYS, 'x.', issues);
  if (typeof src.y !== 'string') unknownKeys(src.y, AXIS_KEYS, 'y.', issues);
  if (typeof src.value !== 'string') unknownKeys(src.value, VALUE_KEYS, 'value.', issues);
  unknownKeys(src.color, COLOR_KEYS, 'color.', issues);

  const xField = fieldName(src.x);
  const yField = fieldName(src.y);
  const valueField = fieldName(src.value);
  const color = isObj(src.color) ? src.color : {};

  let scheme: ColorScheme = 'sequential';
  if (color.scheme === 'diverging' || color.scheme === 'sequential') scheme = color.scheme;
  else if (color.scheme !== undefined) {
    issues.push({ code: 'AX150', field: 'color.scheme', detail: 'Option "color.scheme" must be "sequential" or "diverging"; "sequential" is used.' });
  }
  let bins = DEFAULT_BINS;
  if (color.bins !== undefined) {
    const valid = validBins(color.bins);
    if (valid === null) {
      issues.push({ code: 'AX150', field: 'color.bins', detail: `Option "color.bins" must be an integer from 2 to 64; ${DEFAULT_BINS} is used.` });
    } else bins = valid;
  }
  let domain: readonly [number, number] | null = null;
  if (color.domain !== undefined) {
    const d = color.domain;
    const ok = Array.isArray(d) && d.length === 2 && typeof d[0] === 'number' && typeof d[1] === 'number'
      && Number.isFinite(d[0]) && Number.isFinite(d[1]) && d[0] < d[1];
    if (ok) {
      const before = previous?.domain;
      domain = before && Object.is(before[0], d[0]) && Object.is(before[1], d[1]) ? before : [d[0] as number, d[1] as number];
    } else {
      issues.push({
        code: 'AX184', field: 'color.domain',
        detail: 'Option "color.domain" must be two finite numbers, the smaller first and different from the larger. '
          + 'It is ignored: the colors span the data\'s own range. Exact values are unchanged.',
      });
    }
  }
  let mid = 0;
  if (color.mid !== undefined) {
    if (typeof color.mid === 'number' && Number.isFinite(color.mid)) mid = color.mid;
    else {
      issues.push({ code: 'AX184', field: 'color.mid', detail: 'Option "color.mid" must be a finite number; 0 is used as the diverging midpoint.' });
    }
  }
  if (scheme === 'diverging' && domain && !(mid > domain[0] && mid < domain[1])) {
    issues.push({
      code: 'AX184', field: 'color.mid',
      detail: `The diverging midpoint ${mid} is not inside "color.domain" [${domain[0]}, ${domain[1]}]: one arm of the scale would be empty. `
        + 'The domain is ignored and the colors span the data\'s range, symmetric about the midpoint.',
    });
    domain = null;
  }
  if (scheme === 'sequential' && color.mid !== undefined) {
    issues.push({ code: 'AX150', field: 'color.mid', detail: 'Option "color.mid" applies to the diverging scheme only; it is ignored.' });
  }

  const keep = (next: readonly string[] | null, before: readonly string[] | null | undefined) =>
    next && before && sameValue(next, before) ? before : next;
  const xCategories = keep(categoriesOf(src.x, 'x', issues), previous?.xCategories);
  const yCategories = keep(categoriesOf(src.y, 'y', issues), previous?.yCategories);
  const legend = legendOf(src.legend, issues);

  const meta: HeatmapMeta = {
    xField, yField, valueField,
    xLabel: fieldLabel(src.x, xField || 'Column'),
    yLabel: fieldLabel(src.y, yField || 'Row'),
    valueLabel: fieldLabel(src.value, valueField || 'Value'),
    valueUnit: isObj(src.value) ? src.value.unit : undefined,
    valueFormat: isObj(src.value) ? src.value.format : undefined,
    xCategories, yCategories, scheme, domain, mid, bins, legend,
  };

  const translated: Record<string, unknown> = {};
  for (const key of Object.keys(src)) if (COMMON_KEYS.has(key)) translated[key] = src[key];
  const value = isObj(src.value) ? src.value : {};
  translated.x = { field: xField, label: meta.xLabel };
  translated.y = {
    field: valueField, label: meta.valueLabel,
    ...(value.unit !== undefined ? { unit: value.unit } : {}),
    ...(value.format !== undefined ? { format: value.format } : {}),
  };
  translated.series = yField;
  translated.zoom = false;
  translated.legend = legend;
  const messages: Record<string, unknown> = { ...HEATMAP_MESSAGES, ...(isObj(src.messages) ? src.messages : {}) };
  // A matrix with no finite cell is viewed as 'bar' (buildHeatmapView), and the shared reader names the chart by
  // the view's kind: the heatmap's own type name serves both, so the chart is never called a bar chart.
  messages.typeBar = messages.typeLine;
  translated.messages = messages;
  return { meta, issues, translated };
}

/** The meta fields the frame is built from: two metas with the same key make the same frame from the same rows. */
export function frameKeyOf(meta: HeatmapMeta): readonly unknown[] {
  // Unit and format too: the controller would otherwise rename the frame in place for them, without a matrix.
  return [meta.xField, meta.yField, meta.valueField, meta.xLabel, meta.yLabel, meta.valueLabel, meta.valueUnit, meta.valueFormat, meta.xCategories,
    meta.yCategories, meta.scheme, meta.domain, meta.mid, meta.bins];
}

export function issueDiagnostic(issue: HeatmapIssue): DiagnosticInput {
  if (issue.code === 'AX184') return heatmapDiagnostic('AX184', 'none', { field: issue.field, detail: issue.detail });
  return { code: 'AX150', level: 'warning', effect: 'none', origin: 'call', message: issue.detail, field: issue.field };
}

export function createHeatmapResolver(
  pendingIssues: { list: readonly HeatmapIssue[] },
): NonNullable<Composition['resolve']> {
  return (_kind, options, sink, table): ResolvedOptions => {
    for (const issue of pendingIssues.list) sink.add(issueDiagnostic(issue));
    return resolveOptions('line', options, sink, table);
  };
}

// ───────────────────────────── normalization ─────────────────────────────

/** A row or column key as text, or null when the value cannot name a cell. */
function keyText(v: unknown): string | null {
  if (typeof v === 'string') return v === '' ? null : v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString() : null;
  return null;
}

export function invalidText(v: unknown): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return JSON.stringify(v.length > 24 ? v.slice(0, 23) + '…' : v);
  if (typeof v === 'bigint') return `${v}n`;
  return typeof v;
}

function typedFloat(column: ArrayLike<unknown> | undefined): boolean {
  return column instanceof Float64Array || column instanceof Float32Array;
}

class Categories {
  readonly index = new Map<string, number>();
  readonly fixed: boolean;
  private lastKey?: string;
  private lastIndex = -1;
  constructor(given: readonly string[] | null) {
    this.fixed = given !== null;
    if (given) for (const key of given) this.index.set(key, this.index.size);
  }
  /** The key's position, adding it when the categories are not fixed; -1 for a key outside fixed categories. */
  at(key: string): number {
    if (key === this.lastKey) return this.lastIndex;
    let found = this.index.get(key);
    if (found === undefined && !this.fixed) {
      found = this.index.size;
      this.index.set(key, found);
    }
    this.lastKey = key;
    return this.lastIndex = found ?? -1;
  }
}

function readField(table: Table, field: string): (i: number) => unknown {
  // Only borrow an own data property. Accessor columns and row sources retain their per-read behavior.
  const column: ArrayLike<unknown> | undefined = table.columns ? Object.getOwnPropertyDescriptor(table.columns, field)?.value : undefined;
  return column ? i => column[i] : i => table.read(i, field);
}

interface Samples { count: number; rows: number[] }
const samples = (): Samples => ({ count: 0, rows: [] });
function note(s: Samples, row: number): void {
  s.count++;
  if (s.rows.length < 10) s.rows.push(row);
}

/**
 * Builds the matrix from the resolved table and returns its one-series aligned frame. Reports AX182 (duplicate
 * cells), AX183 (values that are not finite numbers, and rows whose key cannot name a cell), AX184 (an author
 * domain the data has no values in) and AX186 (dense), all with call origin so `strict` rejects the call.
 */
export function normalizeHeatmap(
  meta: HeatmapMeta, resolved: ResolvedOptions, sink: DiagnosticSink, version: FrameVersion,
): AlignedFrame {
  const table: Table = resolved.table;
  const n = resolved.valid ? table.length : 0;
  const xs = new Categories(meta.xCategories);
  const ys = new Categories(meta.yCategories);
  const colOf = new Int32Array(n);
  const rowOf = new Int32Array(n);
  const unplaced = samples();
  const outside = samples();
  const readX = readField(table, meta.xField), readY = readField(table, meta.yField);
  for (let i = 0; i < n; i++) {
    const xk = keyText(readX(i));
    const yk = keyText(readY(i));
    if (xk === null || yk === null) {
      colOf[i] = -1;
      note(unplaced, table.rowIndex(i));
      continue;
    }
    const c = xs.at(xk), r = ys.at(yk);
    if (c < 0 || r < 0) {
      colOf[i] = -1;
      note(outside, table.rowIndex(i));
      continue;
    }
    colOf[i] = c;
    rowOf[i] = r;
  }
  const cols = xs.index.size, rows = ys.index.size;
  const total = rows * cols;
  if (total > MAX_CELLS) {
    sink.add({
      code: 'AX134', level: 'error', effect: 'chart-error', origin: 'call', field: meta.yField, count: total,
      message: `The heatmap would have ${rows} rows × ${cols} columns = ${total} cells, more than ${MAX_CELLS}. `
        + 'The chart shows its error state; aggregate the data or name fewer categories.',
    });
    return buildFrame(meta, version, table, 0, 0, new Float64Array(0), new Uint8Array(0), new Int32Array(0),
      [], [], NaN, NaN, 0, 0, 0, null, false, new Map(), new Map(), null);
  }
  const values = new Float64Array(total);
  const state = new Uint8Array(total).fill(SLOT_NULL);
  const source = new Int32Array(total).fill(-1);
  const invalid = new Map<number, string>();
  const duplicates = new Map<number, Duplicates>();
  const duplicate = samples();
  const notFinite = samples();
  const column = table.columns?.[meta.valueField];
  const typed = typedFloat(column);
  const readValue = readField(table, meta.valueField);
  let min = Infinity, max = -Infinity, valueCount = 0, invalidCount = 0;
  for (let i = 0; i < n; i++) {
    const c = colOf[i]!;
    if (c < 0) continue;
    const cell = rowOf[i]! * cols + c;
    const sourceRow = table.rowIndex(i);
    if (source[cell]! >= 0) {
      note(duplicate, sourceRow);
      let d = duplicates.get(cell);
      if (!d) duplicates.set(cell, d = { count: 0, values: [] });
      d.count++;
      if (d.values.length < DUPLICATES_SHOWN) d.values.push(readValue(i));
      continue;
    }
    source[cell] = sourceRow;
    const v = readValue(i);
    if (typeof v === 'number' && Number.isFinite(v)) {
      values[cell] = v;
      state[cell] = SLOT_VALUE;
      valueCount++;
      if (v < min) min = v;
      if (v > max) max = v;
    } else if (v === null || v === undefined || v === '' || (typed && v !== v)) {
      // Missing: an explicit null, an absent value, or NaN in a typed column (the contract's SLOT_NULL).
    } else {
      state[cell] = SLOT_INVALID;
      invalidCount++;
      invalid.set(cell, invalidText(v));
      note(notFinite, sourceRow);
    }
  }
  if (duplicate.count) {
    sink.add(heatmapDiagnostic('AX182', 'omitted', { field: `${meta.yField}/${meta.xField}`, rows: duplicate.rows, count: duplicate.count }));
  }
  if (notFinite.count) {
    sink.add(heatmapDiagnostic('AX183', 'omitted', { field: meta.valueField, rows: notFinite.rows, count: notFinite.count }));
  }
  if (unplaced.count) {
    sink.add(heatmapDiagnostic('AX183', 'omitted', {
      field: `${meta.yField}/${meta.xField}`, rows: unplaced.rows, count: unplaced.count,
      detail: `${plural(unplaced.count, 'row')}${rowsText(unplaced.rows)} ${unplaced.count === 1 ? 'has' : 'have'} a row or column key that is missing or not a string, number or date. `
        + `${unplaced.count === 1 ? 'It is' : 'They are'} left out of the heatmap.`,
    }));
  }
  if (outside.count) {
    sink.add(heatmapDiagnostic('AX183', 'omitted', {
      field: `${meta.yField}/${meta.xField}`, rows: outside.rows, count: outside.count,
      detail: `${plural(outside.count, 'row')}${rowsText(outside.rows)} ${outside.count === 1 ? 'names' : 'name'} a row or column outside the given categories. `
        + `${outside.count === 1 ? 'It is' : 'They are'} left out of the heatmap.`,
    }));
  }
  if (total > DENSE_CELLS) sink.add(heatmapDiagnostic('AX186', 'none', { count: total }));

  const hasValues = valueCount > 0;
  const limits = meta.domain;
  const domain = hasValues ? makeDomain(meta.scheme, limits?.[0] ?? min, limits?.[1] ?? max, meta.mid, meta.bins) : null;
  if (hasValues && limits && (max < limits[0] || min > limits[1])) {
    sink.add(heatmapDiagnostic('AX184', 'none', {
      field: 'color.domain',
      detail: `No value lies inside "color.domain" [${limits[0]}, ${limits[1]}] (the data spans ${min} to ${max}): `
        + 'every cell takes an end color. Exact values are unchanged.',
    }));
  }
  return buildFrame(meta, version, table, rows, cols, values, state, source, [...xs.index.keys()], [...ys.index.keys()],
    hasValues ? min : NaN, hasValues ? max : NaN, valueCount, total - valueCount - invalidCount, invalidCount, domain, hasValues && limits !== null, invalid,
    duplicates, resolved.values[0]?.unit ?? null);
}

function buildFrame(
  meta: HeatmapMeta, version: FrameVersion, table: Table, rows: number, cols: number,
  values: Float64Array, state: Uint8Array, source: Int32Array, xKeys: readonly string[], yKeys: readonly string[],
  min: number, max: number, valueCount: number, missingCount: number, invalidCount: number,
  domain: ScaleDomain | null, explicitDomain: boolean, invalid: ReadonlyMap<number, string>,
  duplicates: ReadonlyMap<number, Duplicates>, unit: string | null,
): AlignedFrame {
  const total = rows * cols;
  const bin = new Uint8Array(total);
  const positions = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    positions[i] = i;
    if (state[i] === SLOT_VALUE) bin[i] = domain ? binOf(domain, values[i]!) : NO_BIN;
    else {
      values[i] = NaN;
      bin[i] = NO_BIN;
    }
  }
  const series: Series = {
    // The controller's value formatter takes its unit from here (core/controller-helpers.ts formatSpecFor).
    key: meta.valueField || 'value', label: meta.valueLabel, field: meta.valueField, unit, valueScale: null,
    drawable: true, y: values, slot: state, row: source,
  };
  const frame: AlignedFrame = {
    shape: 'aligned', revision: version.revision, epoch: version.epoch, source: table,
    x: { kind: 'number', values: positions, categories: null, timeZone: null, dateUnit: null, ordered: true },
    series: [series], length: total, xLabel: meta.xLabel, yLabel: meta.valueLabel,
  };
  (frameRecords ??= new WeakMap()).set(frame, {
    meta, rows, cols, values, state, source, bin, xKeys, yKeys, min, max, valueCount, missingCount, invalidCount,
    domain, explicitDomain, invalidText: invalid, duplicates,
  });
  return frame;
}

/** The controller's normalize stage: the meta of the call being resolved builds the frame. */
export function normalizeForController(
  stateRef: HeatmapStateRef, _kind: ChartType, resolved: ResolvedOptions, _env: DataEnvironment, sink: DiagnosticSink,
  version: FrameVersion,
): AlignedFrame {
  return normalizeHeatmap(stateRef.meta, resolved, sink, version);
}

/**
 * The view of a heatmap frame: every cell is in view (a heatmap does not zoom). A frame the controller derived
 * without normalizing (labels renamed over the same columns) has no matrix; the wrapper never lets that happen
 * (a label is part of the frame key), so such a frame is shown as an empty matrix rather than guessed.
 *
 * Kind 'line' normally; 'bar' for a matrix that has cells but no finite value (every cell missing or invalid).
 * The controller calls a view ready only when it has something to draw (core/controller-helpers.ts `hasData`):
 * for a line that is a SLOT_VALUE slot, for a bar any slot a row gave or left empty (a bar's "no data" glyph is
 * drawn). A heatmap draws every cell, hatched or crossed out when it has no value, so the bar rule is the true one
 * here; only this case needs it, because with one value both rules agree. No heatmap stage reads the kind
 * (layout, scene, lookup, reader and legend read the matrix); the shared stages that do are listed in the
 * ledger: the chart's type name (mapped to the heatmap's own, parseHeatmapInput) and the AX132 bar-density hint.
 * The frame, its series slots (SLOT_NULL / SLOT_INVALID, never rewritten) and its values are unchanged.
 */
export function buildHeatmapView(frame: AlignedFrame, _state: AlignedViewState | unknown): AlignedView {
  const m = matrixOf(frame);
  const total = m ? m.rows * m.cols : 0;
  const last = Math.max(0, total - 1);
  const lo = m?.domain?.lo ?? 0, hi = m?.domain?.hi ?? 1;
  return {
    kind: m && total > 0 && m.valueCount === 0 ? 'bar' : 'line', revision: frame.revision, frame, visible: [true],
    cues: [{ marker: 'square', dash: { normal: null, contrast: null } }],
    xFull: [0, last], xDomain: [0, last], yDomain: lo < hi ? [lo, hi] : [lo - 1, lo + 1],
    references: [], compact: false, horizontal: false,
    visibleSlots: { start: 0, end: total }, drawSlots: [{ start: 0, end: total }], stack: null,
  };
}
