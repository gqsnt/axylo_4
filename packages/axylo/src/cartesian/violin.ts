/**
 * The `violin` layer of `axylo/cartesian`: a mirrored density outline per x slot from a precomputed grouped
 * payload (`axylo/stats` violinData()), with an optional inner box (Q1–Q3, min–max line, median bar).
 *
 * One logical mark, like `boxplot`: the five numbers are carriers of the aligned frame (published series =
 * median), so visibility, the row mask, the readout formatters and the axis fit are the boxplot's. Grid, density,
 * n and bandwidth are per-source-row columns read once from the data (never retained), indexed through the
 * median carrier's `row`, so they follow the frame through sorting, updates and zoom.
 * Every top-level statement stays pure so `import 'axylo/cartesian'` bundles to 0 raw bytes.
 */
import {
  SLOT_NULL, SLOT_VALUE, type AreaMark, type Formatters, type Mark, type Projection, type Rect,
} from '../core/contracts';
import { position, seriesPaint, token } from '../scene/geometry';
import { axisScaleOf } from './scale-ref';
import { MEDIAN_WIDTH, WHISKER_WIDTH, partIndex, type LogicalMark, type OptionIssue, type PartRole, type PhysicalView } from './boxplot';

export interface ViolinColumns {
  /** Field names and the inner flag, for the layer signature. */
  readonly key: string;
  readonly inner: boolean;
  /** CSR offsets per source row into `grid` / `density`; a row that cannot be drawn has an empty slice. */
  readonly start: Uint32Array;
  /**
   * Per source row, the AX106 state of `field`: 1 an empty grid / density pair, silent unless the chart reads its
   * median (no data); 2 an empty pair with a positive n, or a malformed grid. normalizeCartesian reports all of them
   * once per field, across the layers that share it and in source-row order, deciding 1 from the normalized median
   * so the parsing rules for that are the chart's own.
   */
  readonly empty: Uint8Array;
  readonly field: string;
  readonly grid: Float64Array;
  readonly density: Float64Array;
  /** Per source row; null when the data has no such field at all (the readout then leaves it out). */
  readonly n: Float64Array | null;
  readonly bandwidth: Float64Array | null;
  /** Largest density of the layer: every violin of a layer shares one width scale. */
  readonly peak: number;
  /**
   * The chart's shared pool, whose AX106 notes on a field some layer reads as its grid are left unflushed: normalizeCartesian
   * unions them with that grid's mask so the field gets one report whichever role found each row.
   */
  readonly notes: ViolinNotes | null;
}

const NOT_DRAWN = "Those rows' density outlines are not drawn; their summaries stay in tooltip and table.";
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Any array-like object, as `Data` columns and the layer's list cells are typed (plain arrays, typed arrays, `{ length }`). */
const isList = (v: unknown): v is ArrayLike<unknown> =>
  v !== null && typeof v === 'object' && Number.isInteger((v as ArrayLike<unknown>).length) && (v as ArrayLike<unknown>).length >= 0;
type Code = 'AX102' | 'AX103' | 'AX106';
/**
 * Per code and field, the source rows at fault, pooled over the violin layers of one chart (see flushViolin). Each
 * row holds the roles it faulted in, OUTLINE (read as a grid or density) and SCALAR (read as n or bandwidth), so a
 * field one layer draws and another reads out says what each role lost.
 */
export type ViolinNotes = Map<string, [code: Code, field: string, rows: Uint8Array]>;
export const OUTLINE = 1, SCALAR = 2;

/**
 * One report from a role mask (see ViolinNotes): the full count of distinct source rows, the first ten of them
 * ascending, and the outcome of the roles that faulted. Only a field in both roles gives per-role counts, since
 * its rows need not lose both.
 */
export function violinReport(field: string, mask: Uint8Array) {
  const rows: number[] = [];
  let count = 0, outline = 0, scalar = 0;
  for (let r = 0; r < mask.length; r++) {
    const roles = mask[r]!;
    if (!roles) continue;
    if (count++ < 10) rows.push(r);
    if (roles & OUTLINE) outline++;
    if (roles & SCALAR) scalar++;
  }
  const outcome = !scalar ? NOT_DRAWN : !outline ? `Those rows' ${field} is not read out.`
    : `Density outlines are not drawn for ${outline} of those rows and ${field} is not read out for ${scalar}; their summaries stay in tooltip and table.`;
  return { field, count, rows, outcome };
}

