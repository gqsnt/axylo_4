/**
 * Turns a view into the input of `computeLayout`: which axes the chart has, their domains, their candidate
 * tick sets with labels, and their titles. Also produces the key that decides whether layout must rerun
 * (plan 2.2: a data-only update reruns layout only when tick labels or margins would change).
 */
import type { TextMeasurer, TextStyle, TickCandidates, View, XKind } from './contracts';
import type { LayoutInput } from '../layout';
import type { ResolvedOptions } from '../data';
import { bandScale, bandTickCandidates, linearScale, linearTickCandidates, timeScale, timeTickCandidates } from '../scale';
import { createNumberTickLabeler, createTimeTickLabel, type NumberFormatOption } from '../format';
import type { XValue } from '../public';

type Span = readonly [number, number];

export interface AxisContext {
  readonly resolved: ResolvedOptions;
  readonly locale: string;
  readonly compact: boolean;
  /** Called once per field when an author tick formatter throws (the chart raises AX160). */
  readonly onFormatterError: (field: string, error: unknown) => void;
  /** The author gave the x field a `label` (spec L6: only then is a time, date or category axis titled). */
  readonly xLabelGiven: boolean;
  /** Title of a value axis that shows several fields with no shared label (the `value` message). */
  readonly valueTitle: string;
}

const scales = {
  linear: linearScale,
  time: timeScale,
  band: bandScale,
};

function withUnit(label: string, unit: string | null): string {
  return unit ? `${label} (${unit})` : label;
}

function numberTicks(domain: Span, locale: string, option: unknown, scale: 'percent' | 'ratio' | null, onError: (e: unknown) => void): TickCandidates {
  const tickFormat = typeof option === 'function' || (option !== null && typeof option === 'object')
    ? option as NumberFormatOption : null;
  return linearTickCandidates(domain, createNumberTickLabeler({ locale, scale, tickFormat, onError }));
}

function temporalTicks(
  domain: Span, kind: 'time' | 'date' | 'wall', timeZone: string | null, dateUnit: 'day' | 'month' | 'year' | null,
  locale: string, option: unknown, onError: (e: unknown) => void,
): TickCandidates {
  const format = typeof option === 'function' || (option !== null && typeof option === 'object')
    ? option as Parameters<typeof createTimeTickLabel>[0]['format'] : null;
  const label = format ? createTimeTickLabel({ kind, timeZone, locale, dateUnit, format, onError }) : null;
  return timeTickCandidates(domain, { kind, timeZone, locale, dateUnit, label });
}

function categoryLabels(categories: readonly string[], option: unknown, onError: (e: unknown) => void): readonly string[] {
  if (typeof option !== 'function') return categories;
  let failed = false;
  return categories.map(name => {
    try {
      return String((option as (value: XValue) => string)(name));
    } catch (error) {
      if (!failed) onError(error);
      failed = true;
      return name;
    }
  });
}

function continuousX(
  kind: Exclude<XKind, 'category'>, domain: Span, timeZone: string | null, dateUnit: 'day' | 'month' | 'year' | null,
  ctx: AxisContext,
) {
  const option = ctx.resolved.x.tickFormat;
  const onError = (e: unknown) => ctx.onFormatterError(ctx.resolved.x.field, e);
  const candidates = kind === 'number'
    ? numberTicks(domain, ctx.locale, option, null, onError)
    : temporalTicks(domain, kind, timeZone, dateUnit, ctx.locale, option, onError);
  return { type: kind === 'number' ? 'linear' as const : 'time' as const, domain, candidates, mayThin: true };
}

