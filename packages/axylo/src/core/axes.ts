/**
 * Turns a view into the input of `computeLayout`: which axes the chart has, their domains, their candidate
 * tick sets with labels, and their titles. Also produces the key that decides whether layout must rerun
 * (plan 2.2: a data-only update reruns layout only when tick labels or margins would change).
 */
import { alignedExtrema, alignedScale, pointExtrema, scatterX, withReferences, zeroBaseline } from '../view';
import type { Layout, TextMeasurer, TextStyle, TickCandidates, View, XKind } from './contracts';
import { computeLayout, type LayoutInput, type ScaleConstructors, type ValueAxis } from '../layout';
import { baseLayoutKey, type LayoutStage } from './composition';
import type { ResolvedOptions } from '../data';
import { bandScale, bandTickCandidates, coarserDomains, linearScale, linearTickCandidates, timeScale, timeTickCandidates } from '../scale';
import { createNumberTickLabeler, createTimeTickLabel, type NumberFormatOption } from '../format';
import type { XValue } from '../public';
import { withUnit } from '../reader/table';

type Span = readonly [number, number];

export interface AxisContext {
  readonly resolved: ResolvedOptions;
  readonly locale: string;
  readonly compact: boolean;
  /** Not read: failures are tracked per tick position and reported from the drawn ticks (tickFormatFailures). */
  readonly onFormatterError?: (field: string, error: unknown) => void;
  /** The author gave the x field a `label` (spec L6: only then is a time, date or category axis titled). */
  readonly xLabelGiven: boolean;
  /** Title of a value axis that shows several fields with no shared label (the `value` message). */
  readonly valueTitle: string;
}

type AxisScales = Pick<ScaleConstructors, 'linear'> & Partial<Pick<ScaleConstructors, 'time' | 'band'>> & {
  readonly temporalTicks?: typeof temporalTicks;
  readonly bandTicks?: typeof bandTickCandidates;
};

export { timeScale, temporalTicks };
const fullScales = { linear: linearScale, time: timeScale, temporalTicks, band: bandScale, bandTicks: bandTickCandidates };

/**
 * The tick positions an author tick formatter threw on while one axis's candidates were labelled. Layout
 * draws one of several candidate sets (and maybe a coarser domain's), so AX160 is reported only when a drawn
 * tick is among them (re-check, R12). An error the formatter wrapper did not see (an option that cannot be
 * used at all) is about every tick.
 */
class TickFailures {
  private positions: Set<number> | null = null;
  always = false;
  private at = NaN;
  private seen = false;

  /** The author's formatter, noting the position being labelled when it throws. */
  author(option: unknown): unknown {
    if (typeof option !== 'function') return option;
    const format = option as (...args: unknown[]) => unknown;
    return (...args: unknown[]) => {
      try {
        return format(...args);
      } catch (error) {
        this.failed(this.at);
        this.seen = true;
        throw error;
      }
    };
  }

  /** A labeler that says which position it labels. */
  labeler<R extends unknown[]>(label: (position: number, ...rest: R) => string): (position: number, ...rest: R) => string {
    return (position, ...rest) => {
      this.at = position;
      return label(position, ...rest);
    };
  }

  /** What a labeler reports: once per labeler, after the formatter's own throw or for the whole option. */
  report = (): void => {
    if (this.seen) this.seen = false;
    else this.always = true;
  };

  failed(at: number): void { (this.positions ??= new Set()).add(at); }

  drawn(ticks: readonly { readonly value: number }[]): boolean {
    if (this.always) return ticks.length > 0;
    if (this.positions) for (const tick of ticks) {
      if (this.positions.has(tick.value)) return true;
    }
    return false;
  }
}

type FailureTracker = Pick<TickFailures, 'author' | 'labeler' | 'report' | 'failed' | 'drawn'>;
interface AxisFailures {
  readonly x: FailureTracker;
  readonly y: FailureTracker;
}

const noFailures: FailureTracker = {
  author: option => option,
  labeler: label => label,
  report: () => {},
  failed: () => {},
  drawn: () => false,
};
const NO_FAILURES: AxisFailures = { x: noFailures, y: noFailures };