/**
 * One omission per code and field from the pooled notes. Layers that read the same payload field so give one
 * report, not one each (the sink would add their counts and append their rows).
 */
export function flushViolin(notes: ViolinNotes, issues: OptionIssue[], grids?: ReadonlySet<unknown>): void {
  for (const [code, field, mask] of notes.values()) {
    if (code === 'AX106' && grids?.has(field)) continue;
    issues.push({ code, ...violinReport(field, mask), effect: 'omitted' });
  }
}

/**
 * Reads the per-row payload into typed arrays. A row is drawn only when its grid and density are lists of equal
 * length >= 2 of finite numbers, the grid strictly increasing and the density >= 0. Everything else is reported on
 * the field at fault, with its source rows, as an omission: absent cells AX102, non-finite numbers AX103, other
 * malformed cells AX106 (on the grid, marked in `empty` for normalizeCartesian). The rows are the source rows (the x column's length, or the data's row count), so a
 * payload whose columns are absent altogether is reported too. An empty pair is violinData()'s encoding of a group
 * with no finite value (n 0, NaN summary, already silent no data), so its n of 0 and NaN bandwidth are not reported;
 * on a row with a positive n or a median the chart reads it is reported by normalizeCartesian (`empty`).
 * Otherwise n must be a positive integer and bandwidth a finite number > 0 when given; an absent
 * (undefined or null) n or bandwidth is optional and read out as missing.
 */
