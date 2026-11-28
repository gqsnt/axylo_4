/**
 * Split-pane layout for `axylo/finance` (N7a): a price pane above a volume pane, one shared x axis below both.
 *
 * The shared Cartesian layout fits the x axis and the price axis; this stage asks it for a plot that is the
 * price pane only (the container's height less the volume block), then moves the x axis below the volume pane
 * and fits the volume axis in a lane on the right. `layout.plot` and the x projection cover both panes, so
 * pointer lookup, the cursor and zoom work anywhere in the figure; `projection.y` is the price pane's scale.
 * The volume pane has its own scale, ticks and title, carried on the layout as `finance`.
 */
import {
  SLOT_VALUE, type AlignedView, type ContinuousScale, type DiagnosticInput, type Layout, type PlacedText,
  type Rect, type TextMeasurer, type TextStyle, type Tick, type View, type XScale,
} from '../core/contracts';
import { alignedLayout, layoutInput, type AxisContext } from '../core/axes';
import type { LayoutStage } from '../core/composition';
import { createDiagnostic } from '../diagnostics/registry';
import { createNumberTickLabeler } from '../format';
import { computeLayout } from '../layout';
import { middleText, placeText, prepareLabels, wrapText, type Metrics } from '../layout/labels';
import { withUnit } from '../reader/table';
import { linearScale, linearTickCandidates, type TickLabeler } from '../scale/linear';
import { position } from '../scene/geometry';
import { aggregateOhlcv, denseThreshold, type OhlcvBins } from './aggregate';
import {
  createFinanceDiagnostic, FLAG_INCOMPLETE_OHLC, FLAG_INVALID_OHLC, FLAG_INVALID_VOLUME, findOhlcSeries, flagsForFrame,
  frameMeta, metaForResolved, type FinanceMeta, type FinanceStateRef,
} from './core';

/** Share of the plot height given to the volume pane and to the gap above it; the price pane keeps the rest (~72%). */
export const VOLUME_SHARE = 0.23;
export const GAP_SHARE = 0.05;
const MIN_GAP = 6;
/** The gap of a short plot, where every pixel left after the price pane goes to the volume pane. */
const SHORT_GAP = 4;
/** The shared layout's smallest plot height: the price pane may not go below it. */
const MIN_PRICE = 80;
/**
 * Below this the volume pane is not drawn: one tick label (a line of text) and bars a few pixels tall still
 * read; less would not. The price pane is then the whole plot and the omission is disclosed.
 */
export const MIN_VOLUME_PANE = 16;
const TICK_GAP = 6;
const GAP = 4;
const MAX_VOLUME_TICKS = 3;
/** The volume lane may take at most this share of the width; wider labels are shortened or hidden. */
const MAX_LANE_SHARE = 0.25;
/** Lane measurements per layout: the lane only grows and is capped, so a few passes settle it. */
const LANE_PASSES = 4;

export interface FinancePanes {
  readonly price: Rect;
  /** Null when there is no volume field, it is hidden, or the plot is too short for a readable pane. */
  readonly volume: Rect | null;
  /** Maps volume to the volume pane: [0, volumeMax] (or [0, 1] when no volume is drawable) onto its height. */
  readonly volumeScale: ContinuousScale | null;
  readonly volumeTicks: readonly VolumeTick[];
  /**
   * The largest drawn bar: a single candle's volume, or in dense mode the largest bin sum, so the summed bars
   * keep heights proportional to one another. 0 when no volume is drawable.
   */
  readonly volumeMax: number;
  /** y of the hairline between the panes (null without a volume pane). */
  readonly divider: number | null;
  /** Dense views draw these bins instead of one candle per slot; null when every candle is drawn. */
  readonly bins: OhlcvBins | null;
  /** A volume tick formatter threw for a drawn tick (AX160). */
  readonly volumeFormatFailed: boolean;
  /** Volume tick labels and title the lane could not hold even shortened; counted in `fit.y.hidden`. */
  readonly volumeLabelsHidden: number;
  /** A volume field is shown but the plot is too short for its pane: price only, disclosed (AX142, reader note). */
  readonly volumeOmitted: boolean;
}