function numberTicks(domain: Span, ctx: AxisContext, option: unknown, scale: 'percent' | 'ratio' | null, failures: FailureTracker): TickCandidates {
  if (ctx.compact && option == null) return [];
  const tickFormat = typeof option === 'function' || (option !== null && typeof option === 'object')
    ? failures.author(option) as NumberFormatOption : null;
  const label = createNumberTickLabeler({ locale: ctx.locale, scale, tickFormat, onError: failures.report });
  return linearTickCandidates(domain, tickFormat ? failures.labeler(label) : label, !tickFormat);
}

function temporalTicks(
  domain: Span, kind: 'time' | 'date' | 'wall', timeZone: string | null, dateUnit: 'day' | 'month' | 'year' | null,
  locale: string, option: unknown, failures: FailureTracker,
): TickCandidates {
  const format = typeof option === 'function' || (option !== null && typeof option === 'object')
    ? failures.author(option) as Parameters<typeof createTimeTickLabel>[0]['format'] : null;
  const label = format ? createTimeTickLabel({ kind, timeZone, locale, dateUnit, format, onError: failures.report }) : null;
  return timeTickCandidates(domain, { kind, timeZone, locale, dateUnit, label: label && failures.labeler(label) });
}

function categoryLabels(categories: readonly string[], option: unknown, failures: FailureTracker): readonly string[] {
  if (typeof option !== 'function') return categories;
  return categories.map((name, i) => {
    try {
      return String((option as (value: XValue) => string)(name));
    } catch {
      // A band tick's value is its category's index.
      failures.failed(i);
      return name;
    }
  });
}

function continuousX(
  kind: Exclude<XKind, 'category'>, domain: Span, timeZone: string | null, dateUnit: 'day' | 'month' | 'year' | null,
  ctx: AxisContext, failures: FailureTracker, scales: AxisScales,
) {
  const option = ctx.resolved.x.tickFormat;
  const candidates = ctx.compact && option == null ? [] : kind === 'number'
    ? numberTicks(domain, ctx, option, ctx.resolved.x.scale ?? null, failures)
    : scales.temporalTicks?.(domain, kind, timeZone, dateUnit, ctx.locale, option, failures) ?? [];
  return { type: kind === 'number' ? 'linear' as const : 'time' as const, domain, candidates, mayThin: true };
}

/** What a view's axes are, apart from the size: domains, tick candidates with their labels, titles. */
type AxisParts = Record<string, unknown>;

/**
 * Axis parts per view, with the fields whose author tick formatter threw while their labels were made. The
 * labels are made once per view and options, so a frame can make them before it writes anything (no author
 * code runs once publication has started; final review, finding 1), and every layout computed from them,
 * cached or not, reports the same AX160 (finding 11).
 */
interface AxisEntry {
  readonly key: readonly unknown[];
  readonly scales: AxisScales;
  readonly parts: AxisParts;
  readonly failures: AxisFailures;
}
let axisMemo: WeakMap<View, AxisEntry> | undefined;

/**
 * What the axis parts read from the resolved options, so an update that changes none of it (a title) reuses
 * the labels made for this view: an author tick formatter that updates the chart on every call can then not
 * stop every frame from publishing (verification, defect 3).
 */
function appendAxisInputs(key: unknown[], ctx: AxisContext): void {
  const { x } = ctx.resolved;
  const value = ctx.resolved.values[0];
  key.push(x.field, x.scale, x.tickFormat, x.unit, x.domain != null, value?.field, value?.tickFormat,
    value?.scale, value?.domain != null, ctx.locale, ctx.compact, ctx.xLabelGiven, ctx.valueTitle);
}