export function layoutInput(
  view: View, size: { width: number; height: number }, text: { measurer: TextMeasurer; style: TextStyle }, ctx: AxisContext,
): LayoutInput {
  const { width, height } = size;
  if (view.kind === 'donut') return { width, height, kind: 'ring' };
  const value = ctx.resolved.values[0];
  const yOption = value?.tickFormat ?? null;
  const onYError = (e: unknown) => ctx.onFormatterError(value?.field ?? 'y', e);
  const visibleSeries = view.frame.series.filter((_, i) => view.visible[i]);
  const firstScale = 'valueScale' in (visibleSeries[0] ?? {}) ? (visibleSeries[0] as { valueScale: 'percent' | 'ratio' | null }).valueScale : null;
  const valueScale = view.kind === 'scatter' ? value?.scale ?? null
    : visibleSeries.every(s => (s as { valueScale: unknown }).valueScale === firstScale) ? firstScale : null;
  const titles = axisTitles(view, ctx);
  const all = numberTicks(view.yDomain, ctx.locale, yOption, valueScale, onYError);
  const y = {
    domain: view.yDomain,
    // An automatic domain ends at the first drawn tick at or beyond each extreme (F7): layout may only choose
    // among the tick sets for which that holds. An author's domain is drawn as given.
    candidates: value?.domain ? all : endingCandidates(all, view.yDomain, valueExtent(view), valueScale),
    title: titles.y, mayThin: true,
  };
  const common = { width, height, compact: ctx.compact, measurer: text.measurer, style: text.style, scales };

  if (view.kind === 'scatter') {
    const x = continuousX(view.frame.xKind, view.xDomain, view.frame.timeZone, null, ctx);
    return { ...common, kind: 'xy', x: { ...x, title: titles.x }, y, references: view.references };
  }

  const column = view.frame.x;
  const xTitle = titles.x;
  const references = view.references;
  const onXError = (e: unknown) => ctx.onFormatterError(ctx.resolved.x.field, e);
  if (column.kind === 'category') {
    const labels = categoryLabels(column.categories ?? [], ctx.resolved.x.tickFormat, onXError);
    const x = {
      type: 'band' as const, count: labels.length, padding: view.kind === 'bar' ? 0.2 : 0,
      candidates: bandTickCandidates(labels), mayThin: column.ordered, title: xTitle,
    };
    return view.kind === 'bar'
      ? { ...common, kind: 'bands', horizontal: view.horizontal, x, y, references }
      : { ...common, kind: 'xy', x, y, references };
  }
  // Bars on a continuous x: the view's domain already has room for the outer bars (view/bar-bands.ts), and
  // ticks, marks and lookup all use that one domain.
  const x = { ...continuousX(column.kind, view.xDomain, column.timeZone, column.dateUnit, ctx), title: xTitle };
  return view.kind === 'bar'
    ? { ...common, kind: 'bands', horizontal: view.horizontal, x, y, references }
    : { ...common, kind: 'xy', x, y, references };
}

/**
 * What an automatic value domain was rounded from: the visible values (stack totals for a stack), the
 * reference lines and bands, and zero on bar and area (spec F1, F7).
 */
export function valueExtent(view: Exclude<View, { kind: 'donut' }>): Span | null {
  let lo = Infinity;
  let hi = -Infinity;
  const take = (v: number) => { if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } };
  if (view.kind === 'scatter') {
    view.frame.series.forEach((s, i) => {
      if (!view.visible[i]) return;
      const { start, end } = view.visiblePoints[i]!;
      for (let j = start; j < end; j++) take(s.y[j]!);
    });
  } else if (view.stack) {
    const top = view.stack.positive.at(-1);
    const bottom = view.stack.negative.at(-1);
    const { start, end } = view.kind === 'bar' ? view.drawSlots[0] ?? view.visibleSlots : view.visibleSlots;
    for (let j = start; j < end; j++) { if (top) take(top[j]!); if (bottom) take(bottom[j]!); }
  } else {
    view.frame.series.forEach((s, i) => {
      if (!view.visible[i]) return;
      const { start, end } = view.kind === 'bar' ? view.drawSlots[i] ?? view.visibleSlots : view.visibleSlots;
      for (let j = start; j < end; j++) if (s.slot[j] === 0) take(s.y[j]!);
    });
  }
  for (const r of view.references) if (r.axis === 'y') { take(r.from); take(r.to); }
  if (view.kind === 'bar' || view.kind === 'area') take(0);
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The candidate tick sets whose first and last ticks are the domain's ends and whose step leaves no tick
 * between an extreme and its end: then the drawn ticks and the domain come from one step (F7). A full-scale
 * end (percent, ratio) is fixed and need not be the first tick past the data. When no set qualifies (a very
 * short plot), every set is offered, so the axis still has ticks.
 */