export function readViolin(
  data: unknown, xName: string | null, names: readonly [grid: string, density: string, n: string, bandwidth: string], inner: boolean,
  issues: OptionIssue[], notes?: ViolinNotes,
): ViolinColumns {
  const rows = Array.isArray(data) ? data : null;
  const columns = !rows && isObj(data) && isObj(data.columns) ? data.columns : null;
  const lengthOf = (name: string | null) => name !== null && isList(columns?.[name]) ? columns[name].length : 0;
  const len = rows ? rows.length : Math.max(lengthOf(xName), ...names.map(lengthOf));
  const has = (name: string) => rows ? rows.some(r => isObj(r) && r[name] != null) : columns?.[name] !== undefined;
  const at = (name: string, r: number): unknown => rows ? (isObj(rows[r]) ? rows[r][name] : undefined) : isList(columns?.[name]) ? columns[name][r] : undefined;
  const [gridName, densityName, nName, bwName] = names;
  const start = new Uint32Array(len + 1), empty = new Uint8Array(len);
  const pool: ViolinNotes = notes ?? new Map();
  const note = (code: Code, field: string, r: number, role = OUTLINE) => {
    let entry = pool.get(code + field);
    if (!entry || entry[2].length < len) {
      const rows = new Uint8Array(len);
      if (entry) rows.set(entry[2]);
      pool.set(code + field, entry = [code, field, rows]);
    }
    entry[2][r]! |= role;
  };
  /** The first problem of one list cell, or null. */
  const check = (v: ArrayLike<unknown>, ok: (x: number, k: number) => boolean): Code | null => {
    for (let k = 0; k < v.length; k++) {
      const x = v[k];
      if (typeof x !== 'number') return 'AX106';
      if (!Number.isFinite(x)) return 'AX103';
      if (!ok(x, k)) return 'AX106';
    }
    return null;
  };
  // First pass: check each row, size the CSR slices.
  let total = 0;
  for (let r = 0; r < len; r++) {
    start[r] = total;
    const g = at(gridName, r), d = at(densityName, r);
    let bad = false;
    for (const [v, name] of [[g, gridName], [d, densityName]] as const) {
      if (v == null) note('AX102', name, r);
      else if (!isList(v)) name === gridName ? empty[r] = 2 : note('AX106', name, r);
      else continue;
      bad = true;
    }
    if (bad) continue;
    const gl = (g as ArrayLike<unknown>).length, dl = (d as ArrayLike<unknown>).length;
    if (!gl && !dl) {
      // violinData()'s encoding of a group with no finite value. A positive n says there was data, so it is reported
      // now; otherwise only a median the chart reads makes it malformed, which normalizeCartesian decides (the mask).
      empty[r] = (at(nName, r) as number) > 0 ? 2 : 1;
      continue;
    }
    if (gl === 1) { empty[r] = 2; continue; }
    if (gl !== dl) { note('AX106', densityName, r); continue; }
    const gp = check(g as ArrayLike<unknown>, (x, k) => !k || x > ((g as ArrayLike<number>)[k - 1]!));
    const dp = check(d as ArrayLike<unknown>, x => x >= 0);
    if (gp) gp === 'AX106' ? empty[r] = 2 : note(gp, gridName, r);
    if (dp) note(dp, densityName, r);
    if (!gp && !dp) total += gl;
  }
  start[len] = total;
  const grid = new Float64Array(total), density = new Float64Array(total);
  let o = 0, peak = 0;
  for (let r = 0; r < len; r++) {
    // A row is kept exactly when the first pass sized it: the next offset moved past it.
    const size = start[r + 1]! - start[r]!;
    if (!size) continue;
    const g = at(gridName, r) as ArrayLike<number>, d = at(densityName, r) as ArrayLike<number>;
    for (let k = 0; k < size; k++, o++) {
      grid[o] = g[k]!;
      density[o] = d[k]!;
      if (d[k]! > peak) peak = d[k]!;
    }
  }
  /** n (count) or bandwidth per source row; NaN where absent, malformed (reported) or an empty group's own value. */
  const scalar = (name: string, ok: (v: number) => boolean, none: (v: number) => boolean): Float64Array | null => {
    if (!has(name)) return null;
    const out = new Float64Array(len).fill(NaN);
    for (let r = 0; r < len; r++) {
      const v = at(name, r);
      if (v == null || (empty[r] === 1 && typeof v === 'number' && none(v))) continue;
      if (typeof v === 'number' && ok(v)) out[r] = v;
      else note(typeof v === 'number' && !Number.isFinite(v) ? 'AX103' : 'AX106', name, r, SCALAR);
    }
    return out;
  };
  const n = scalar(nName, v => Number.isInteger(v) && v > 0, v => v === 0 || v !== v);
  const bandwidth = scalar(bwName, v => v > 0 && v < Infinity, v => v !== v);
  // Without a shared pool (one layer read on its own) the notes are this layer's.
  if (!notes) flushViolin(pool, issues);
  return { key: JSON.stringify([names, inner]), inner, start, empty, field: gridName, grid, density, n, bandwidth, peak, notes: notes ?? null };
}

/** Drawn pixels stay within this of the plot; keeps Float32 coordinates finite for grids far outside a pinned domain. */
const FAR = 1e6;

/**
 * The pixel geometry of one violin layer, bound once and shared by scene, pick and anchor. `half` is the widest
 * half width (at the layer's peak density); the inner box is a quarter of it. `outline` and `box` give exact
 * pixels; `visible` and `shown` cut them to the plot's vertical span, which is all the plot paints of them, so
 * pick and anchor never land on a part clipped away (a violin whose grid lies past a pinned y domain).
 */
