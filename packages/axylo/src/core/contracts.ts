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

/** A diagnostic before the chart adds its own name. */
export type DiagnosticInput = Omit<Diagnostic, 'chart'>;

export interface DiagnosticSink {
  /** Adds one diagnostic. Diagnostics with the same code and field are merged by the sink (counts added, rows capped at 10). */
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
export const SLOT_VALUE = 0;    // a finite number
export const SLOT_NULL = 1;     // explicit null: "no data", silent
export const SLOT_INVALID = 2;  // present but not plottable (NaN, infinity, stray string, key absent in this row): reported
export const SLOT_NO_ROW = 3;   // this series has no observation at this x and none was expected; neighbours may be joined across it
export const SLOT_GAP = 4;      // an expected step of this series is absent (AX105): never joined across
export type SlotState = 0 | 1 | 2 | 3 | 4;

export interface XColumn {
  readonly kind: XKind;
  /** Strictly ascending positions, one per slot. For 'category': 0, 1, 2, … */
  readonly values: Float64Array;
  /** For 'category': the name of each position. Otherwise null. */
  readonly categories: readonly string[] | null;
  /** For 'time': the resolved IANA zone ('UTC', 'America/Los_Angeles', …; 'local' is resolved before it gets here). Otherwise null. */
  readonly timeZone: string | null;
  /** For 'date': the coarsest unit every value falls on. Otherwise null. */
  readonly dateUnit: 'day' | 'month' | 'year' | null;
}

/** One series of an aligned frame: a y value and a state for every x slot. */
export interface Series {
  /** Stable identity: the series value (long form) or the field name (wide form). Used for colors and toggling. */
  readonly key: string;
  /** Name shown to the reader. */
  readonly label: string;
  readonly unit: string | null;
  readonly valueScale: 'percent' | 'ratio' | null;
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
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly row: Int32Array | null;
}

/**
 * The normalized, lossless data. Immutable: an update or append produces a new Frame with a higher revision
 * (it may share buffers with the previous one where nothing changed).
 */
export interface AlignedFrame {
  readonly shape: 'aligned';
  readonly revision: number;
  readonly x: XColumn;
  readonly series: readonly Series[];
  /** Number of x slots. */
  readonly length: number;
  /** Field metadata for labels and formatting. */
  readonly xLabel: string;
  readonly yLabel: string | null;
}

export interface PointFrame {
  readonly shape: 'points';
  readonly revision: number;
  readonly xKind: Exclude<XKind, 'category'>;
  readonly timeZone: string | null;
  readonly series: readonly PointSeries[];
  readonly xLabel: string;
  readonly yLabel: string;
  readonly xUnit: string | null;
  readonly yUnit: string | null;
}

export type Frame = AlignedFrame | PointFrame;

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

/** What is currently shown of a frame: which series, which x range, which value range. */
export interface View {
  readonly frame: Frame;
  readonly revision: number;
  /** Visibility per series (legend toggles). */
  readonly visible: readonly boolean[];
  /** Full x domain of the data (plus author domain), and the zoomed domain actually shown. */
  readonly xFull: readonly [number, number];
  readonly xDomain: readonly [number, number];
  /** Value domain after the rules of spec F1 and F7. */
  readonly yDomain: readonly [number, number];
  /** For aligned frames: first and last slot inside xDomain (inclusive), widened by one slot each side so lines reach the edge. */
  readonly i0: number;
  readonly i1: number;
  /** Stacking, when the chart stacks: cumulative lower and upper bound per series per slot, positives and negatives apart. */
  readonly stack: { readonly lo: readonly Float64Array[]; readonly hi: readonly Float64Array[]; readonly incomplete: Uint8Array } | null;
}

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

export type LabelRemedy = 'none' | 'thinned' | 'wrapped' | 'rotated' | 'truncated';

export interface PlacedText {
  /** What is drawn (possibly truncated with an ellipsis in the middle). */
  readonly lines: readonly string[];
  /** The complete text, for tooltip and table. */
  readonly full: string;
  /** Anchor point in CSS px relative to the figure's plot container. */
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly baseline: 'top' | 'middle' | 'bottom';
  /** Degrees, clockwise; 0 or -45 in 1.0. */
  readonly rotate: number;
  readonly role: 'tick-x' | 'tick-y' | 'title-x' | 'title-y' | 'value' | 'reference';
  /** Bounding box after rotation, for the overlap test. */
  readonly box: Rect;
}

export interface Layout {
  /** Size of the plot container (the element that holds marks and tick text), CSS px. */
  readonly width: number;
  readonly height: number;
  /** Where marks are drawn. */
  readonly plot: Rect;
  readonly xTicks: readonly Tick[];
  readonly yTicks: readonly Tick[];
  readonly texts: readonly PlacedText[];
  /** What label fitting had to do on the category or time axis (spec L1). */
  readonly remedy: LabelRemedy;
  /** Category labels that could not be shown after every remedy. More than zero means the reader gets the L1 note. */
  readonly hiddenLabels: number;
  /** True when the plot is below the minimum size and only the summary and table control are shown (spec L8). */
  readonly tooSmall: boolean;
}

// ───────────────────────────── scene ─────────────────────────────

/**
 * A color that is resolved late, so an SVG renderer can use CSS variables and a canvas renderer can look
 * the value up in the resolved theme.
 */
export type Paint =
  | { readonly kind: 'series'; readonly index: number }   // palette slot or the author's color for that series
  | { readonly kind: 'token'; readonly name: 'axis' | 'grid' | 'reference' | 'muted' | 'focus' | 'background' | 'text' }
  | { readonly kind: 'none' };

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross' | 'plus' | 'triangle-down' | 'star';

/** A polyline. `xy` is x0,y0,x1,y1,… in CSS px; a NaN pair lifts the pen. */
export interface PathMark {
  readonly type: 'path';
  readonly series: number;
  readonly xy: Float32Array;
  readonly stroke: Paint;
  readonly strokeWidth: number;
  /** null = solid. */
  readonly dash: readonly number[] | null;
}

/** A filled region between an upper and a lower polyline with the same x positions (area, stacked area). NaN pairs split it. */
export interface AreaMark {
  readonly type: 'area';
  readonly series: number;
  readonly xyTop: Float32Array;
  readonly xyBottom: Float32Array;
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

export type Mark = PathMark | AreaMark | RectMark | PointMark | ArcMark | RuleMark;

/** Everything the mark renderer draws, back to front. Plain data: no functions, no DOM. */
export interface Scene {
  readonly width: number;
  readonly height: number;
  /** Marks are clipped to this rectangle unless their role is 'axis' or 'tick'. */
  readonly clip: Rect;
  readonly marks: readonly Mark[];
}

// ───────────────────────────── theme ─────────────────────────────

/** Colors resolved from the page for one chart (spec L4, DX6). All are CSS color strings. */
export interface ResolvedTheme {
  readonly scheme: 'light' | 'dark';
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
  readonly background: string;
  readonly text: string;
  readonly axis: string;
  readonly grid: string;
  readonly muted: string;
  readonly reference: string;
  readonly focus: string;
  /** One color per series index, already including the author's `colors` by series key. */
  readonly series: readonly string[];
}

// ───────────────────────────── rendering ─────────────────────────────

/**
 * Draws a Scene's marks. Two implementations exist for the M1 comparison (canvas, svg); the rest of the
 * library does not know which one is in use.
 */
export interface MarkRenderer {
  readonly kind: 'canvas' | 'svg';
  /** The element to insert into the plot container. It must be aria-hidden. */
  readonly element: HTMLElement | SVGSVGElement;
  /** Draws the scene. Called at most once per animation frame. */
  draw(scene: Scene, theme: ResolvedTheme, devicePixelRatio: number): void;
  /** Draws transient decoration (cursor rule, focus ring, highlighted points) without redrawing the scene. */
  drawOverlay(marks: readonly Mark[], theme: ResolvedTheme, devicePixelRatio: number): void;
  destroy(): void;
}

// ───────────────────────────── lookup ─────────────────────────────

/** A place in the data: which series, which slot (aligned) or which point (points). */
export interface DatumRef {
  readonly series: number;
  readonly index: number;
}

/** Exact answers from the frame, independent of how the scene was simplified. */
export interface Lookup {
  /** Aligned frames: the slot whose x is nearest to a domain position, among slots inside [i0, i1]. Ties go to the later slot. -1 if none. */
  nearestSlot(xPosition: number, view: View): number;
  /** Point frames: the nearest point to a pixel within `radius` CSS px, or null. Ties go to the later row. */
  nearestPoint(px: number, py: number, radius: number, view: View, xScale: ContinuousScale, yScale: ContinuousScale): DatumRef | null;
  /** The next datum in keyboard order from `from`, or null at the end. Skips hidden series. */
  step(from: DatumRef | null, direction: 'next' | 'previous' | 'first' | 'last' | 'series-next' | 'series-previous' | 'page-next' | 'page-previous', view: View): DatumRef | null;
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
  readonly development: boolean;
}

export type { Diagnostic, XValue };
