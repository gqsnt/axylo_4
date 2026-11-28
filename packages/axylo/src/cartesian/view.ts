/**
 * View stage for `axylo/cartesian` (C4.3, RFC §2.2, §4.4, §5.1).
 * Builds the `AlignedView` directly (avoiding `src/view/index.ts` single-axis extrema/stack/donut code),
 * computes per-axis domains independently via `computeAxisDomain`, and publishes one series per logical mark.
 */
import {
  SLOT_NO_ROW, SLOT_VALUE, type AlignedFrame, type AlignedView, type DiagnosticSink, type IndexRange,
  type Series, type MarkerShape, type ResolvedReference, type SeriesCue,
} from '../core/contracts';
import { lowerBound, upperBound } from '../data/search';
import { mixedSlots } from './dense';
import { report } from '../diagnostics';
import type { AlignedViewState } from '../view';
import { positionReader, readSpan, resolveReferences, type Span } from '../view/references';
import { validateCartesianAnnotations } from './annotations';
import { computeAxisDomain } from './axes';
import { repeatsOf, visitRepeats } from './repeats';
import { BOX_ROLES, compoundRows, isCompoundKind, isLogSeries, logicalOf, visitOutliers, physicalOf, registerPhysical, type LogicalMark } from './boxplot';
import { reportCartesian } from './diagnostics';
import { visitViolinGrid } from './violin';
import type { CartesianMeta, CartesianStateRef } from './meta';

const SHAPES: readonly MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star'];
const DASHES: readonly SeriesCue['dash']['contrast'][] = [
  null, [12, 5], [5, 4], [1, 5], [9, 4, 1, 4], [9, 4, 1, 4, 1, 4], [12, 4, 5, 4], [1, 2],
];

function buildCues(count: number, compact: boolean, prev: AlignedView | undefined, sink: DiagnosticSink): readonly SeriesCue[] {
  if (count > 8 && (prev?.cues.length ?? 0) <= 8) report(sink, 'AX130', 'none');
  if (compact && count > 1 && !(prev?.compact && prev.cues.length > 1)) report(sink, 'AX131', 'none');
  if (prev?.compact === compact && prev.cues.length === count) return prev.cues;
  return Array.from({ length: count }, (_, i) => {
    const contrast = DASHES[i % 8]!;
    return { marker: SHAPES[(i + Math.floor(i / 8)) % 8]!,
      dash: { normal: i >= 8 ? [2 + i, 3] : compact ? contrast : null, contrast } };
  });
}

function fitZoom(full: Span, zoom: Span | null): Span {
  if (!zoom) return full;
  const [low, high] = full, [start, end] = zoom;
  if (start >= low && end <= high) return zoom;
  const w = end - start, ov = !Number.isFinite(w), hw = end / 2 - start / 2;
  if (ov ? hw >= high / 2 - low / 2 : w >= high - low) return full;
  if (start < low) {
    const s = ov ? (low / 2 + hw) * 2 : low + w;
    return s > low ? [low, Math.min(high, s)] : full;
  }
  const s = ov ? (high / 2 - hw) * 2 : high - w;
  return s < high ? [Math.max(low, s), high] : full;
}

function drawRangeOf(slot: Uint8Array | null, len: number, range: IndexRange): IndexRange {
  const { start, end } = range;
  const seek = (from: number, stop: number, step: number) => {
    while (from !== stop && slot?.[from] === SLOT_NO_ROW) from += step;
    return from;
  };
  const first = seek(start, end, 1), empty = first === end;
  const extend = (at: number, inner: number, step: number, stop: number) => {
    if (!empty && slot && slot[inner] !== SLOT_VALUE) return at;
    const outer = seek(at + step, stop, step);
    return outer === stop || (slot && slot[outer] !== SLOT_VALUE) ? at : outer;
  };
  const left = extend(start, first, -1, -1);
  const right = extend(end - 1, empty ? end : seek(end - 1, start - 1, -1), 1, len) + 1;
  return empty && (left === start || right === end) ? range : { start: left, end: right };
}

function resolveCartesianReferences(baseRefs: readonly ResolvedReference[], meta: CartesianMeta): readonly ResolvedReference[] {
  if (!baseRefs.length || !meta.references.length) return baseRefs;
  const ySpecs = meta.references.filter(r => r.axis === 'y');
  return baseRefs.map(ref => {
    if (ref.axis !== 'y') return ref;
    const i = ySpecs.findIndex(s => s.label === ref.label && Number.isFinite(s.from) && Number.isFinite(s.to)
      && Object.is(Math.min(s.from as number, s.to as number), ref.from) && Object.is(Math.max(s.from as number, s.to as number), ref.to));
    const spec = i >= 0 ? ySpecs.splice(i, 1)[0] : undefined;
    return { ...ref, axisId: spec?.axisId ?? meta.leftAxisId };
  });
}

