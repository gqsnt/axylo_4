/**
 * Per-axis domain calculation and tick candidate generation for `axylo/cartesian` (C4.2, RFC §4 & §5).
 * Keeps linear and log rules strictly per-axis (zero baseline only on linear axes with bar/area layers;
 * positive-only domains and full-data zoom fallback on log axes).
 */
import {
  SLOT_VALUE, type AlignedFrame, type DiagnosticSink, type IndexRange, type ResolvedReference,
  type TickCandidates,
} from '../core/contracts';
import { createNumberTickLabeler, type NumberFormatOption } from '../format';
import { report } from '../diagnostics/registry';
import { valueDomain } from '../scale/domain';
import { linearTickCandidates, type TickLabeler } from '../scale/linear';
import {
  isValidLogBase, isValidLogDomain, logTickCandidates, niceLogDomain, type Span,
} from '../scale/log';
import { reportCartesian } from './diagnostics';
import type { CartesianAxisSpec, CartesianMeta } from './meta';

export interface AxisDomainResult {
  readonly domain: Span;
  readonly hasPositive: boolean;
  readonly error: boolean;
}

export interface TickFailureTracker {
  readonly failedValues: Set<number>;
  drawn(ticks: readonly { readonly value: number }[]): boolean;
}

export function createTickFailureTracker(): TickFailureTracker {
  const failedValues = new Set<number>();
  return {
    failedValues,
    drawn(ticks) {
      if (failedValues.size === 0) return false;
      for (const t of ticks) if (failedValues.has(t.value)) return true;
      return false;
    },
  };
}