export type FinanceLayout = Extract<Layout, { kind: 'plot' | 'compact' }> & { readonly finance: FinancePanes };

export function financePanes(layout: Layout): FinancePanes | null {
  return (layout.kind === 'plot' || layout.kind === 'compact') && 'finance' in layout
    ? (layout as FinanceLayout).finance : null;
}

type Aligned = AlignedView;

function isAligned(view: View): view is Aligned {
  return view.kind === 'line' || view.kind === 'area' || view.kind === 'bar' || view.kind === 'histogram';
}

/** The volume series when the chart has one and the reader has not hidden it. */
export function shownVolume(view: Aligned, meta: FinanceMeta): { readonly index: number } | null {
  const { volume } = findOhlcSeries(view.frame, meta);
  if (!volume) return null;
  const index = view.frame.series.indexOf(volume);
  return index >= 0 && view.visible[index] !== false ? { index } : null;
}

interface PriceViewEntry {
  readonly volume: unknown;
  readonly label: string | null;
  readonly view: Aligned;
}
let priceViews: WeakMap<View, PriceViewEntry> | undefined;

/**
 * The view the shared axis machinery sees: the price series only, titled by `yAxis.label`. Volume would
 * otherwise widen the value extent and drop the price unit from the shared title. One per view, volume series
 * and price title (not per finance meta: an update that changes neither, a chart title, keeps it), so the shared
 * axis memo and its tick formatter failures hold between prepareTicks, compute and diagnostics, and a tick
 * formatter that updates the chart on every call still lets a frame be drawn.
 */
export function priceView(view: Aligned, meta: FinanceMeta): Aligned {
  const cache = priceViews ??= new WeakMap();
  const { volume } = findOhlcSeries(view.frame, meta);
  const label = meta.priceAxisLabel;
  const hit = cache.get(view);
  if (hit && hit.volume === volume && hit.label === label) return hit.view;
  const keep = view.frame.series.map(s => s !== volume);
  const pick = <T>(list: readonly T[]): T[] => list.filter((_, i) => keep[i] !== false);
  const frame = { ...view.frame, series: pick(view.frame.series), yLabel: label ?? view.frame.yLabel };
  const derived = {
    ...view, frame, visible: pick(view.visible), cues: pick(view.cues), drawSlots: pick(view.drawSlots),
  } as Aligned;
  cache.set(view, { volume, label, view: derived });
  return derived;
}

/** What drawing reads per slot: drawable candles and volumes, and the dense bins when the view needs them. */
export function candleData(view: Aligned, meta: FinanceMeta, xScale: XScale, left: number, width: number, withVolume: boolean): {
  readonly bins: OhlcvBins | null;
  readonly volumeMax: number;
} {
  const { open, high, low, close, volume } = findOhlcSeries(view.frame, meta);
  if (!open || !high || !low || !close) return { bins: null, volumeMax: 0 };
  const flags = flagsForFrame(view.frame, meta);
  const xs = view.frame.x.values;
  const { start, end } = view.visibleSlots;
  const vol = withVolume && volume ? volume : null;
  // Folded in the function, not a module constant: `a | b` at the top level is an expression a bundler keeps
  // when side-effect hints are ignored, so a bare import of axylo/finance would not bundle to nothing.
  const candle = (i: number) => (flags[i]! & (FLAG_INVALID_OHLC | FLAG_INCOMPLETE_OHLC)) === 0;
  const drawableVolume = (i: number) => vol !== null && candle(i) && (flags[i]! & FLAG_INVALID_VOLUME) === 0 &&
    vol.slot[i] === SLOT_VALUE && vol.y[i]! >= 0 && Number.isFinite(vol.y[i]!);
  if (end - start > denseThreshold(width)) {
    const x = xScale.type === 'band' ? (i: number) => xScale.center(i) : (i: number) => position(xScale, xs[i]!);
    const bins = aggregateOhlcv({
      open: open.y, high: high.y, low: low.y, close: close.y, volume: vol ? vol.y : null, candle, drawableVolume, x,
    }, start, end, left, width);
    return { bins, volumeMax: bins.maxVolume };
  }
  let volumeMax = 0;
  if (vol) for (let i = start; i < end; i++) {
    if (drawableVolume(i) && vol.y[i]! > volumeMax) volumeMax = vol.y[i]!;
  }
  return { bins: null, volumeMax };
}

