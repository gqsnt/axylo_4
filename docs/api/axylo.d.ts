/**
 * Axylo public API: design sketch for the 1.0 plan (docs/03-plan-typescript-release.md).
 * Nothing here is implemented. The file exists so that the plan's examples are type-checked:
 *   npx -p typescript tsc -p docs/api
 * examples.ts must compile; every line marked @ts-expect-error in it must fail.
 */

// ---------- data ----------

/** Rows as an API returns them, or typed columns for large data. Both describe the same logical table. */
export type Data<Row> = readonly Row[] | { readonly columns: { readonly [K in keyof Row]: ArrayLike<Row[K]> } };

type Key<Row> = Extract<keyof Row, string>;
type KeysWhere<Row, V> = { [K in Key<Row>]: [Row[K]] extends [V] ? K : never }[Key<Row>];

/** A field that can sit on a value axis as it is. */
export type NumberKey<Row> = KeysWhere<Row, number | null | undefined>;
/** A field of numeric strings (Postgres bigint and numeric, BigQuery): allowed only with `parse: 'number'`. */
export type StringKey<Row> = KeysWhere<Row, string | null | undefined>;
/** A field that can sit on an x axis: numbers, instants, calendar dates or categories. */
export type XKey<Row> = KeysWhere<Row, number | string | Date | null | undefined>;
/** A field that names a series. */
export type SeriesKey<Row> = KeysWhere<Row, string | number | boolean>;

export type XValue = number | string | Date;

// ---------- fields ----------

interface FieldCommon {
  /** Axis title and the name used in tooltip, table and announcements. */
  label?: string;
  /** Unit appended to values in tooltip, table and announcements: 'ms', 'USD', … */
  unit?: string;
}

export interface ValueFieldOptions extends FieldCommon {
  /** Declares percentage data and its convention: 'percent' = 0–100, 'ratio' = 0–1. Never inferred from the label. */
  scale?: 'percent' | 'ratio';
  /** How values are written in tooltip, table and announcements. Default: locale grouping, up to 6 significant fraction digits. */
  format?: Intl.NumberFormatOptions | ((value: number) => string);
  /** How axis ticks are written. Default: compact when it saves space. */
  tickFormat?: Intl.NumberFormatOptions | ((value: number) => string);
  /** What a missing value means. 'gap' (default) draws nothing; 'zero' is for counts where absence means none. */
  missing?: 'gap' | 'zero';
  /** Author bounds. On bar and area the domain is widened to include zero and AX110 is raised if it did not. */
  domain?: readonly [number, number];
}

export type ValueField<Row> =
  | NumberKey<Row>
  | ({ field: NumberKey<Row>; parse?: never } & ValueFieldOptions)
  | ({ field: StringKey<Row>; parse: 'number' } & ValueFieldOptions);

export interface XFieldOptions extends FieldCommon {
  /**
   * 'date': calendar dates ('2026-02-24'); read the same in every time zone.
   * 'time': instants (epoch milliseconds, Date objects, ISO strings with an offset); shown in `timeZone`.
   * 'number' and 'category' as named. Inferred when omitted, except that numbers are never inferred to be instants.
   */
  type?: 'number' | 'time' | 'date' | 'category';
  /** For instants only. Default 'local' (the viewer's zone). */
  timeZone?: 'local' | 'UTC' | (string & {});
  format?: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | ((value: XValue) => string);
  tickFormat?: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions | ((value: XValue) => string);
  domain?: readonly [XValue, XValue];
}

export type XField<Row> = XKey<Row> | ({ field: XKey<Row> } & XFieldOptions);

/** Long form: one row per (x, series). Wide form: one row per x, one column per series. Never both. */
export type Encoding<Row> =
  | { x: XField<Row>; y: ValueField<Row>; series?: SeriesKey<Row> }
  | { x: XField<Row>; y: readonly ValueField<Row>[]; series?: never };

// ---------- options ----------

export interface Title { text: string; visible?: boolean; level?: 2 | 3 | 4 | 5 | 6 }