export function projectViolin(
  mark: LogicalMark, physical: PhysicalView, index: number, projection: Exclude<Projection, { kind: 'ring' }>, plot: Rect, half: number,
) {
  const v = mark.violin, rows = physical.rows?.[index];
  if (!v || !rows) return null;
  const scale = axisScaleOf(projection, mark.axisIndex);
  const series = (role: PartRole) => physical.frame.series[partIndex(mark, physical, index, role)];
  const parts = (['median', 'min', 'q1', 'q3', 'max'] as const).map(series);
  if (parts.some(p => !p)) return null;
  const [centre, min, q1, q3, max] = parts as NonNullable<(typeof parts)[number]>[];
  const py = (value: number) => position(scale, value);
  const top = plot.y, bottom = plot.y + plot.height;
  const inner = Math.max(1.5, half / 4);
  /** Visit slot i's outline as (half width, grid value) from the lowest grid value up; returns the vertex count. */
  const outline = (i: number, visit?: (w: number, y: number) => void): number => {
    const r = centre!.row ? centre!.row[i]! : i;
    if (!(r >= 0) || r + 1 >= v.start.length) return 0;
    const from = v.start[r]!, to = v.start[r + 1]!;
    if (visit) for (let k = from; k < to; k++) visit(v.peak > 0 ? half * (v.density[k]! / v.peak) : 0, v.grid[k]!);
    return to - from;
  };
  /**
   * The outline of slot i cut to [top − margin, bottom + margin] (it is monotone in y, so each edge is crossed once);
   * returns the count. The scene draws it with a margin of FAR, so its cut ends lie off the plot, and pick and anchor
   * read it with none: each is the same segments cut at exact crossings, so they agree on what the plot shows.
   * The cut is made on data values (logs on a log axis), where the scale is affine: a grid far past a pinned domain
   * maps to pixels that overflow or are clamped, so a crossing found from them would be Infinity / Infinity or off.
   * Only values inside the cut are projected; halves keep the differences of values near ±Number.MAX_VALUE finite.
   */
  const visible = (i: number, visit: (w: number, y: number) => void, margin = 0): number => {
    const t = scale.type === 'log' ? Math.log : (x: number) => x;
    let lo: [number, number] = [t(scale.invert(top - margin)), top - margin], hi: [number, number] = [t(scale.invert(bottom + margin)), bottom + margin];
    if (lo[0] > hi[0]) [lo, hi] = [hi, lo];
    // A scale that inverts to no value (an empty range) cuts nothing away.
    if (!(lo[0] <= hi[0])) lo[0] = -Infinity, hi[0] = Infinity;
    let w0 = 0, s0 = NaN, count = 0;
    const emit = (w: number, y: number) => { visit(w, y); count++; };
    outline(i, (w, g) => {
      const s = t(g);
      for (const [e, y] of s < s0 ? [hi, lo] : [lo, hi]) if (s0 < e ? e < s : s < e && e < s0) emit(w0 + (Math.min(1, (e / 2 - s0 / 2) / (s / 2 - s0 / 2)) || 0) * (w - w0), y);
      if (s >= lo[0] && s <= hi[0]) emit(w, py(g));
      w0 = w; s0 = s;
    });
    return count;
  };
  /** Inner box pixels of slot i: [Q3 top, Q1 bottom, max, min, median]. */
  const box = (i: number) => [py(Math.max(q1!.y[i]!, q3!.y[i]!)), py(Math.min(q1!.y[i]!, q3!.y[i]!)), py(max!.y[i]!), py(min!.y[i]!), py(centre!.y[i]!)] as const;
  /** The inner box's [top, bottom] and whisker's [top, bottom] cut to the plot; an empty span (top > bottom) is not shown. */
  const shown = (i: number) => {
    const [t, b, hi, lo] = box(i), cut = (y: number) => y < top ? top : y > bottom ? bottom : y;
    return [Math.max(t, top), Math.min(b, bottom), cut(Math.min(hi, lo)), cut(Math.max(hi, lo)), Math.min(hi, lo) <= bottom && Math.max(hi, lo) >= top] as const;
  };
  return { rows, half, inner, outline, visible, box, shown, plot, drawsInner: v.inner };
}

export type ViolinGeometry = NonNullable<ReturnType<typeof projectViolin>>;

const seg = (out: number[], x1: number, y1: number, x2: number, y2: number) => { out.push(x1, y1, x2, y2, NaN, NaN); };

