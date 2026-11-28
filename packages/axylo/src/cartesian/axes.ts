/**
 * Per-axis domain calculation and tick candidate generation for `axylo/cartesian` (C4.2, RFC §4 & §5).
 * Keeps linear and log rules strictly per-axis (zero baseline only on linear axes with bar/area layers;
 * positive-only domains and full-data zoom fallback on log axes).
 */
import {
  SLOT_VALUE, type AlignedFrame, type DiagnosticSink, type IndexRange, type ResolvedReference, type Series,
  type TickCandidates,
} from '../core/contracts';
import { createNumberTickLabeler, type NumberFormatOption } from '../format';
import { report } from '../diagnostics/registry';
import { fullStatistics } from '../data/store-statistics';
import { valueDomain } from '../scale/domain';
import { linearTickCandidates, type TickLabeler } from '../scale/linear';
import {
  isValidLogBase, isValidLogDomain, logTickCandidates, niceLogDomain, type Span,
} from '../scale/log';
import { extremaIndexes, mixedSlots, seriesWindows } from './dense';
import { reportCartesian } from './diagnostics';
import { repeatsOf, visitRepeats } from './repeats';
import type { CartesianAxisSpec, CartesianMeta, CartesianSeriesSpec } from './meta';

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
      return failedValues.size > 0 && ticks.some(t => failedValues.has(t.value));
    },
  };
}

const hasBaseline = (spec: CartesianSeriesSpec) => spec.mark === 'bar' || spec.mark === 'area';

/** Linear extrema keep the first observation on a tie, including its zero sign. */
function extremaInRange(
  series: readonly Series[], { start, end }: IndexRange, meta: CartesianMeta, log: boolean, whole: boolean,
): [number, number] | null {
  let min = Infinity, max = -Infinity;
  const stacked: { y: Series['y']; slot: Uint8Array | null }[] = [];
  const include = (low: number, high: number) => {
    if (low < min) min = low;
    if (high > max) max = high;
  };
  const take = (v: number) => { if (v > 0 && v < Infinity) include(v, v); };
  for (const s of series) {
    const slot = mixedSlots(s);
    const spec = meta.seriesByField.get(s.field);
    if (!log && spec?.stacked && hasBaseline(spec)) {
      stacked.push({ y: s.y, slot });
      continue;
    }
    const repeats = log ? repeatsOf(s) : null;
    if (!repeats) {
      const full = whole ? fullStatistics.get(s) : undefined;
      let low: number, high: number;
      if (full) ({ min: low, max: high } = full.ordered);
      else {
        const { y } = s;
        const [a, b] = extremaIndexes(y, slot, start, end, -1, end - start >= 512 ? seriesWindows(s, whole) : null);
        low = y[a] ?? Infinity;
        high = y[b] ?? -Infinity;
      }
      if (log && high <= 0) continue;
      if (!log || (low > 0 && high < Infinity)) {
        include(low, high);
        continue;
      }
    }
    const { y } = s;
    for (let i = start; i < end; i++) {
      if (!slot || slot[i] === SLOT_VALUE) take(y[i]!);
      if (repeats) visitRepeats(repeats, i, take);
    }
  }
  if (stacked.length) {
    for (let i = start; i < end; i++) {
      let pos = 0, neg = 0, any = false;
      for (const { y, slot } of stacked) {
        if (slot && slot[i] !== SLOT_VALUE) continue;
        const v = y[i]!;
        any = true;
        if (v >= 0) pos += v;
        else neg += v;
      }
      if (any) {
        include(neg, pos);
        include(0, 0);
      }
    }
  }
  return min <= max ? [min, max] : null;
}

const domainResult = (domain: Span, valid = true): AxisDomainResult => ({ domain, hasPositive: valid, error: !valid });

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
  const allBound: Series[] = [];
  const visibleBound: Series[] = [];
  let requiresZero = false;

  for (let i = 0; i < frame.series.length; i++) {
    const s = frame.series[i]!;
    const spec = meta.seriesByField.get(s.field);
    if (!spec || spec.axisId !== axis.id) continue;
    if (hasBaseline(spec)) requiresZero = true;
    allBound.push(s);
    if (visible[i] && s.drawable) visibleBound.push(s);
  }

  const log = axis.scale === 'log';
  const full = { start: 0, end: frame.length };
  const extrema = (series: Series[], range = full) => extremaInRange(series, range, meta, log, range.start === 0 && range.end === frame.length);
  const withReferences = ([min, max]: Span): [number, number] => {
    for (const ref of references) {
      if (ref.axis !== 'y' || (ref.axisId ?? meta.leftAxisId) !== axis.id) continue;
      for (const v of [ref.from, ref.to]) {
        if (log && !(v > 0 && v < Infinity)) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
    }
    return [min, max];
  };

  if (log) {
    const error = (code: 'AX170' | 'AX172', detail?: string) => {
      reportCartesian(sink, code, 'chart-error', { field: axis.id, detail });
      return domainResult([1, 10], false);
    };
    if (axis.rawBase !== undefined && !isValidLogBase(axis.rawBase)) return error('AX170', `unsupported base ${String(axis.rawBase)}`);
    if (axis.rawDomain !== undefined) return axis.domain && isValidLogDomain(axis.domain) ? domainResult(axis.domain)
      : error('AX170', 'domain must be strictly positive [min, max] with min < max');

    const all = extrema(allBound);
    // A positive reference cannot make an axis with no positive data drawable.
    if (!all) return error('AX172');
    const nice = (bounds: Span) => niceLogDomain(bounds[0], bounds[1], axis.base);
    const fullDomain = nice(withReferences(all));
    meta.fullPositiveDomains.set(axis.id, fullDomain);
    const bounds = withReferences(extrema(visibleBound, visibleSlots) ?? [Infinity, -Infinity]);
    if (bounds[0] <= bounds[1]) return domainResult(nice(bounds));
    const fallback = extrema(visibleBound);
    return domainResult(fallback ? nice(fallback) : fullDomain);
  }

  let authorDomain = axis.domain;
  if (authorDomain && !authorDomain.every(Number.isFinite)) {
    authorDomain = null;
    report(sink, 'AX103', 'none', { field: `${axis.id}.domain` });
  }
  const [min, max] = authorDomain ?? withReferences(extrema(visibleBound, visibleSlots) ?? extrema(allBound) ?? [0, 1]);
  const result = valueDomain({
    min,
    max,
    includeZero: requiresZero,
    authorDomain,
  });
  if (result.widenedToZero) {
    report(sink, 'AX110', 'none', { field: axis.id });
  }
  return domainResult(result.domain);
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
    : linearTickCandidates(domain, labeler, custom === null);
}