function logicalParts(frame: AlignedFrame, marks: readonly LogicalMark[]): Int32Array[] | null {
  if (marks.length > frame.series.length) return null;
  const index = new Map(frame.series.map((s, i) => [s.field, i]));
  const parts = marks.map(m => Int32Array.from(m.fields, field => index.get(field) ?? -1));
  return parts.every((p, i) => p[0] === i) ? parts : null;
}

interface CompoundFit {
  meta: CartesianMeta;
  parts: Int32Array[] | null;
  rows: (Uint8Array | null)[];
  fit: AlignedFrame;
}

let compound: WeakMap<AlignedFrame, CompoundFit> | undefined;

function compoundFit(frame: AlignedFrame, marks: readonly LogicalMark[], meta: CartesianMeta) {
  const cache = compound ??= new WeakMap<AlignedFrame, CompoundFit>();
  const known = cache.get(frame);
  if (known?.meta === meta) return known;
  const parts = logicalParts(frame, marks);
  let series: Series[] | undefined;
  const rows = parts?.map((idx, i) => {
    const mark = marks[i]!;
    if (!isCompoundKind(mark.kind)) return null;
    const centre = mark.kind === 'errorBar' && mark.roles[0] === 'y';
    const needed = Array.from(centre ? idx.subarray(1) : idx, p => frame.series[p]!);
    if (needed.some(c => !c)) return null;
    const maskOf = (columns: Series[]) => compoundRows(columns, meta.axisById.get(mark.axisId)?.scale === 'log', frame.length);
    const mask = maskOf(needed);
    const out = series ??= frame.series.slice();
    idx.forEach((p, k) => {
      if (p >= 0) out[p] = { ...frame.series[p]!, slot: centre && k === 0 ? maskOf([...needed, frame.series[p]!]) : mask };
    });
    return mask;
  }) ?? [];
  const result = { meta, parts, rows, fit: series ? { ...frame, series } : frame };
  cache.set(frame, result);
  return result;
}