function axisParts(view: View, ctx: AxisContext, scales: AxisScales): AxisEntry {
  const { x } = ctx.resolved;
  const value = ctx.resolved.values[0];
  const cache = axisMemo ??= new WeakMap();
  const hit = cache.get(view);
  if (hit?.scales === scales) {
    // Compare in appendAxisInputs order so cache hits need no temporary key.
    const { key } = hit;
    if (key[0] === x.field && key[1] === x.scale && key[2] === x.tickFormat && key[3] === x.unit &&
        key[4] === (x.domain != null) && key[5] === value?.field && key[6] === value?.tickFormat &&
        key[7] === value?.scale && key[8] === (value?.domain != null) && key[9] === ctx.locale &&
        key[10] === ctx.compact && key[11] === ctx.xLabelGiven && key[12] === ctx.valueTitle) return hit;
  }
  const key: unknown[] = [];
  appendAxisInputs(key, ctx);
  const failures = x.tickFormat == null && value?.tickFormat == null ? NO_FAILURES : {
    x: x.tickFormat == null ? noFailures : new TickFailures(),
    y: value?.tickFormat == null ? noFailures : new TickFailures(),
  };
  const entry = { key, scales, parts: view.kind === 'donut' ? {} : buildAxisParts(view, ctx, failures, scales), failures };
  cache.set(view, entry);
  return entry;
}

/** Makes this view's tick labels now, if they are not made yet, so author tick formatters run here. */
export function prepareTicks(view: View, ctx: AxisContext): void {
  prepareTicksWith(view, ctx, fullScales);
}

function prepareTicksWith(view: View, ctx: AxisContext, scales: AxisScales): void {
  if (view.kind !== 'donut') axisParts(view, ctx, scales);
}

/**
 * The fields whose tick formatter threw on a tick the layout draws (spec 3.5, AX160): labels of candidate
 * sets or coarser domains that were not drawn do not count (re-check, R12).
 */
export function tickFormatFailures(view: View, ctx: AxisContext, layout: Layout): readonly string[] {
  return tickFormatFailuresWith(view, ctx, layout, fullScales);
}

function tickFormatFailuresWith(view: View, ctx: AxisContext, layout: Layout, scales: AxisScales): readonly string[] {
  if (view.kind === 'donut' || layout.kind !== 'plot') return [];
  const { failures } = axisParts(view, ctx, scales);
  const out: string[] = [];
  if (failures.x.drawn(layout.xTicks)) out.push(ctx.resolved.x.field);
  if (failures.y.drawn(layout.yTicks)) out.push(ctx.resolved.values[0]?.field ?? 'y');
  return out;
}

export function layoutInput(
  view: View, size: { width: number; height: number }, text: { measurer: TextMeasurer; style: TextStyle }, ctx: AxisContext,
): LayoutInput {
  return layoutInputWith(view, size, text, ctx, fullScales);
}

function layoutInputWith(
  view: View, size: { width: number; height: number }, text: { measurer: TextMeasurer; style: TextStyle }, ctx: AxisContext, scales: AxisScales,
): LayoutInput {
  const { width, height } = size;
  if (view.kind === 'donut') return { width, height, kind: 'ring' };
  const common = { width, height, compact: ctx.compact, measurer: text.measurer, style: text.style, scales };
  return { ...common, ...axisParts(view, ctx, scales).parts } as unknown as LayoutInput;
}

function valueAxis(
  domain: Span, extent: Span | null, scale: 'percent' | 'ratio' | null, ticks: (domain: Span) => TickCandidates,
): ValueAxis {
  const candidates = (span: Span) => endingCandidates(ticks(span), span, extent, scale);
  const full = scale === 'percent' ? 100 : scale === 'ratio' ? 1 : null;
  return {
    domain, mayThin: true, candidates: candidates(domain),
    coarser: extent ? coarserDomains(extent[0], extent[1], domain, domain[1] === full)
      .map(span => ({ domain: span, candidates: candidates(span) })) : undefined,
  };
}

const VALUE_AXIS_LIMIT = 32;
let defaultValueAxes: Map<string, ValueAxis> | undefined;

