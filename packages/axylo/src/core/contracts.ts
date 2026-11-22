/**
 * Internal contracts of Axylo. Every module is written against these types and against nothing else in
 * another module. Changing this file is an architecture change: it needs a reason recorded in the commit.
 *
 * Pipeline (docs/03-plan-typescript-release.md, section 2):
 *
 *   options ─► normalize ─► Frame ─┬─► View ─► Layout ─► Scene ─► MarkRenderer / TextLayer
 *                │ diagnostics      ├─► lookup (exact values)
 *                                   ├─► summary, table
 *                                   └─► focus model
 *
 * Rule that must never be broken: exact values, the table, keyboard navigation, tooltips, summaries and
 * events read the Frame. The Scene is geometry for drawing and may be simplified. Nothing reads values
 * back from the Scene.
 */
import type { Diagnostic, XValue } from '../public';

// ───────────────────────────── diagnostics ─────────────────────────────

/**
 * What a diagnostic did to the chart. Drives the reader's note (spec F12): only 'omitted' and 'changed'
 * count towards "N values not shown"; a warning about contrast or an unknown option does not.
 */
export type DiagnosticEffect = 'none' | 'omitted' | 'changed' | 'series-disabled' | 'chart-error';

/** A diagnostic before the chart adds its own name. */
export type DiagnosticInput = Omit<Diagnostic, 'chart'> & {
  readonly effect: DiagnosticEffect;
  /**
   * 'call': found while validating a create, update or append call; a `strict` chart throws from that call.
   * 'presentation': found later (a contrast check after a CSS change, a formatter that throws on a lazily
   * built table cell, a label that no longer fits after a resize); reported when found, never thrown.
   */
  readonly origin: 'call' | 'presentation';
};

export interface DiagnosticSink {
  /** Adds one diagnostic. The sink merges by code, field and effect: counts are added, example rows capped at 10. */
  add(d: DiagnosticInput): void;
}

// ───────────────────────────── frame ─────────────────────────────

/**
 * What an x value is.
 *  number   – a plain measure.
 *  time     – an instant. Position = epoch milliseconds (UTC). Shown in `XColumn.timeZone`.
 *  date     – a calendar date, month or year. Position = epoch milliseconds of that date at 00:00 UTC;
 *             always formatted in UTC, so it reads the same in every viewer zone.
 *  wall     – a date-time written without an offset. Position = the written fields read as if UTC;
 *             always formatted in UTC ("shown as written").
 *  category – a name. Position = index in first-seen order (bar, line) or given order (donut).
 */
export type XKind = 'number' | 'time' | 'date' | 'wall' | 'category';

/** State of one slot of an aligned series. */
export const SLOT_VALUE = 0;         // a finite number
export const SLOT_NULL = 1;          // explicit null (or NaN in a typed column, or an empty string): "no data", silent
export const SLOT_INVALID = 2;       // present but not plottable (NaN or infinity in a row, a stray string): reported
export const SLOT_NO_ROW = 3;        // this series has no observation at this x and none was expected; neighbours may be joined across it
export const SLOT_GAP = 4;           // an expected step of this series is absent (AX105): never joined across
export const SLOT_ABSENT_FIELD = 5;  // the row exists but the field's key is absent or undefined (AX102)
export type SlotState = 0 | 1 | 2 | 3 | 4 | 5;
/**
 * `missing: 'zero'` on a value field is applied by normalization: slots that would be SLOT_NULL, SLOT_NO_ROW,
 * SLOT_GAP or SLOT_ABSENT_FIELD become SLOT_VALUE with y = 0 and row = -1. SLOT_INVALID is never turned into zero.
 */

/** Half-open range of indexes. */
export interface IndexRange { readonly start: number; readonly end: number }

export interface XColumn {
  readonly kind: XKind;
  /** Strictly ascending positions, one per slot. For 'category': 0, 1, 2, … */
  readonly values: Float64Array;
  /** For 'category': the name of each position. Otherwise null. */
  readonly categories: readonly string[] | null;
  /** For 'time': the resolved IANA zone ('UTC', 'America/Los_Angeles', …; 'local' is resolved before it gets here). Otherwise null. */
  readonly timeZone: string | null;
  /** For 'date': the precision the values were written in ('2026-02' is a month); the finest one if they are mixed. Otherwise null. */
  readonly dateUnit: 'day' | 'month' | 'year' | null;
  /** For 'category': true when the author declared the categories ordered, so the axis may be thinned (spec L1). */
  readonly ordered: boolean;
}