export function endingCandidates(sets: TickCandidates, domain: Span, extent: Span | null, scale: 'percent' | 'ratio' | null): TickCandidates {
  if (!extent) return sets;
  const [a, b] = domain;
  const [lo, hi] = extent;
  const full = scale === 'percent' ? 100 : scale === 'ratio' ? 1 : null;
  const near = (p: number, q: number) => Math.abs(p - q) <= 1e-9 * Math.max(1, Math.abs(p), Math.abs(q));
  const fits = sets.filter(set => {
    if (set.length < 2) return false;
    const first = set[0]!.value;
    const last = set[set.length - 1]!.value;
    const step = set[1]!.value - first;
    if (!near(first, a) || !near(last, b) || !(step > 0)) return false;
    const upper = (full !== null && near(b, full)) || near(b, hi) || b - step < hi;
    const lower = near(a, lo) || a + step > lo;
    return upper && lower;
  });
  return fits.length ? fits : sets;
}

/** The axis titles layout draws (spec L6), with their units; undefined where an axis is untitled. */
function axisTitles(view: Exclude<View, { kind: 'donut' }>, ctx: AxisContext): { x: string | undefined; y: string | undefined } {
  if (ctx.compact) return { x: undefined, y: undefined };
  if (view.kind === 'scatter') {
    return {
      x: xTitled(view.frame.xKind, ctx) ? withUnit(view.frame.xLabel, view.frame.xUnit) : undefined,
      y: withUnit(view.frame.yLabel, view.frame.yUnit),
    };
  }
  return {
    x: xTitled(view.frame.x.kind, ctx) ? withUnit(view.frame.xLabel, ctx.resolved.x.unit) : undefined,
    y: withUnit(view.frame.yLabel ?? alignedValueTitle(view.frame.series, ctx.valueTitle), sharedUnit(view.frame.series)),
  };
}

/** Spec L6: a number x is a measure and is titled; time, date and category ticks already say what they are. */
function xTitled(kind: XKind, ctx: AxisContext): boolean {
  return kind === 'number' || ctx.xLabelGiven;
}

/** A value axis is always titled (spec L6): its label, else its one field, else the generic noun. */
function alignedValueTitle(series: readonly { readonly field: string }[], generic: string): string {
  const first = series[0]?.field;
  return first !== undefined && series.every(s => s.field === first) ? first : generic;
}

function sharedUnit(series: readonly { readonly unit: string | null }[]): string | null {
  const first = series[0]?.unit ?? null;
  return series.every(s => s.unit === first) ? first : null;
}

/**
 * Everything layout reads, as comparable parts. Equal keys mean the previous layout is still right: same
 * size, text style, fonts, locale, domains, categories, titles and formatters.
 */
export function layoutKey(
  view: View, size: { width: number; height: number }, style: TextStyle, fontEpoch: number, ctx: AxisContext,
): readonly unknown[] {
  const base: unknown[] = [size.width, size.height, style.font, style.letterSpacing, style.wordSpacing, style.lineHeight,
    fontEpoch, ctx.locale, ctx.compact, view.kind];
  if (view.kind === 'donut') return base;
  const value = ctx.resolved.values[0];
  base.push(view.xDomain[0], view.xDomain[1], view.yDomain[0], view.yDomain[1], ctx.resolved.x.tickFormat,
    ctx.resolved.x.label, ctx.resolved.x.unit, value?.tickFormat, value?.label, value?.unit, value?.scale,
    ctx.xLabelGiven, ctx.valueTitle, view.references);
  base.push(...view.visible);
  // The titles as drawn: a unit can change on one series only and change the shared unit (review 2, finding 20).
  const titles = axisTitles(view, ctx);
  base.push(titles.x, titles.y);
  if (view.kind === 'scatter') {
    base.push(view.frame.xKind, view.frame.timeZone, view.frame.xLabel, view.frame.yLabel);
    return base;
  }
  const column = view.frame.x;
  // No slot indexes: layout reads domains, categories and labels only, never which slots are visible.
  base.push(column.kind, column.timeZone, column.dateUnit, column.ordered, view.frame.xLabel, view.frame.yLabel,
    view.horizontal, column.categories);
  for (const s of view.frame.series) base.push(s.valueScale);
  return base;
}

export function sameKey(a: readonly unknown[] | null, b: readonly unknown[]): boolean {
  if (a === null || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (Object.is(x, y)) continue;
    // Categories are compared by content: a renormalized frame has a new array with the same names.
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, k) => v === y[k])) continue;
    return false;
  }
  return true;
}