/** Scene marks of one violin layer over the visible slots: filled outlines, their strokes, then the inner box. */
export function violinMarks(index: number, g: ViolinGeometry, start: number, end: number, xAt: (i: number) => number): Mark[] {
  const { y, height } = g.plot, far = (p: number) => p < y - FAR ? y - FAR : p > y + height + FAR ? y + height + FAR : p;
  let count = 0, polys = 0;
  const cut = (i: number, visit: (w: number, y: number) => void = () => {}) => g.visible(i, visit, FAR);
  for (let i = start; i < end; i++) if (g.rows[i] === SLOT_VALUE && cut(i) > 1) { count += cut(i); polys++; }
  const upper = new Float32Array(2 * count), lower = new Float32Array(2 * count), runs = new Uint32Array(4 * polys);
  const edge = new Float32Array(2 * (2 * count + 2 * polys));
  const rects: number[] = [], whiskers: number[] = [], medians: number[] = [];
  let v = 0, p = 0, e = 0;
  for (let i = start; i < end; i++) {
    if (g.rows[i] !== SLOT_VALUE) continue;
    const x = xAt(i);
    const n = cut(i);
    if (n > 1) {
      runs.set([v, n, v, n], 4 * p++);
      const first = v;
      cut(i, (w, py) => { upper[2 * v] = x + w; lower[2 * v] = x - w; upper[2 * v + 1] = lower[2 * v + 1] = py; v++; });
      // The stroke runs up the right edge, down the left one and closes, then a NaN breaks to the next violin.
      for (let k = first; k < v; k++) { edge[e++] = upper[2 * k]!; edge[e++] = upper[2 * k + 1]!; }
      for (let k = v - 1; k >= first; k--) { edge[e++] = lower[2 * k]!; edge[e++] = lower[2 * k + 1]!; }
      edge[e++] = upper[2 * first]!; edge[e++] = upper[2 * first + 1]!;
      edge[e++] = NaN; edge[e++] = NaN;
    }
    if (g.drawsInner) {
      const [top, bottom, hi, lo, mid] = g.box(i).map(far);
      seg(whiskers, x, hi!, x, lo!);
      rects.push(x - g.inner, top!, 2 * g.inner, Math.max(1, bottom! - top!));
      seg(medians, x - g.inner, mid!, x + g.inner, mid!);
    }
  }
  const paint = seriesPaint(index), out: Mark[] = [];
  const solid = { normal: null, contrast: null } as const;
  if (p) {
    out.push({ type: 'area', series: index, upper, lower, runs, fill: paint, opacity: 0.3 } satisfies AreaMark);
    out.push({ type: 'path', series: index, xy: edge.subarray(0, e - 2), stroke: paint, strokeWidth: 1.5, dash: solid });
  }
  if (rects.length) {
    out.push({ type: 'path', series: index, xy: Float32Array.from(whiskers), stroke: paint, strokeWidth: WHISKER_WIDTH, dash: solid });
    out.push({ type: 'rects', series: index, xywh: Float32Array.from(rects), fill: paint, variant: 'bar' });
    out.push({ type: 'path', series: index, xy: Float32Array.from(medians), stroke: token('background'), strokeWidth: MEDIAN_WIDTH, dash: solid });
  }
  return out;
}

const segDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const t = l > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0;
  return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
};
const spanDist = (p: number, lo: number, hi: number) => p < lo ? lo - p : p > hi ? p - hi : 0;

/**
 * Distance from (qx, qy) to what the plot shows of the violin of slot i centred at x: 0 inside its outline or inner
 * box. The outline is symmetric, so the pointer is mirrored onto the right half and measured to the right edge and
 * the two end caps, all cut to the plot's vertical span; and never nearer than the shown box (`violinBox`), which
 * also cuts it to the plot's horizontal span. Infinity when nothing of it is shown.
 */
export function violinDistance(g: ViolinGeometry, i: number, x: number, qx: number, qy: number): number {
  const shown = violinBox(g, i, x);
  if (!shown) return Infinity;
  const dx = Math.abs(qx - x);
  let best = Infinity, w0 = 0, y0 = 0, k = 0, inside = false;
  g.visible(i, (w, y) => {
    if (k === 0) best = segDist(dx, qy, 0, y, w, y);
    else {
      if ((qy - y0) * (qy - y) <= 0 && y !== y0 && dx <= w0 + ((qy - y0) / (y - y0)) * (w - w0)) inside = true;
      best = Math.min(best, segDist(dx, qy, w0, y0, w, y));
    }
    w0 = w; y0 = y; k++;
  });
  if (k > 1) best = Math.min(best, segDist(dx, qy, 0, y0, w0, y0));
  if (inside) best = 0;
  if (g.drawsInner) {
    const [top, bottom, hi, lo, whisker] = g.shown(i);
    if (top <= bottom) best = Math.min(best, Math.hypot(spanDist(dx, 0, g.inner), spanDist(qy, top, bottom)));
    if (whisker) best = Math.min(best, Math.hypot(spanDist(dx, 0, WHISKER_WIDTH / 2), spanDist(qy, hi, lo)));
  }
  return Math.max(best, Math.hypot(spanDist(qx, shown.x, shown.x + shown.width), spanDist(qy, shown.y, shown.y + shown.height)));
}