/** The caller's data behind a frame, for events and for the table's provenance. */
export interface RowSource {
  /** The caller's row at a source index (materialized on demand for typed columns), or null if it is no longer retained. */
  rowAt(sourceIndex: number): unknown;
}

/** One series of an aligned frame: a y value and a state for every x slot. */
export interface Series {
  /** Stable identity: the series value (long form) or the field name (wide form). Used for colors and toggling. */
  readonly key: string;
  /** Name shown to the reader. */
  readonly label: string;
  /** The value field this series was read from, for diagnostics. */
  readonly field: string;
  readonly unit: string | null;
  readonly valueScale: 'percent' | 'ratio' | null;
  /** False when the series cannot be drawn (duplicate x, AX108). It stays in the frame so the table and summary can say so. */
  readonly drawable: boolean;
  /** y per slot. NaN wherever `slot` is not SLOT_VALUE. May be a view on the caller's typed column. */
  readonly y: Float64Array | Float32Array;
  readonly slot: Uint8Array;
  /** Index of the caller's row each slot came from, -1 where there is none. null means "slot i came from row i" (typed columns). */
  readonly row: Int32Array | null;
}

/** One series of a point frame (scatter): its own x and y, sorted by x then y. */
export interface PointSeries {
  readonly key: string;
  readonly label: string;
  readonly drawable: boolean;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly row: Int32Array | null;
  /**
   * Observations that have a valid x and no plottable y: null, an absent field, or a value that cannot be
   * plotted (the rows AX103 and AX106 report). Sorted by x, duplicates kept. They are not points: nothing is
   * drawn or picked for them. They exist so the table can list them as "No data" (spec F2 and F12: the note
   * sends the reader to the table, so the table must show every row that was left out). Absent or empty when
   * there are none. With `missing: 'zero'` on the y field, null and absent values are points with y = 0 instead
   * and do not appear here; a value that cannot be plotted is never imputed.
   */
  readonly missingX?: Float64Array;
  /** Source row index of each entry of `missingX`, in the same order; present whenever `missingX` and `row` are. */
  readonly missingRow?: Int32Array;
}

/**
 * The normalized, lossless data. Immutable: an update or append produces a new frame with a higher revision.
 * Buffers may be shared between revisions; a streaming store appends into spare capacity and hands out
 * subarray views, so an append does not copy what is already there.
 */
interface FrameBase {
  readonly revision: number;
  /** Changes when the data is replaced or the encoding changes; survives append and eviction. A DatumRef is only meaningful within one epoch. */
  readonly epoch: number;
  readonly source: RowSource;
}

export interface AlignedFrame extends FrameBase {
  readonly shape: 'aligned';
  readonly x: XColumn;
  readonly series: readonly Series[];
  /** Number of x slots. */
  readonly length: number;
  readonly xLabel: string;
  readonly yLabel: string | null;
}