export function buildCartesianView(
  stateRef: CartesianStateRef,
  frame: AlignedFrame,
  state: AlignedViewState,
  sink: DiagnosticSink,
): AlignedView {
  const { meta } = stateRef;
  const marks = logicalOf(meta).marks;
  const fit = compoundFit(frame, marks, meta), { parts } = fit;
  const L = parts?.length ?? frame.series.length;
  const prior = state.previous?.kind === state.kind ? state.previous as AlignedView : undefined;
  const compact = state.compact ?? false;
  const readX = positionReader(frame.x, state.xField);
  const references = resolveCartesianReferences(compact || !state.references?.length ? [] : resolveReferences(state.references, readX, frame.x.kind, sink), meta);
  let xMin = frame.x.values[0] ?? Infinity, xMax = frame.x.values[frame.length - 1] ?? -Infinity;
  for (const r of references) if (r.axis === 'x') { xMin = Math.min(xMin, r.from); xMax = Math.max(xMax, r.to); }
  const author = readSpan(state.xDomain === undefined ? state.xField?.domain : state.xDomain, readX, 'x.domain', sink);
  // Same-frame updates (a legend toggle, a hover) keep the previous spans and slot windows by identity, as the
  // base aligned view does, so the scene and lookup reuse their warm draw-window work.
  // physicalOf gives the frame a projected view was built from when no axis failed (otherwise no reuse).
  const same = prior !== undefined && physicalOf(prior).frame === frame;
  const keepSpan = (next: Span, old: Span | undefined): Span => old && old[0] === next[0] && old[1] === next[1] ? old : next;
  const xFull = keepSpan(author ?? (xMin <= xMax ? [xMin, xMax] : frame.x.kind === 'category' ? [0, 0] : [0, 1]), prior?.xFull);
  const zoomed = fitZoom(xFull, compact ? null : readSpan(state.zoom, readX, 'zoom', sink, true));
  const xDomain = keepSpan(zoomed, zoomed[0] === xFull[0] && zoomed[1] === xFull[1] ? xFull : prior?.xDomain);
  const xv = frame.x.values;
  const visibleSlots: IndexRange = same && prior.xDomain === xDomain ? prior.visibleSlots : {
    start: xDomain[0] <= xv[0]! ? 0 : lowerBound(xv, xDomain[0]),
    end: xDomain[1] >= xv[xv.length - 1]! ? xv.length : upperBound(xv, xDomain[1]),
  };
  const noOverscan = frame.x.kind === 'category' || xDomain[0] === xDomain[1];
  const drawSlots = same && prior.visibleSlots === visibleSlots && prior.drawSlots.length === L ? prior.drawSlots
    : frame.series.slice(0, L).map(s => noOverscan ? visibleSlots : drawRangeOf(mixedSlots(s), frame.length, visibleSlots));
  const cues = buildCues(L, compact, prior, sink);
  const visible = frame.series.map(s => s.drawable && !state.hidden?.has(s.key));
  const baseView: AlignedView = {
    kind: state.kind, frame, compact, horizontal: false, stack: null, revision: frame.revision,
    visible, cues, references, xFull, xDomain, visibleSlots, drawSlots, yDomain: [0, 1],
  };
  validateCartesianAnnotations(baseView, meta, sink);

  const extents: ResolvedReference[] = [];
  /** Extra values drawn in the visible window (box outliers, repeated scatter rows) fit their axis like data. */
  const widen = (log: boolean, axisId: string | undefined, each: (slot: number, include: (v: number) => void) => void) => {
    let lo = Infinity, hi = -Infinity;
    const include = (v: number) => {
      if (log && !(v > 0)) return;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    };
    for (let j = visibleSlots.start; j < visibleSlots.end; j++) each(j, include);
    if (lo <= hi) extents.push({ axis: 'y', from: lo, to: hi, label: '', axisId });
  };
  if (parts) {
    parts.forEach((p, i) => {
      for (let k = 1; k < p.length; k++) if (p[k]! >= 0) visible[p[k]!] = visible[i]!;
      const m = marks[i]!;
      if (m.kind !== 'boxplot' && m.kind !== 'violin') return;
      // Report unordered box five-numbers (AX176).
      const cols = BOX_ROLES.map(role => frame.series[p[m.roles.indexOf(role)]!]);
      if (!cols.some(c => !c)) {
        let count = 0;
        const rows: number[] = [];
        for (let j = 0; j < frame.length; j++) {
          if (cols.some(c => c!.slot[j] !== SLOT_VALUE)) continue;
          if (!cols.some((c,k) => k > 0 && cols[k - 1]!.y[j]! > c!.y[j]!)) continue;
          count++;
          const row = cols[2]!.row?.[j] ?? j;
          if (rows.length < 10 && row >= 0) rows.push(row);
        }
        if (count > 0) reportCartesian(sink, 'AX176', 'none', { field: m.label, rows: rows.length ? rows : undefined, count });
      }
      const mask = fit.rows[i];
      // A visible violin's drawn grid widens its (linear) axis in the visible window, as box outliers do below.
      if (m.violin && mask && visible[i]) {
        const row = frame.series[p[0]!]!.row;
        widen(false, m.axisId, (j, include) => { if (mask[j] === SLOT_VALUE) visitViolinGrid(m, row, j, include); });
      }
      if (!m.outliers || !mask) return;
      const rep = frame.series[p[0]!]!, log = meta.axisById.get(m.axisId)?.scale === 'log';
      if (log) {
        let nonPos = 0;
        const check = (v: number) => { if (!(v > 0)) nonPos++; };
        for (let j = 0; j < frame.length; j++) if (rep.slot[j] !== SLOT_NO_ROW) visitOutliers(m.outliers, rep.row, j, check);
        if (nonPos) reportCartesian(sink, 'AX171', 'omitted', { field: m.outliers.field, count: nonPos });
      }
      // Visible boxplot outliers widen their axis domain in the visible window.
      if (visible[i]) widen(log, m.axisId, (j, include) => { if (mask[j] === SLOT_VALUE) visitOutliers(m.outliers, rep.row, j, include); });
    });
  }
  // Scatter rows that repeat an x widen their axis in the visible window as the slot's own row does.
  frame.series.forEach((s, i) => {
    const more = visible[i] ? repeatsOf(s) : null;
    if (more) widen(isLogSeries(meta, s), s.axisId, (j, include) => { visitRepeats(more, j, include); });
  });
  const fitted = extents.length ? [...references, ...extents] : references;

  const yAxisIds = meta.axes.map(axis => axis.id);
  const erroredAxes = new Set<string>();
  const yDomains = meta.axes.map(axis => {
    const res = computeAxisDomain(fit.fit, visible, visibleSlots, axis, fitted, meta, sink);
    if (res.error) erroredAxes.add(axis.id);
    return res.domain;
  });

  let nextFrame = frame;
  if (erroredAxes.size > 0 || meta.invalid) {
    nextFrame = {
      ...frame,
      series: frame.series.map(s => {
        if (!meta.invalid && !(s.axisId && erroredAxes.has(s.axisId))) {
          if (!isLogSeries(meta, s)) return s;
          const slot = mixedSlots(s);
          if (s.y.some((v, i) => v > 0 && (!slot || slot[i] === SLOT_VALUE))) return s;
        }
        return { ...s, drawable: false };
      }),
    };
  }

  const common = { yDomain: yDomains[0] ?? ([0, 1] as Span), yDomains, yAxisIds, references };
  if (!parts || L === frame.series.length) return { ...baseView, frame: nextFrame, ...common };

  const series = nextFrame.series.slice(0, L).map((s, i) => {
    const m = marks[i]!;
    const needed = m.kind === 'errorBar' && m.roles[0] === 'y' ? parts[i]!.subarray(1) : parts[i]!;
    const drawable = needed.every(p => nextFrame.series[p]?.drawable);
    return drawable === s.drawable ? s : { ...s, drawable };
  });
  const published: AlignedFrame = { ...nextFrame, series };
  registerPhysical(published, { frame: nextFrame, visible, parts, rows: fit.rows });
  return { ...baseView, frame: published, visible: visible.slice(0, L), ...common };
}