/** The box of what the plot shows of the violin of slot i (outline and inner box, cut to the plot), or null. */
export function violinBox(g: ViolinGeometry, i: number, x: number): Rect | null {
  let w = 0, top = Infinity, bottom = -Infinity;
  const add = (half: number, y: number) => { if (half > w) w = half; if (y < top) top = y; if (y > bottom) bottom = y; };
  if (g.outline(i) > 1) g.visible(i, add);
  if (g.drawsInner) {
    const [t, b, hi, lo, whisker] = g.shown(i);
    if (t <= b) { add(g.inner, t); add(g.inner, b); }
    if (whisker) { add(WHISKER_WIDTH / 2, hi); add(WHISKER_WIDTH / 2, lo); }
  }
  const { x: left, width } = g.plot, x0 = Math.max(x - w, left), x1 = Math.min(x + w, left + width);
  return top <= bottom && x0 <= x1 ? { x: x0, y: top, width: x1 - x0, height: Math.max(1, bottom - top) } : null;
}

/**
 * The readings of one violin at slot i, in reading order: median, n, IQR (Q1 – Q3), min, max, bandwidth. Tooltip,
 * keyboard reading and table all format through this one list (`cell` is the carriers' own value formatter).
 */
export function violinCells(
  mark: LogicalMark, physical: PhysicalView, index: number, slot: number, cell: (part: number, slot: number) => string, formatters: Formatters,
): [word: string, text: string][] {
  const v = mark.violin!;
  const at = (role: PartRole) => cell(partIndex(mark, physical, index, role), slot);
  const centre = physical.frame.series[partIndex(mark, physical, index, 'median')];
  const r = centre?.row ? centre.row[slot]! : slot;
  const scalar = (column: Float64Array | null, text: (n: number) => string) => {
    const value = column && r >= 0 ? column[r]! : NaN;
    return Number.isFinite(value) ? text(value) : formatters.missing(SLOT_NULL);
  };
  const text = (word: string) => word === 'n' ? scalar(v.n, formatters.count)
    : word === 'IQR' ? `${at('q1')} – ${at('q3')}`
    : word === 'bandwidth' ? scalar(v.bandwidth, b => formatters.value(partIndex(mark, physical, index, 'median'), b))
    : at(word as PartRole);
  return violinWords(v).map(word => [word, text(word)]);
}

/** Reading order of a violin's values; n and bandwidth only when the data has those fields. */
export const violinWords = (v: ViolinColumns): string[] =>
  ['median', ...(v.n ? ['n'] : []), 'IQR', 'min', 'max', ...(v.bandwidth ? ['bandwidth'] : [])];

/** "median 5 (n 40, IQR 3 – 7, min 1, max 9, bandwidth 0.8)" */
export const violinText = (cells: readonly [string, string][]) =>
  `${cells[0]![0]} ${cells[0]![1]} (${cells.slice(1).map(([w, t]) => `${w} ${t}`).join(', ')})`;

/** Grid values a visible violin draws in the window, so its axis fits the tails as well as the five numbers. */
export function visitViolinGrid(mark: LogicalMark, row: Int32Array | null, slot: number, include: (v: number) => void): void {
  const v = mark.violin;
  if (!v) return;
  const r = row ? row[slot]! : slot;
  if (!(r >= 0) || r + 1 >= v.start.length) return;
  const from = v.start[r]!, to = v.start[r + 1]!;
  if (to - from > 1) { include(v.grid[from]!); include(v.grid[to - 1]!); }
}