export interface PointFrame extends FrameBase {
  readonly shape: 'points';
  readonly xKind: Exclude<XKind, 'category'>;
  readonly timeZone: string | null;
  readonly series: readonly PointSeries[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly xUnit: string | null;
  readonly yUnit: string | null;
}

/** Donut data: every category the caller gave, in the given order, before any grouping into "Other". */
export interface DonutFrame extends FrameBase {
  readonly shape: 'donut';
  readonly labels: readonly string[];
  /** NaN where `slot` is not SLOT_VALUE. */
  readonly values: Float64Array;
  readonly slot: Uint8Array;
  readonly row: Int32Array | null;
  readonly valueLabel: string;
  readonly unit: string | null;
  readonly valueScale: 'percent' | 'ratio' | null;
}

export type Frame = AlignedFrame | PointFrame | DonutFrame;

/**
 * Join rule for lines and areas (spec F2). Two consecutive SLOT_VALUE slots i < j of one series are joined
 * if and only if every slot strictly between them is SLOT_NO_ROW. A value with no joined neighbour on either
 * side is an isolated point and must be drawn as a visible point.
 */

// ───────────────────────────── formatting ─────────────────────────────

export interface Formatters {
  /** Value as readers see it in tooltip, table and announcements: full precision per spec F6, unit appended. */
  value(seriesIndex: number, v: number): string;
  /** x as readers see it in tooltip, table and announcements. For 'time' it includes the zone abbreviation. */
  x(position: number): string;
  /** Text for a slot that is not a value: "No data", "No observation". */
  missing(state: SlotState): string;
  /** A share of a whole (0–1) as a percentage in the chart's locale, for donut slices and stack shares. */
  percent(ratio: number): string;
  /** A count (of values, rows, series) in the chart's locale. */
  count(n: number): string;
}

// ───────────────────────────── scales and ticks ─────────────────────────────

export interface ContinuousScale {
  readonly type: 'linear' | 'time';
  readonly domain: readonly [number, number];
  /** Pixel range in CSS px; range[0] maps domain[0]. */
  readonly range: readonly [number, number];
  map(value: number): number;
  invert(pixel: number): number;
}

export interface BandScale {
  readonly type: 'band';
  readonly count: number;
  readonly range: readonly [number, number];
  /** Distance between the starts of adjacent bands. */
  readonly step: number;
  /** Width of one band after padding. */
  readonly bandwidth: number;
  /** Start pixel of band i. */
  map(index: number): number;
  center(index: number): number;
  /** Band under a pixel, clamped to [0, count - 1]; -1 when count is 0. */
  invert(pixel: number): number;
}

export type XScale = ContinuousScale | BandScale;

export interface Tick {
  /** Position in the scale's domain (category: index). */
  readonly value: number;
  readonly label: string;
}

/**
 * Candidate tick sets for one axis, from densest to sparsest. Layout picks the densest set that fits.
 * Every set is a subset of "nice" positions for that axis; for a band scale the sets are every k-th category.
 */
export type TickCandidates = readonly (readonly Tick[])[];

// ───────────────────────────── view ─────────────────────────────

/** A reference line (one position) or band (two) after its values were turned into axis positions. */
export interface ResolvedReference {
  readonly axis: 'x' | 'y';
  readonly from: number;
  /** Equal to `from` for a line. */
  readonly to: number;
  readonly label: string;
}

/** How one series is told apart without color (spec A5): a marker shape and dash patterns. */
export interface SeriesCue {
  readonly marker: MarkerShape;
  readonly dash: DashStyle;
}

/**
 * Stacking (spec F10). Positive and negative values accumulate on their own sides of zero.
 * `positive[k]` is the upper boundary of the k-th stacked series' positive part, `positive[k - 1]` (or zero
 * for k = 0) its lower boundary; likewise `negative`. A component that is not SLOT_VALUE contributes zero
 * height and sets `incomplete` for that slot.
 */
export interface StackView {
  /** Frame series indexes in accumulation order (hidden series are left out). */
  readonly order: readonly number[];
  readonly positive: readonly Float64Array[];
  readonly negative: readonly Float64Array[];
  /** 1 where at least one visible component is missing; null when every stack is complete. */
  readonly incomplete: Uint8Array | null;
}

interface CartesianViewBase {
  readonly revision: number;
  /** Visibility per series (legend toggles). */
  readonly visible: readonly boolean[];
  readonly cues: readonly SeriesCue[];
  /** Full x domain of the data (plus the author's domain), and the zoomed domain actually shown. */
  readonly xFull: readonly [number, number];
  readonly xDomain: readonly [number, number];
  /** Value domain after the rules of spec F1 and F7. */
  readonly yDomain: readonly [number, number];
  readonly references: readonly ResolvedReference[];
  readonly compact: boolean;
}

/** What is currently shown of an aligned frame. */
export interface AlignedView extends CartesianViewBase {
  readonly kind: 'line' | 'area' | 'bar';
  readonly frame: AlignedFrame;
  /** True only for horizontal bars. */
  readonly horizontal: boolean;
  /** Slots whose x lies inside xDomain. Pointer and keyboard only ever land on these. */
  readonly visibleSlots: IndexRange;
  /**
   * Per series, the slot range to draw: visibleSlots widened on each side to that series' nearest value it
   * may be joined to, so a line reaches the plot edge. Never used for picking.
   */
  readonly drawSlots: readonly IndexRange[];
  readonly stack: StackView | null;
}

export interface ScatterView extends CartesianViewBase {
  readonly kind: 'scatter';
  readonly frame: PointFrame;
  /** Per series, the range of its points whose x lies inside xDomain. */
  readonly visiblePoints: readonly IndexRange[];
}

/** One drawn slice or legend entry of a donut (spec F8). */
export interface DonutSlice {
  readonly key: string;
  readonly label: string;
  /** Indexes into the donut frame: one for an ordinary slice, several for "Other (n)". */
  readonly members: readonly number[];
  /** null = "No data". */
  readonly value: number | null;
  /** Share of the total, 0–1; null when there is no value. */
  readonly ratio: number | null;
  /** Start and end angle in radians, clockwise from 12 o'clock; null when nothing is drawn (zero or no data). */
  readonly angles: readonly [number, number] | null;
  /**
   * Palette slot for this slice: its ordinal among the entries that are not "Other", so eight slices never
   * share a color whatever arcless entries sit between them. null for "Other" (the muted token). The legend
   * uses the same index.
   */
  readonly colorIndex: number | null;
}

export interface DonutView {
  readonly kind: 'donut';
  readonly revision: number;
  readonly frame: DonutFrame;
  readonly slices: readonly DonutSlice[];
  readonly total: number;
}

export type View = AlignedView | ScatterView | DonutView;

// ───────────────────────────── text measurement ─────────────────────────────

export interface TextStyle {
  /** CSS font shorthand resolved from the page, e.g. "400 12px Inter, sans-serif". */
  readonly font: string;
  readonly letterSpacing: number;
  readonly wordSpacing: number;
  /** Line height in CSS px. */
  readonly lineHeight: number;
}

/** Injected into layout. Browser: canvas measureText with the page's computed spacing applied. Tests: fixed metrics. */
export interface TextMeasurer {
  width(text: string, style: TextStyle): number;
}

// ───────────────────────────── layout ─────────────────────────────

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export type LabelRemedy = 'thinned' | 'wrapped' | 'rotated' | 'truncated';

export interface PlacedText {
  /** What is drawn (possibly truncated with an ellipsis in the middle). */
  readonly lines: readonly string[];
  /** The complete text, for tooltip and table. */
  readonly full: string;
  /** Anchor point in CSS px relative to the plot container. */
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly baseline: 'top' | 'middle' | 'bottom';
  /** Degrees, clockwise; 0, -45 or -90 in 1.0. */
  readonly rotate: number;
  readonly role: 'tick-x' | 'tick-y' | 'title-x' | 'title-y' | 'value' | 'reference' | 'message';
  /** Bounding box after rotation, for the overlap test. */
  readonly box: Rect;
}

/** The mapping from data to pixels that scene building and lookup must share. */
export type Projection =
  | { readonly kind: 'xy'; readonly x: XScale; readonly y: ContinuousScale }
  /** Bars: `band` runs along the category axis, `value` along the other; `horizontal` swaps the screen axes. */
  | { readonly kind: 'bands'; readonly horizontal: boolean; readonly band: XScale; readonly value: ContinuousScale }
  | { readonly kind: 'ring'; readonly cx: number; readonly cy: number; readonly r0: number; readonly r1: number };

/** What label fitting did on one axis, in the order it did it (spec L1). */
export interface AxisLabelFit {
  readonly remedies: readonly LabelRemedy[];
  /** Labels that could not be shown after every remedy. More than zero means the reader gets the L1 note. */
  readonly hidden: number;
}

interface LayoutSize {
  /** Size of the plot container (the element that holds marks and tick text), CSS px. */
  readonly width: number;
  readonly height: number;
}

/**
 * Layout of the plot container only. The title, summary, legend, controls, notes and table are ordinary
 * HTML around it and are laid out by the browser; the plot container's size is whatever is left.
 */
export type Layout =
  | (LayoutSize & {
      readonly kind: 'plot';
      /** Where marks are drawn. */
      readonly plot: Rect;
      readonly projection: Projection;
      readonly xTicks: readonly Tick[];
      readonly yTicks: readonly Tick[];
      readonly texts: readonly PlacedText[];
      readonly fit: { readonly x: AxisLabelFit; readonly y: AxisLabelFit };
    })
  /** Compact variant (spec 3.7): marks fill the container, no text. */
  | (LayoutSize & { readonly kind: 'compact'; readonly plot: Rect; readonly projection: Projection })
  /** The plot would be below 120 × 80 CSS px (spec L8): only the summary and the table control are shown. */
  | (LayoutSize & { readonly kind: 'too-small' })
  /** Loading, empty or error state (spec L7): a message instead of marks. */
  | (LayoutSize & { readonly kind: 'message'; readonly text: PlacedText })
  /** The container has no size yet (hidden or detached). Nothing is drawn until it gets one. */
  | (LayoutSize & { readonly kind: 'unmeasured' });

// ───────────────────────────── scene ─────────────────────────────

/**
 * A color that is resolved late, so marks follow the page's live CSS paint values.
 */
export type Paint =
  | { readonly kind: 'series'; readonly index: number }   // palette slot or the author's color for that series
  | { readonly kind: 'token'; readonly name: 'axis' | 'grid' | 'reference' | 'muted' | 'focus' | 'background' | 'text' }
  | { readonly kind: 'none' };

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus' | 'triangle-down' | 'star';

/** Dash pattern in normal mode and under `prefers-contrast: more` or forced colors. null = solid. */
export interface DashStyle {
  readonly normal: readonly number[] | null;
  readonly contrast: readonly number[] | null;
}

/** A polyline. `xy` is x0,y0,x1,y1,… in CSS px; a NaN pair lifts the pen. */
export interface PathMark {
  readonly type: 'path';
  readonly series: number;
  readonly xy: Float32Array;
  readonly stroke: Paint;
  readonly strokeWidth: number;
  readonly dash: DashStyle;
}

/**
 * Filled regions between an upper and a lower boundary (area, stacked area). Each boundary is its own packed
 * polyline, so each can keep its own extremes when simplified (spec F5), and adjacent stack bands can share
 * the very same boundary array. `runs` holds quadruples (upperStart, upperCount, lowerStart, lowerCount) in
 * vertices; one quadruple is one polygon: its upper vertices forward, then its lower vertices in reverse.
 */
export interface AreaMark {
  readonly type: 'area';
  readonly series: number;
  readonly upper: Float32Array;
  readonly lower: Float32Array;
  readonly runs: Uint32Array;
  readonly fill: Paint;
  readonly opacity: number;
}

/** Axis-aligned rectangles: x,y,width,height quadruples in CSS px. */
export interface RectMark {
  readonly type: 'rects';
  readonly series: number;
  readonly xywh: Float32Array;
  readonly fill: Paint;
  /** 'missing' draws the "no data" mark of spec F2 instead of a filled bar. */
  readonly variant: 'bar' | 'missing';
  /**
   * A second cue on top of the fill, for charts with more than eight series (spec F9): a pattern drawn in the
   * background color over the fill. Absent or 'none' for the first eight.
   */
  readonly pattern?: 'none' | 'diagonal' | 'cross' | 'dots';
}

/** Markers: x,y pairs in CSS px. */
export interface PointMark {
  readonly type: 'points';
  readonly series: number;
  readonly xy: Float32Array;
  readonly shape: MarkerShape;
  readonly size: number;
  readonly fill: Paint;
}

/** Annular sectors (donut). Angles in radians, clockwise from 12 o'clock. */
export interface ArcMark {
  readonly type: 'arcs';
  readonly cx: number;
  readonly cy: number;
  readonly r0: number;
  readonly r1: number;
  readonly angles: Float32Array; // start0,end0,start1,end1,…
  readonly fills: readonly Paint[];
  /** Gap between adjacent slices in CSS px (spec A5). */
  readonly gap: number;
}

export interface RuleMark {
  readonly type: 'rule';
  readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number;
  readonly stroke: Paint;
  readonly strokeWidth: number;
  readonly dash: readonly number[] | null;
  readonly role: 'grid' | 'axis' | 'tick' | 'reference' | 'cursor' | 'break';
}

/** A filled rectangle that is not data: a reference band. */
export interface BandMark {
  readonly type: 'band';
  readonly box: Rect;
  readonly fill: Paint;
  readonly opacity: number;
}

export type Mark = PathMark | AreaMark | RectMark | PointMark | ArcMark | RuleMark | BandMark;

/** Everything the mark renderer draws, back to front. Plain data: no functions, no DOM. */
export interface Scene {
  readonly width: number;
  readonly height: number;
  /** Marks are clipped to this rectangle unless their role is 'axis' or 'tick'. */
  readonly clip: Rect;
  readonly marks: readonly Mark[];
}

// ───────────────────────────── theme ─────────────────────────────

export type PaintToken = 'axis' | 'grid' | 'reference' | 'muted' | 'focus' | 'background' | 'text';

/** CSS color expressions per paint. May be `var(--axylo-series-1)` or an author's `var(--brand-1)`: unresolved. */
export interface PaintBindings {
  readonly tokens: Readonly<Record<PaintToken, string>>;
  /** One expression per series index, already including the author's `colors` by series key. */
  readonly series: readonly string[];
}

/** The same paints as concrete computed colors, plus what was detected about the page (spec L4, DX6). */
export interface ResolvedTheme {
  readonly scheme: 'light' | 'dark';
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly paints: PaintBindings;
}

// ───────────────────────────── rendering ─────────────────────────────

/** Transient decoration drawn above the scene: cursor rule and highlighted points (clipped to the plot), focus ring (not clipped). */
export interface Overlay {
  readonly clip: Rect;
  readonly clipped: readonly Mark[];
  readonly unclipped: readonly Mark[];
}

/**
 * Draws a scene's SVG marks using CSS paint bindings. The browser can restyle them and switch
 * dash patterns through the stylesheet.
 */
export interface MarkRenderer {
  readonly kind: 'canvas' | 'svg';
  /** The element to insert into the plot container. It must be aria-hidden. */
  readonly element: HTMLElement | SVGSVGElement;
  /** Draws the scene, replacing the previous one. Called at most once per animation frame. */
  draw(scene: Scene, bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void;
  /** Draws or clears (null) the overlay without redrawing the scene. */
  drawOverlay(overlay: Overlay | null, bindings: PaintBindings, theme: ResolvedTheme, devicePixelRatio: number): void;
  destroy(): void;
}

// ───────────────────────────── lookup ─────────────────────────────

/**
 * A datum by identity, not by position, so it still means the same thing after a streaming window slides.
 * Valid within one frame epoch.
 */
export type DatumRef =
  | { readonly kind: 'aligned'; readonly seriesKey: string; /** x position (category: its index in the frame that produced the ref; categories can slide when a streaming window evicts them, so a holder remaps by category name across frames of one epoch). */ readonly x: number }
  | { readonly kind: 'point'; readonly seriesKey: string; /** source row index */ readonly row: number; /** x position, so a ref to an evicted point can resolve to its nearest surviving neighbour */ readonly x: number }
  | { readonly kind: 'slice'; readonly sliceKey: string };

/** What the pointer is over, by the picking rule of the chart type (spec 3.6). */
export type PickTarget =
  | { readonly kind: 'x'; readonly x: number }                      // line, area, bar: every series at this x
  | { readonly kind: 'point'; readonly refs: readonly DatumRef[]; readonly count: number;      // scatter: nearest point and those coinciding with it (at most 8; `count` is the full number)
      /** Which rule decided what coincides with the nearest point: exact positions (the default when absent) or the device-pixel lattice. `Lookup.members` and `Lookup.has` use the same one. */
      readonly rule?: 'exact' | 'lattice' }
  | { readonly kind: 'slice'; readonly sliceKey: string };

/** One row of a tooltip or one announced point, as text. All text comes from the frame through the formatters. */
export interface DatumText {
  readonly ref: DatumRef;
  readonly seriesIndex: number;
  readonly seriesLabel: string;
  /** x as the reader sees it. */
  readonly x: string;
  /** The value with its unit, or "No data" / "No observation". */
  readonly value: string;
  readonly state: SlotState;
  /** Share of the whole for a donut slice, formatted; null elsewhere. */
  readonly percent: string | null;
  /** Source row index, or -1. */
  readonly row: number;
}

export interface TooltipModel {
  /** Heading: the x value (with its time zone for instants), the category, or the slice label. */
  readonly title: string;
  /** At most eight rows (spec I1). */
  readonly rows: readonly DatumText[];
  /** Rows before truncation. */
  readonly count: number;
  /** Stack total with "incomplete" where it applies, already formatted; null when the chart does not stack. */
  readonly total: string | null;
}

export type StepDirection = 'next' | 'previous' | 'first' | 'last' | 'series-next' | 'series-previous' | 'page-next' | 'page-previous';

/**
 * Exact answers from the frame for one view and projection, independent of how the scene was simplified.
 * Built once per (view, layout); cheap to build: binary search over x for aligned frames, a grid index for scatter.
 */
export interface Lookup {
  /**
   * What is under a pixel of the plot container, or null. Scatter: among the points within 24 CSS px of the
   * pointer, the closest; points whose distance differs from the closest one's by less than half a device
   * pixel are tied with it, and a tie goes to the latest source row. To keep a pick's cost independent of the
   * number of points, positions may be compared after rounding to the device-pixel lattice (an error of at most
   * 0.71 device px); the datum's reported values are always exact. A donut slice too thin to see is drawn,
   * and picked, at a minimum of 1 CSS px of arc; its value and share are reported unchanged.
   * Pointer positions are known to one CSS pixel (Firefox and WebKit report whole pixels): a position up to
   * 1 CSS px outside the plot rectangle is picked as if on the nearest point of its edge; further out,
   * nothing is picked.
   */
  pick(px: number, py: number): PickTarget | null;
  /**
   * The data a pick target stands for, in the order a tooltip lists them: for a point target, every point of
   * the group that coincides with its first ref by the target's own rule (`target.count` of them, of which
   * `target.refs` are the first eight); for an x target, the visible series' data at that x; for a slice,
   * the slice. `from` and `count` page through them. Paging, dismissal and selection ask here, so nothing
   * outside the lookup rebuilds a group by another rule. Cost: proportional to `from + count`, never to the
   * group's size beyond that or to the data.
   */
  members(target: PickTarget, from: number, count: number): readonly DatumRef[];
  /** Whether `ref` is one of the target's members, by the same rule. Cost independent of the group's size. */
  has(target: PickTarget, ref: DatumRef): boolean;
  /**
   * Where the datum sits in its series' columns in this frame: the x slot of an aligned datum, the point's
   * index in its `PointSeries`, the slice's index; -1 when it is not in the frame. A caller reads normalized
   * values through it without searching and without reading source rows again.
   */
  slot(ref: DatumRef): number;
  tooltip(target: PickTarget): TooltipModel;
  /** The datum to focus when the keyboard takes over from a pointer target. */
  primary(target: PickTarget): DatumRef | null;
  datum(ref: DatumRef): DatumText | null;
  /** Where the datum is drawn, for the cursor and focus ring; null if it is not visible. */
  anchor(ref: DatumRef): Rect | null;
  /**
   * Position for "point 4 of 120" (spec A3). Aligned charts: `count` is the number of visible x slots and
   * `ordinal` the zero-based place of the datum's x among them, whatever its series and whether or not it
   * holds a value (a "No data" slot has a place too). Scatter: place among all visible points in x then y
   * order. Donut: slice order. -1 only when the datum is not in the current view.
   */
  readonly count: number;
  ordinal(ref: DatumRef): number;
  /** Keyboard order per chart type (spec 3.6). `from` null starts at the first datum. Skips hidden series. */
  step(from: DatumRef | null, direction: StepDirection): DatumRef | null;
  /**
   * Where focus should be after the data or the view changed. A datum is "there" only if its series is
   * visible and drawable and its x (or point) is inside the current view. If it is: itself. If its series is
   * hidden but its x is in view: the primary datum at that x. Otherwise the nearest datum of its series in
   * view after it, else before it; for a donut slice folded into "Other", the "Other" slice. Else null.
   * `step` always starts from the resolved datum, so focus can never get stuck on something out of reach.
   */
  resolve(ref: DatumRef): DatumRef | null;
}

// ───────────────────────────── reader model ─────────────────────────────

/** The table of spec A4, built lazily from the frame: nothing is materialized until a page is asked for. */
export interface TableModel {
  readonly caption: string;
  /** First entry is the x column. */
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly pageSize: number;
  /** Cells of one row as text; first cell is the row header. null outside the range. */
  row(ordinal: number): readonly string[] | null;
  /** Zero-based page that contains the first row at or after an x value; null if there is none. */
  pageForX(x: XValue): number | null;
}

/** Everything a reader gets as text (spec A1, C1). */
export interface ReaderModel {
  /** Accessible name: the title, or a generated one. Empty when the chart is named by `labelledBy`. */
  readonly name: string;
  /** Generated summary plus the author's description, including time zone and omission statements. */
  readonly summary: string;
  /** The reader's note of spec F12 and L1, or null. */
  readonly note: string | null;
  /** null for the compact variant and when the table is turned off. */
  readonly table: TableModel | null;
}

// ───────────────────────────── environment ─────────────────────────────

/** Everything outside the options and data that output depends on. Part of every cache key that needs it. */
export interface Environment {
  readonly locale: string;
  /** The viewer's zone, used when a time field says 'local'. */
  readonly timeZone: string;
  readonly devicePixelRatio: number;
  readonly reducedMotion: boolean;
  readonly textStyle: TextStyle;
  /** Increases whenever web fonts finish loading; part of the layout cache key. */
  readonly fontEpoch: number;
  readonly development: boolean;
}

export type { Diagnostic, XValue };