function defaultValueAxis(domain: Span, extent: Span | null, scale: 'percent' | 'ratio' | null, ctx: AxisContext): ValueAxis {
  // A rolling window often changes x while keeping the same value domain and extremes. Author formatters
  // still run per view because their output (and whether they throw) can depend on mutable state.
  const [lo, hi] = domain;
  const key = `${Object.is(lo, -0) ? '-0' : lo}/${Object.is(hi, -0) ? '-0' : hi}/${extent?.[0]}/${extent?.[1]}/${scale}/${ctx.locale}`;
  const cache = defaultValueAxes ??= new Map();
  const known = cache.get(key);
  if (known) return known;
  const axis = valueAxis(domain, extent, scale, span => numberTicks(span, ctx, null, scale, noFailures));
  if (cache.size >= VALUE_AXIS_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, axis);
  return axis;
}

export function cartesianLayout(scales: AxisScales): LayoutStage {
  const epochs = new WeakMap<AxisContext, number>();
  const measurements = new WeakMap<TextStyle, { measurer: TextMeasurer; epoch: number; widths: Map<string, number> }>();
  return {
    prepareTicks: (view, ctx) => prepareTicksWith(view, ctx, scales),
    tickFormatFailures: (view, ctx, layout) => tickFormatFailuresWith(view, ctx, layout, scales),
    layoutKey(view, size, style, fontEpoch, ctx) {
      epochs.set(ctx, fontEpoch);
      return layoutKey(view, size, style, fontEpoch, ctx);
    },
    compute(view, size, text, ctx) {
      const input = layoutInputWith(view, size, text, ctx, scales);
      const epoch = epochs.get(ctx);
      // A font can change widths while computed style stays identical. Only reuse widths when the caller
      // supplied its current font epoch through the layout key.
      if (epoch === undefined || input.kind === 'ring' || input.kind === 'message' || ctx.compact) return computeLayout(input);
      const { measurer, style } = text;
      let cached = measurements.get(style);
      if (cached?.measurer !== measurer || cached.epoch !== epoch) {
        cached = { measurer, epoch, widths: new Map() };
        measurements.set(style, cached);
      }
      return computeLayout(input, cached.widths);
    },
  };
}

let alignedStage: LayoutStage | undefined;

export function alignedLayout(): LayoutStage {
  return alignedStage ??= cartesianLayout(fullScales);
}

function buildAxisParts(view: Exclude<View, { kind: 'donut' }>, ctx: AxisContext, failures: AxisFailures, scales: AxisScales): AxisParts {
  const value = ctx.resolved.values[0];
  const yOption = value?.tickFormat ?? null;
  const scale = view.kind === 'scatter' ? value?.scale ?? null : alignedScale(view.frame, view.visible);
  const titles = axisTitles(view, ctx);
  const extent = value?.domain || (ctx.compact && yOption == null) ? null : valueExtent(view);
  const valueTicks = yOption == null && !ctx.compact ? defaultValueAxis(view.yDomain, extent, scale, ctx)
    : valueAxis(view.yDomain, extent, scale, domain => numberTicks(domain, ctx, yOption, scale, failures.y));
  const y = { ...valueTicks, title: titles.y };

  if (view.kind === 'scatter') {
    const kind = view.frame.xKind;
    // A compact axis without a tick format draws no ticks: the x extremes would choose among none.
    const automatic = !ctx.resolved.x.domain && view.xDomain[0] === view.xFull[0] && view.xDomain[1] === view.xFull[1] &&
      !(ctx.compact && ctx.resolved.x.tickFormat == null);
    const x = kind === 'number' ? { type: 'linear', ...valueAxis(view.xDomain, automatic ? valueExtent(view, 'x') : null, null,
      domain => numberTicks(domain, ctx, ctx.resolved.x.tickFormat, null, failures.x)) }
      : continuousX(kind, view.xDomain, view.frame.timeZone, null, ctx, failures.x, scales);
    return { kind: 'xy', x: { ...x, title: titles.x }, y, references: view.references };
  }

  const column = view.frame.x;
  const xTitle = titles.x;
  const references = view.references;
  // A compact band axis is its projection only (count and padding); its labels are made when a format asks.
  const bandTicks = ctx.compact && ctx.resolved.x.tickFormat == null ? undefined : scales.bandTicks;
  const x = column.kind === 'category' ? {
    type: 'band' as const, count: column.categories?.length ?? 0, padding: view.kind === 'bar' ? 0.2 : 0,
    candidates: bandTicks?.(categoryLabels(column.categories ?? [], ctx.resolved.x.tickFormat, failures.x)) ?? [],
    mayThin: column.ordered, title: xTitle,
  } : { ...continuousX(column.kind, view.xDomain, column.timeZone, column.dateUnit, ctx, failures.x, scales), title: xTitle };
  return view.kind === 'bar' || view.kind === 'histogram'
    ? { kind: 'bands', horizontal: view.horizontal, x, y, references }
    : { kind: 'xy', x, y, references };
}