function textMetrics(measurer: TextMeasurer, style: TextStyle): Metrics {
  const widths = new Map<string, number>();
  return {
    lineHeight: style.lineHeight,
    width(text) {
      let w = widths.get(text);
      if (w === undefined) widths.set(text, w = measurer.width(text, style));
      return w;
    },
  };
}

export function volumeTitle(meta: FinanceMeta): string {
  return withUnit(meta.volumeAxisLabel ?? meta.volumeLabel, meta.volumeUnit);
}

/**
 * Which volume tick labels carry the default label because the author's formatter threw (spec 3.5, AX160 for
 * drawn ticks only, as the shared axes' TickFailures). Candidate labels are made lazily, some only to be
 * rejected, and the same value appears in several candidate sets: a failure belongs to the label instance it
 * was made for (see `volumeTicks`), never to its value. An option that fails as a whole (bad Intl options) is
 * about every tick.
 */
export class VolumeTickFailures {
  #threw = false;
  #always = false;
  #seen = false;

  /** The author's formatter, noting that the label being made threw. */
  author(option: FinanceMeta['volumeFormat']): FinanceMeta['volumeFormat'] {
    if (typeof option !== 'function') return option;
    return (value: number) => {
      try {
        return option(value);
      } catch (error) {
        this.#threw = true;
        this.#seen = true;
        throw error;
      }
    };
  }