export interface CommonOptions<Row> {
  data: Data<Row>;
  /** Visible heading and accessible name. */
  title?: string | Title;
  /** Id of an existing heading that names the chart, for dashboard cards that already show a title. */
  labelledBy?: string;
  subtitle?: string;
  /** Added to the generated summary. Mandatory disclosures (time zone, omitted values) are kept. */
  description?: string;
  state?: 'ready' | 'loading' | { error: string } | { empty: string };
  legend?: 'auto' | false | 'top' | 'right' | 'bottom';
  tooltip?: boolean;
  /** "View as table" control. Default true. */
  table?: boolean;
  /** Fixed color per series name, so "Direct" is the same color on every chart: { Direct: 'var(--brand-1)' }. */
  colors?: Readonly<Record<string, string>>;
  /** Overrides for built-in text ("View as table", "No data", …). */
  messages?: Partial<Messages>;
  /** Default: the document language. */
  locale?: string;
  /** Throw on any warning or error diagnostic, synchronously from the call that caused it. */
  strict?: boolean;
  onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export interface Reference {
  x?: XValue | readonly [XValue, XValue];
  y?: number | readonly [number, number];
  label: string;
}

export interface CartesianOptions {
  /** Default true on time and number x axes. */
  zoom?: boolean;
  reference?: readonly Reference[];
}

/** Line, area and bar only. Marks only, as a static image with a text alternative: no axes, legend, toolbar, table, zoom or tooltip. */
export interface CompactOption { compact?: boolean }

export type LineOptions<Row> = CommonOptions<Row> & CartesianOptions & CompactOption & Encoding<Row>;
export type AreaOptions<Row> = CommonOptions<Row> & CartesianOptions & CompactOption & Encoding<Row> & { stacked?: boolean };
export type BarOptions<Row> = CommonOptions<Row> & CartesianOptions & CompactOption & Encoding<Row> & { layout?: 'grouped' | 'stacked'; horizontal?: boolean };
export type ScatterOptions<Row> = CommonOptions<Row> & CartesianOptions & { x: XField<Row>; y: ValueField<Row>; series?: SeriesKey<Row> };
export type DonutOptions<Row> = CommonOptions<Row> & { label: SeriesKey<Row>; value: ValueField<Row> };

// ---------- handle ----------

export interface Point<Row> { series: string; x: XValue; y: number | null; row: Row | null; index: number }

export interface ChartEvents<Row> {
  hover: Point<Row> | null;
  select: Point<Row>;
  zoom: readonly [XValue, XValue] | null;
}

export interface Chart<Row, Options> {
  /**
   * Changes options. Keys present replace the old value; a key set to `undefined` returns to its default; absent keys stay.
   * Validation and diagnostics are synchronous (a `strict` chart throws here and keeps its last valid state); drawing happens on the next frame.
   */
  update(patch: Partial<Options>): void;
  /** Adds rows at the end. `keep` = number of distinct x values retained; older ones are dropped. */
  append(rows: readonly Row[], options?: { keep?: number }): void;
  /** Sets the visible x range; `null` shows everything. */
  zoom(domain: readonly [XValue, XValue] | null): void;
  on<E extends keyof ChartEvents<Row>>(event: E, listener: (payload: ChartEvents<Row>[E]) => void): () => void;
  /** Diagnostics for the current options and data. Up to date as soon as create, update or append returns. */
  readonly diagnostics: readonly Diagnostic[];
  destroy(): void;
}

export type Target = string | HTMLElement;

export function line<Row>(target: Target, options: LineOptions<Row>): Chart<Row, LineOptions<Row>>;
export function area<Row>(target: Target, options: AreaOptions<Row>): Chart<Row, AreaOptions<Row>>;
export function bar<Row>(target: Target, options: BarOptions<Row>): Chart<Row, BarOptions<Row>>;
export function scatter<Row>(target: Target, options: ScatterOptions<Row>): Chart<Row, ScatterOptions<Row>>;
export function donut<Row>(target: Target, options: DonutOptions<Row>): Chart<Row, DonutOptions<Row>>;

// ---------- diagnostics ----------

export interface Diagnostic {
  /** Stable and documented, one page per code. */
  code: `AX${number}`;
  level: 'error' | 'warning' | 'hint';
  /** What is wrong, where, and how to fix it. */
  message: string;
  /** The chart it came from: its title, else its element id. */
  chart: string;
  /** Where applicable. A diagnostic about the chart as a whole (no title, low contrast) has neither. */
  field?: string;
  /** First offending row indexes in the caller's own data, capped at 10. */
  rows?: readonly number[];
  count?: number;
}

/** Runs normalization and validation only. Works without a DOM, so a server or an agent can check options before rendering. */
export function validate<Row>(type: 'line' | 'area' | 'bar', options: LineOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'scatter', options: ScatterOptions<Row>): Diagnostic[];
export function validate<Row>(type: 'donut', options: DonutOptions<Row>): Diagnostic[];

export interface Messages {
  viewAsTable: string; noData: string; loading: string; valuesNotShown: string;
  pointOf: string; zoomIn: string; zoomOut: string; resetZoom: string; pause: string; resume: string;
}