/** The extremes that the automatic domain was rounded from, read once per immutable view. */
let xExtents: WeakMap<View, Span | null> | undefined;
let yExtents: WeakMap<View, Span | null> | undefined;

export function valueExtent(view: Exclude<View, { kind: 'donut' }>, axis: 'x' | 'y' = 'y'): Span | null {
  const cache = axis === 'x' ? (xExtents ??= new WeakMap()) : (yExtents ??= new WeakMap());
  const known = cache.get(view);
  if (known !== undefined) return known;
  const data = view.kind === 'scatter'
    ? axis === 'x' ? scatterX(view.frame) : pointExtrema(view.frame, view.visible, view.visiblePoints)
    : alignedExtrema(view.frame, view.visible, view.visibleSlots, view.drawSlots, null, view.stack, view.kind);
  let [lo, hi] = withReferences(data, view.references, axis);
  if (axis === 'y' && zeroBaseline(view.kind)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const extent: Span | null = lo <= hi ? [lo, hi] : null;
  cache.set(view, extent);
  return extent;
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
    if (!near(first, a) || !near(last, b) || !(set[1]!.value > first)) return false;
    // Compared on the set's own ticks, not on `b - step` (0.2 - 0.1 is below 0.1 in doubles): the first tick
    // reaching the maximum is the last one, and the last tick reaching the minimum is the first one.
    const reachesHi = (t: number) => t >= hi || near(t, hi);
    const reachesLo = (t: number) => t <= lo || near(t, lo);
    const upper = (full !== null && near(b, full)) || set.findIndex(t => reachesHi(t.value)) === set.length - 1;
    let lowest = -1;
    for (let i = set.length - 1; i >= 0; i--) if (reachesLo(set[i]!.value)) { lowest = i; break; }
    return upper && lowest === 0;
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
  const base = baseLayoutKey(view, size, style, fontEpoch, ctx);
  if (view.kind === 'donut') return base;
  const value = ctx.resolved.values[0];
  base.push(view.xDomain[0], view.xDomain[1], view.yDomain[0], view.yDomain[1]);
  appendAxisInputs(base, ctx);
  base.push(ctx.resolved.x.label, value?.label, value?.unit, view.references);
  // The extremes choose among the tick sets and wider domains of an automatic domain (F7). A compact axis
  // without a tick format has neither (axis parts give it no extent), so they are not read for it.
  const extent = value?.domain || (ctx.compact && value?.tickFormat == null) ? null : valueExtent(view);
  base.push(extent?.[0], extent?.[1]);
  for (const visible of view.visible) base.push(visible);
  // The titles as drawn: a unit can change on one series only and change the shared unit (review 2, finding 20).
  const titles = axisTitles(view, ctx);
  base.push(titles.x, titles.y);
  if (view.kind === 'scatter') {
    // The x extent chooses among the x tick sets of an automatic domain, as the value extent does for y.
    const xExtent = ctx.compact && ctx.resolved.x.tickFormat == null ? null : valueExtent(view, 'x');
    base.push(view.frame.xKind, view.frame.timeZone, view.frame.xLabel, view.frame.yLabel, xExtent?.[0], xExtent?.[1]);
    return base;
  }
  const column = view.frame.x;
  // No slot indexes: layout reads domains, categories and labels only, never which slots are visible.
  base.push(column.kind, column.timeZone, column.dateUnit, column.ordered, view.frame.xLabel, view.frame.yLabel,
    view.horizontal, column.categories);
  for (const s of view.frame.series) base.push(s.valueScale);
  return base;
}

export { sameKey } from './composition';