  /** The labeler's onError: after the formatter's own throw, or for the whole option. */
  report = (): void => {
    if (this.#seen) this.#seen = false;
    else this.#always = true;
  };

  /** Makes one label, saying whether it is the fallback in place of the author's. */
  made(make: () => string): { readonly label: string; readonly fallback: boolean } {
    this.#threw = false;
    const label = make();
    const fallback = this.#threw || this.#always;
    this.#threw = false;
    return { label, fallback };
  }

  drawn(ticks: readonly VolumeTick[]): boolean {
    for (const t of ticks) if (t.fallback || this.#always) return true;
    return false;
  }
}

/** A drawn volume tick, with whether its label is the default one in place of a formatter that threw. */
export interface VolumeTick extends Tick {
  readonly fallback: boolean;
}

/** One candidate tick: its label made once, on first read, with the failure status of that very call. */
class TrackedTick {
  #made: { readonly label: string; readonly fallback: boolean } | undefined;
  readonly #make: () => string;
  readonly #failures: VolumeTickFailures | null;

  constructor(readonly value: number, make: () => string, failures: VolumeTickFailures | null) {
    this.#make = make;
    this.#failures = failures;
  }

  get label(): string { return this.#read().label; }

  get fallback(): boolean { return this.#read().fallback; }

  #read(): { readonly label: string; readonly fallback: boolean } {
    return this.#made ??= this.#failures ? this.#failures.made(this.#make) : { label: this.#make(), fallback: false };
  }
}

function readable(set: readonly { readonly label: string }[]): boolean {
  const seen = new Set<string>();
  for (const t of set) {
    const text = t.label.trim();
    if (!text || seen.has(text)) return false;
    seen.add(text);
  }
  return true;
}

/**
 * The volume ticks: the densest nice set of at most three ticks in [0, max] whose labels do not touch and read
 * as different, nonblank values. Labels are made only for the sets considered, in order. A pane too short for
 * two labels, or a format that makes every set's labels alike (whole numbers for volumes below one), is thinned
 * to the top tick (when its label differs from the baseline's), else to the baseline alone; with no readable
 * label at all, no tick is drawn and the caller discloses it.
 */
export function volumeTicks(
  max: number, paneHeight: number, lineHeight: number, label: TickLabeler, failures: VolumeTickFailures | null = null,
): readonly VolumeTick[] {
  // Plain ticks out: the lazy candidates' labels live in getters, which a copy of a tick would drop.
  return chooseVolumeTicks(max, paneHeight, lineHeight, label, failures)
    .map(t => ({ value: t.value, label: t.label, fallback: t.fallback }));
}

function chooseVolumeTicks(
  max: number, paneHeight: number, lineHeight: number, label: TickLabeler, failures: VolumeTickFailures | null,
): readonly TrackedTick[] {
  // No drawable volume: the axis is the baseline alone, labelled 0, over a nominal [0, 1] scale.
  if (!(max > 0)) {
    const zero = new TrackedTick(0, () => label(0, { step: 1, maxAbs: 1 }), failures);
    return zero.label.trim() ? [zero] : [];
  }
  // Each candidate wrapped once, so a label (and whether it fell back) is made once, for the instance read.
  const sets = linearTickCandidates([0, max], label, true)
    .filter(set => set.length > 0 && set.length <= MAX_VOLUME_TICKS)
    .map(set => set.map(t => new TrackedTick(t.value, () => t.label, failures)));
  const spaced = (set: readonly TrackedTick[]) => set.length < 2 || ((set[1]!.value - set[0]!.value) / max) * paneHeight >= lineHeight + 2;
  // A one-tick set (a step past the extent) is a thinning, tried after every set that labels the scale.
  for (const set of sets) if (set.length >= 2 && spaced(set) && readable(set)) return set;
  // Thinned to one tick: the top one of the densest set, if it does not read as the baseline.
  const baseline = sets.find(set => set[0]!.value === 0)?.[0];
  for (const set of sets) {
    const top = set[set.length - 1]!;
    if (top.value <= 0) continue;
    const text = top.label.trim();
    if (text && (!baseline || baseline.label.trim() !== text)) return [top];
  }
  if (baseline && baseline.label.trim()) return [baseline];
  return [];
}

function moveText(text: PlacedText, dy: number): PlacedText {
  return { ...text, y: text.y + dy, box: { ...text.box, y: text.box.y + dy } };
}

/**
 * AX181 for dense columns whose summed volume passes the largest double: their bars are drawn at the top of
 * the volume scale (Number.MAX_VALUE) instead of their true height. Tooltip, keyboard and table read each
 * candle's own volume, which is finite, so nothing is lost there.
 */
export function saturatedVolume(field: string, count: number): DiagnosticInput {
  return {
    ...createFinanceDiagnostic('AX181', 'changed', {
      field, count,
      detail: `Field '${field}' sums to more than the largest representable number in ${count} dense column${count === 1 ? '' : 's'}. `
        + 'Those volume bars are drawn at the top of the volume axis; the table keeps every exact value.',
    }),
    origin: 'presentation',
  };
}

/**
 * A configured, visible volume the plot is too short to draw a pane for. AX142 is the nearest meaning ("the plot
 * is too small to draw"), narrowed to the volume pane: the price pane is drawn, volumes stay readable in the
 * tooltip, table and summary, and the reader sees the hidden-labels note (the volume axis is counted hidden).
 */
export function omittedVolume(field: string): DiagnosticInput {
  const base = createDiagnostic('AX142', 'omitted', { field }, 'presentation');
  return {
    ...base,
    message: `The plot is too short to draw the volume pane of field '${field}'. Give the plot more room. `
      + 'The price pane uses the whole plot; the tooltip, table and summary keep every volume.',
  };
}

interface Built {
  readonly layout: Layout;
  readonly failed: boolean;
}

export function financeLayout(stateRef: FinanceStateRef): LayoutStage {
  const shared = alignedLayout();

  const base = (view: Aligned, width: number, height: number, text: { measurer: TextMeasurer; style: TextStyle }, ctx: AxisContext): Layout => {
    const input = layoutInput(view, { width, height }, text, ctx);
    // No coarser domain: the price pane keeps its fitted (or explicit) domain exactly.
    return computeLayout('y' in input ? { ...input, y: { ...input.y, coarser: undefined } } as typeof input : input);
  };

  const build = (view: Aligned, size: { width: number; height: number }, text: { measurer: TextMeasurer; style: TextStyle }, ctx: AxisContext): Built => {
    // Titles, units and formats are the accepted options' (ctx.resolved); fields and flags the frame's own.
    const meta = metaForResolved(stateRef, ctx.resolved);
    const fields = frameMeta(stateRef, view.frame);
    const pv = priceView(view, meta);
    const { width, height } = size;
    const sized = (layout: Layout): Layout => ({ ...layout, width, height } as Layout);
    const volumeShown = shownVolume(view, fields) !== null;
    const withPanes = (layout: Layout, panes: FinancePanes): Layout => ({ ...layout, width, height, finance: panes } as unknown as Layout);
    const priceOnly = (layout: Layout, omitted = false): Built => {
      if (layout.kind !== 'plot' && layout.kind !== 'compact') return { layout: sized(layout), failed: false };
      const xScale = layout.projection.kind === 'xy' ? layout.projection.x : layout.projection.kind === 'bands' ? layout.projection.band : null;
      const candles = xScale ? candleData(view, fields, xScale, layout.plot.x, layout.plot.width, false) : { bins: null, volumeMax: 0 };
      // An omitted volume pane hides its axis labels: counted in the y fit, the reader is told (L1 note).
      const fit = omitted && layout.kind === 'plot' ? { ...layout.fit, y: { ...layout.fit.y, hidden: layout.fit.y.hidden + 1 } } : null;
      return {
        layout: withPanes(fit ? { ...layout, fit } as Layout : layout, {
          price: layout.plot, volume: null, volumeScale: null, volumeTicks: [], volumeMax: 0, divider: null,
          bins: candles.bins, volumeFormatFailed: false, volumeLabelsHidden: omitted ? 1 : 0, volumeOmitted: omitted,
        }),
        failed: false,
      };
    };

    if (ctx.compact) {
      const layout = base(pv, width, height, text, ctx);
      if (!volumeShown || layout.kind !== 'compact' || layout.projection.kind !== 'xy') return priceOnly(layout);
      const plot = layout.plot;
      const volH = plot.height * VOLUME_SHARE;
      const gap = plot.height * GAP_SHARE;
      const price = { ...plot, height: plot.height - volH - gap };
      const volume = { x: plot.x, y: price.y + price.height + gap, width: plot.width, height: volH };
      const candles = candleData(view, fields, layout.projection.x, plot.x, plot.width, true);
      const y = linearScale(pv.yDomain, [price.y + price.height, price.y]);
      return {
        layout: withPanes({ ...layout, projection: { ...layout.projection, y } }, {
          price, volume, volumeScale: linearScale([0, candles.volumeMax > 0 ? candles.volumeMax : 1], [volume.y + volume.height, volume.y]),
          volumeTicks: [], volumeMax: candles.volumeMax, divider: null, bins: candles.bins, volumeFormatFailed: false, volumeLabelsHidden: 0,
          volumeOmitted: false,
        }),
        failed: false,
      };
    }

    if (!volumeShown) return priceOnly(base(pv, width, height, text, ctx));

    const metrics = textMetrics(text.measurer, text.style);
    const tickFormat = meta.volumeFormat;
    const title = volumeTitle(meta);

    /** Both panes for a volume lane of `lane` px on the right, with the volume labels it would need. */
    const attempt = (lane: number) => {
      const full = base(pv, width - lane, height, text, ctx);
      if (full.kind !== 'plot') return { kind: 'none' as const, full };
      const P = full.plot.height;
      let gap = Math.max(MIN_GAP, Math.round(P * GAP_SHARE));
      let volH = Math.round(P * VOLUME_SHARE);
      // A short plot keeps the price pane at the shared minimum and gives the volume pane what is left.
      if (P - gap - volH < MIN_PRICE) {
        gap = SHORT_GAP;
        volH = Math.min(volH, P - gap - MIN_PRICE);
      }
      // Too short for both panes: the price pane keeps the plot (disclosed); volume stays in tooltip, table and summary.
      if (volH < MIN_VOLUME_PANE) return { kind: 'short' as const };
      const block = gap + volH;
      const layout = base(pv, width - lane, height - block, text, ctx);
      if (layout.kind !== 'plot' || layout.projection.kind !== 'xy') return { kind: 'short' as const };
      const price = layout.plot;
      const volume = { x: price.x, y: price.y + price.height + gap, width: price.width, height: volH };
      const plot = { x: price.x, y: price.y, width: price.width, height: price.height + block };
      const data = candleData(view, fields, layout.projection.x, price.x, price.width, true);
      // A fresh labeler and tracker per attempt: a labeler reports a throwing formatter once only.
      const failures = new VolumeTickFailures();
      const label = createNumberTickLabeler({ locale: ctx.locale, tickFormat: failures.author(tickFormat), onError: failures.report });
      const ticks = volumeTicks(data.volumeMax, volH, metrics.lineHeight, label, failures);
      const lines = wrapText(title, plot.height, metrics);
      let widest = 0;
      for (const t of ticks) widest = Math.max(widest, metrics.width(t.label));
      const titleWidth = lines.length ? GAP + lines.length * metrics.lineHeight : 0;
      const need = Math.ceil(TICK_GAP + widest + titleWidth);
      return { kind: 'plot' as const, layout, price, volume, plot, gap, block, data, ticks, lines, widest, titleWidth, need, failures };
    };

    // The lane only grows, up to a share of the width, so the passes settle; labels that the settled lane
    // still cannot hold are fitted below (shortened, or hidden and counted) rather than pushing the plot away.
    const cap = Math.floor(width * MAX_LANE_SHARE);
    let lane = 0;
    let fit = attempt(lane);
    for (let pass = 1; pass < LANE_PASSES && fit.kind === 'plot'; pass++) {
      const next = Math.min(cap, Math.max(lane, fit.need));
      if (next === lane) break;
      const wider = attempt(next);
      // A lane that leaves no readable plot is not taken: the narrower lane and fitted labels are kept.
      if (wider.kind !== 'plot') break;
      lane = next;
      fit = wider;
    }
    if (fit.kind === 'none') return { layout: sized(fit.full), failed: false };
    if (fit.kind === 'short') return priceOnly(base(pv, width, height, text, ctx), true);

    const { layout, price, volume, plot, gap, block, data, ticks, failures } = fit;
    const texts: PlacedText[] = [];
    for (const t of layout.texts) texts.push(t.role === 'tick-x' || t.role === 'title-x' ? moveText(t, block) : t);
    const volumeScale = linearScale([0, data.volumeMax > 0 ? data.volumeMax : 1], [volume.y + volume.height, volume.y]);
    const right = price.x + price.width;
    // What the reserved lane holds: tick labels first (they carry the values), then the title beside them.
    let hidden = 0;
    const room = lane - TICK_GAP;
    let shown = ticks.map(t => t.label);
    if (fit.widest > room) {
      const prepared = prepareLabels([ticks]);
      shown = ticks.map(t => middleText(t.label, room, prepared, metrics) ?? '');
      const distinct = new Set(shown.filter(Boolean));
      // Shortened labels must stay distinct, or they would read as the same value.
      if (distinct.size !== shown.filter(Boolean).length) shown = ticks.map(() => '');
      for (const l of shown) if (!l) hidden++;
    }
    // No tick label read as a value at all (every candidate blank or alike): the volume axis is unlabelled, disclosed.
    if (!ticks.length) hidden++;
    // AX160 only when a tick the reader sees carries the default label in place of the author's.
    const failed = failures.drawn(ticks.filter((_, i) => !!shown[i]));
    let widest = 0;
    for (const l of shown) if (l) widest = Math.max(widest, metrics.width(l));
    const lines = fit.lines.length && TICK_GAP + widest + fit.titleWidth <= lane + 0.5 ? fit.lines : [];
    if (fit.lines.length && !lines.length) hidden++;
    for (let i = 0; i < ticks.length; i++) {
      if (!shown[i]) continue;
      const t = ticks[i]!;
      texts.push(placeText([shown[i]!], t.label, right + TICK_GAP, volumeScale.map(t.value), 'start', 'middle', 0, 'tick-y', metrics));
    }
    if (lines.length) {
      let along = 0;
      for (const line of lines) along = Math.max(along, metrics.width(line));
      // Centered on the volume pane, moved only as far as needed to stay beside the plot.
      const center = volume.y + volume.height / 2;
      const cy = Math.max(plot.y + along / 2, Math.min(plot.y + plot.height - along / 2, center));
      const cx = right + TICK_GAP + widest + GAP + (lines.length * metrics.lineHeight) / 2;
      texts.push(placeText(lines, title, cx, cy, 'middle', 'middle', -90, 'title-y', metrics));
    }
    const panes: FinancePanes = {
      price, volume, volumeScale, volumeTicks: ticks, volumeMax: data.volumeMax,
      divider: price.y + price.height + gap / 2, bins: data.bins, volumeFormatFailed: failed, volumeLabelsHidden: hidden,
      volumeOmitted: false,
    };
    // Hidden volume labels join the y fit, which gives the reader the L1 note and AX143.
    const fitted = hidden ? { ...layout.fit, y: { ...layout.fit.y, hidden: layout.fit.y.hidden + hidden } } : layout.fit;
    return { layout: withPanes({ ...layout, plot, texts, fit: fitted }, panes), failed };
  };

  return {
    prepareTicks(view, ctx) {
      if (isAligned(view)) shared.prepareTicks?.(priceView(view, metaForResolved(stateRef, ctx.resolved)), ctx);
    },
    // Read from the same revision the layout was computed from: ctx.resolved's meta and the layout's panes.
    layoutDiagnostics(view, ctx, layout): readonly DiagnosticInput[] {
      if (!isAligned(view)) return [];
      const meta = metaForResolved(stateRef, ctx.resolved);
      const out = [...(shared.layoutDiagnostics?.(priceView(view, meta), ctx, layout) ?? [])];
      const panes = financePanes(layout);
      if (panes?.volumeFormatFailed && meta.volumeField) {
        out.push(createDiagnostic('AX160', 'none', { field: meta.volumeField }, 'presentation'));
      }
      const saturated = panes?.volume ? panes.bins?.saturated ?? 0 : 0;
      if (saturated > 0 && meta.volumeField) out.push(saturatedVolume(meta.volumeField, saturated));
      if (panes?.volumeOmitted && meta.volumeField) out.push(omittedVolume(meta.volumeField));
      return out;
    },
    layoutKey(view, size, style, fontEpoch, ctx) {
      if (!isAligned(view)) return shared.layoutKey(view, size, style, fontEpoch, ctx);
      const meta = metaForResolved(stateRef, ctx.resolved);
      const data = frameMeta(stateRef, view.frame);
      const key = [...shared.layoutKey(priceView(view, meta), size, style, fontEpoch, ctx)];
      // Volume extent, dense bins and the volume axis depend on the slots in view, not only on the domains.
      key.push(shownVolume(view, data) !== null, view.frame, flagsForFrame(view.frame, data), view.visibleSlots.start,
        view.visibleSlots.end, meta.priceAxisLabel, meta.volumeAxisLabel, meta.volumeLabel, meta.volumeUnit, meta.volumeFormat);
      return key;
    },
    compute(view, size, text, ctx) {
      if (!isAligned(view)) return shared.compute(view, size, text, ctx);
      return build(view, size, text, ctx).layout;
    },
  };
}