function positiveExtremaInRange(
  frame: AlignedFrame,
  seriesIndexes: readonly number[],
  range: IndexRange,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const sIdx of seriesIndexes) {
    const s = frame.series[sIdx];
    if (!s) continue;
    const { y, slot } = s;
    for (let i = range.start; i < range.end; i++) {
      if (slot[i] !== SLOT_VALUE) continue;
      const v = y[i]!;
      if (v > 0 && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  return min <= max ? [min, max] : null;
}

function linearExtremaInRange(
  frame: AlignedFrame,
  seriesIndexes: readonly number[],
  range: IndexRange,
  meta: CartesianMeta,
): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  const stackedIndexes: number[] = [];
  const plainIndexes: number[] = [];
  for (const sIdx of seriesIndexes) {
    const s = frame.series[sIdx];
    if (!s) continue;
    const spec = meta.seriesByField.get(s.field);
    if (spec?.stacked && (spec.mark === 'bar' || spec.mark === 'area')) stackedIndexes.push(sIdx);
    else plainIndexes.push(sIdx);
  }
  for (const sIdx of plainIndexes) {
    const s = frame.series[sIdx]!;
    const { y, slot } = s;
    for (let i = range.start; i < range.end; i++) {
      if (slot[i] !== SLOT_VALUE) continue;
      const v = y[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (stackedIndexes.length > 0) {
    for (let i = range.start; i < range.end; i++) {
      let pos = 0;
      let neg = 0;
      let any = false;
      for (const sIdx of stackedIndexes) {
        const s = frame.series[sIdx]!;
        if (s.slot[i] !== SLOT_VALUE) continue;
        const v = s.y[i]!;
        any = true;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (any) {
        if (pos > max) max = pos;
        if (neg < min) min = neg;
        if (0 < min) min = 0;
        if (0 > max) max = 0;
      }
    }
  }
  return min <= max ? [min, max] : null;
}

function axisReferences(references: readonly ResolvedReference[], axis: CartesianAxisSpec, meta: CartesianMeta): readonly ResolvedReference[] {
  return references.filter(r => r.axis === 'y' && (r.axisId ?? meta.leftAxisId) === axis.id);
}

/**
 * Computes one axis's value domain from its bound series in `visibleSlots` (RFC C4.1 §4.3–4.4, §5.1).
 * For `'log'` axes: validates `base` & author `domain` (`AX170`), computes full-data positive fallback
 * across zoom/legend-hide, and raises `AX172` when no positive data exists anywhere on the axis.
 */
export function computeAxisDomain(
  frame: AlignedFrame,
  visible: readonly boolean[],
  visibleSlots: IndexRange,
  axis: CartesianAxisSpec,
  references: readonly ResolvedReference[],
  meta: CartesianMeta,
  sink: DiagnosticSink,
): AxisDomainResult {
  const allBound: number[] = [];
  const visibleBound: number[] = [];
  let requiresZero = false;

  for (let i = 0; i < frame.series.length; i++) {
    const s = frame.series[i]!;
    const spec = meta.seriesByField.get(s.field);
    if (!spec || spec.axisId !== axis.id) continue;
    if (spec.mark === 'bar' || spec.mark === 'area') requiresZero = true;
    allBound.push(i);
    if (visible[i] && s.drawable) visibleBound.push(i);
  }

  const refs = axisReferences(references, axis, meta);

  if (axis.scale === 'log') {
    if (axis.rawBase !== undefined && !isValidLogBase(axis.rawBase)) {
      reportCartesian(sink, 'AX170', 'chart-error', { field: axis.id, detail: `unsupported base ${String(axis.rawBase)}` });
      return { domain: [1, 10], hasPositive: false, error: true };
    }
    if (axis.rawDomain !== undefined) {
      if (!axis.domain || !isValidLogDomain(axis.domain)) {
        reportCartesian(sink, 'AX170', 'chart-error', { field: axis.id, detail: 'domain must be strictly positive [min, max] with min < max' });
        return { domain: [1, 10], hasPositive: false, error: true };
      }
      return { domain: axis.domain, hasPositive: true, error: false };
    }
    const fullRange: IndexRange = { start: 0, end: frame.length };
    const fullExt = positiveExtremaInRange(frame, allBound, fullRange);
    let fullMin = fullExt ? fullExt[0] : Infinity;
    let fullMax = fullExt ? fullExt[1] : -Infinity;
    for (const r of refs) {
      if (r.from > 0 && Number.isFinite(r.from)) { fullMin = Math.min(fullMin, r.from); fullMax = Math.max(fullMax, r.from); }
      if (r.to > 0 && Number.isFinite(r.to)) { fullMin = Math.min(fullMin, r.to); fullMax = Math.max(fullMax, r.to); }
    }
    if (!(fullMin <= fullMax)) {
      reportCartesian(sink, 'AX172', 'chart-error', { field: axis.id });
      return { domain: [1, 10], hasPositive: false, error: true };
    }
    const fullNice = niceLogDomain(fullMin, fullMax, axis.base);
    meta.fullPositiveDomains.set(axis.id, fullNice);

    // Visible (zoomed + legend-visible) positive extrema; fall back cleanly when window has no positives.
    const visExt = positiveExtremaInRange(frame, visibleBound, visibleSlots);
    let vMin = visExt ? visExt[0] : Infinity;
    let vMax = visExt ? visExt[1] : -Infinity;
    for (const r of refs) {
      if (r.from > 0 && Number.isFinite(r.from)) { vMin = Math.min(vMin, r.from); vMax = Math.max(vMax, r.from); }
      if (r.to > 0 && Number.isFinite(r.to)) { vMin = Math.min(vMin, r.to); vMax = Math.max(vMax, r.to); }
    }
    if (vMin <= vMax) {
      return { domain: niceLogDomain(vMin, vMax, axis.base), hasPositive: true, error: false };
    }
    // Zoomed window or hidden series has no positive points: fall back to full-data positive domain of visible series, else all bound series.
    const visFull = positiveExtremaInRange(frame, visibleBound, fullRange);
    const fallback = visFull ? niceLogDomain(visFull[0], visFull[1], axis.base) : fullNice;
    return { domain: fallback, hasPositive: true, error: false };
  }

  // Linear axis.
  const ext = linearExtremaInRange(frame, visibleBound, visibleSlots, meta)
    ?? linearExtremaInRange(frame, allBound, { start: 0, end: frame.length }, meta);
  let min = ext ? ext[0] : 0;
  let max = ext ? ext[1] : 1;
  for (const r of refs) {
    min = Math.min(min, r.from, r.to);
    max = Math.max(max, r.from, r.to);
  }
  if (axis.domain && !axis.domain.every(Number.isFinite)) {
    report(sink, 'AX103', 'none', { field: `${axis.id}.domain` });
  }
  const result = valueDomain({
    min,
    max,
    includeZero: requiresZero,
    authorDomain: axis.domain && axis.domain.every(Number.isFinite) ? axis.domain : null,
    valueScale: null,
  });
  if (result.widenedToZero) {
    report(sink, 'AX110', 'none', { field: axis.id });
  }
  return { domain: result.domain, hasPositive: true, error: false };
}

export function axisTickCandidates(
  domain: Span,
  axis: CartesianAxisSpec,
  locale: string,
  failures: TickFailureTracker,
): TickCandidates {
  const custom: NumberFormatOption | null = axis.tickFormat;
  const labeler: TickLabeler = custom === null
    ? createNumberTickLabeler({ locale })
    : (value, ctx) => {
        const inner = createNumberTickLabeler({
          locale,
          tickFormat: custom,
          onError: () => { failures.failedValues.add(value); },
        });
        return inner(value, ctx);
      };
  return axis.scale === 'log'
    ? logTickCandidates(domain, labeler, axis.base)
    : linearTickCandidates(domain, labeler);
}
