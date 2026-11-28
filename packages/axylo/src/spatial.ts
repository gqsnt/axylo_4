/**
 * Opt-in spatial charts (`axylo/spatial`, Wave 4): `heatmap` (N8a, a matrix of colored cells with a continuous
 * color bar) and `bubble` (N8b, a scatter whose discs have area proportional to a size field, with a nested-circle
 * size legend), with their DOM-free validators.
 *
 * - The public option types are declared here, not in the family modules: the package ships this entry's
 *   declaration file and `public.d.ts` / `static.d.ts` only, so every type a signature names must be reachable
 *   from those files.
 * - Importing this module touches no DOM and runs no code at top level (0 raw bytes on a bare import), so it is
 *   safe in Node and SSR. The root and static entries do not import it.
 * - Both charts carry the `axylo/export` capability (export/contract.ts): the whole figure, its color bar or size
 *   legend included, exports as SVG or PNG, and every committed table row as CSV.
 */
import type { Chart, CommonOptions, Diagnostic, NumberKey, ScatterOptions, StringKey, Target } from './public.js';
import type { StaticChart } from './static.js';
import { heatmap as openHeatmap, validateHeatmap as validateHeatmapOptions } from './spatial/heatmap/index';
import { bubble as openBubble, validateBubble as validateBubbleOptions } from './spatial/bubble/index';

/** A row or column field: its name, or the name with a label and an explicit category order. */
export type HeatmapAxisField<Row> = (keyof Row & string) | {
  readonly field: keyof Row & string;
  readonly label?: string;
  /** Rows (or columns) in this order; data outside them is left out (AX183). Default: first-seen order. */
  readonly categories?: readonly (string | number)[];
};

/** The value field of each cell. */
export type HeatmapValueField<Row> = (keyof Row & string) | {
  readonly field: keyof Row & string;
  readonly label?: string;
  readonly unit?: string;
  readonly format?: Intl.NumberFormatOptions | ((value: number) => string);
};

export interface HeatmapColorOptions {
  /** 'sequential' (default): low to high. 'diverging': below and above `mid`, symmetric. */
  readonly scheme?: 'sequential' | 'diverging';
  /** The values the colors span; values outside take the end colors. Default: the data's range. */
  readonly domain?: readonly [number, number];
  /** Diverging midpoint. Default 0. */
  readonly mid?: number;
  /** Number of quantized colors, 2–64. Default 32. */
  readonly bins?: number;
}

export interface HeatmapOptions<Row> extends CommonOptions<Row> {
  /** The column of each cell. */
  readonly x: HeatmapAxisField<Row>;
  /** The row of each cell. */
  readonly y: HeatmapAxisField<Row>;
  readonly value: HeatmapValueField<Row>;
  readonly color?: HeatmapColorOptions;
}

export type HeatmapChart<Row> = StaticChart<Row, HeatmapOptions<Row>>;

export interface SizeFieldOptions {
  /** Legend title and the name used in tooltip, table and announcements. Default: the field name. */
  label?: string;
  /** Unit appended to sizes in tooltip, table, legend and announcements. */
  unit?: string;
  /** How sizes are written in tooltip, table, legend and announcements. Default: locale grouping, as values (F6). */
  format?: Intl.NumberFormatOptions | ((value: number) => string);
}

/** The field whose value sets each bubble's area. Sizes are magnitudes: zero and positive values only. */
export type SizeField<Row> =
  | NumberKey<Row>
  | ({ field: NumberKey<Row>; parse?: never } & SizeFieldOptions)
  | ({ field: StringKey<Row>; parse: 'number' } & SizeFieldOptions);

/** Radius range in CSS px: the largest size is drawn at `max`; a positive size never below `min`. */
export interface BubbleRadius {
  /** Default 2. */
  min?: number;
  /** Default 24. */
  max?: number;
}

export type BubbleOptions<Row> = ScatterOptions<Row> & {
  size: SizeField<Row>;
  radius?: BubbleRadius;
};

/** A bubble chart: everything a static chart has (no `append`: sizes are read per update, not streamed). */
export type BubbleChart<Row> = Omit<Chart<Row, BubbleOptions<Row>>, 'append'>;

/** Creates a heatmap in `target`. */
export function heatmap<Row>(target: Target, options: HeatmapOptions<Row>): HeatmapChart<Row> {
  return openHeatmap(target, options);
}

/**
 * Validates heatmap options and data without a DOM (Node and SSR safe): every call-time finding. AX185 (cells
 * smaller than a pixel) depends on the drawn size and is reported by a chart only.
 */
export function validateHeatmap<Row>(options: HeatmapOptions<Row>): readonly Diagnostic[] {
  return validateHeatmapOptions(options);
}

/** Creates a bubble chart in `target`. */
export function bubble<Row>(target: Target, options: BubbleOptions<Row>): BubbleChart<Row> {
  return openBubble(target, options);
}

/** The diagnostics a bubble chart reports for these options and data, without a DOM (Node and SSR safe). */
export function validateBubble<Row>(options: BubbleOptions<Row>): Diagnostic[] {
  return validateBubbleOptions(options);
}

export type { Chart, CommonOptions, Diagnostic, NumberKey, ScatterOptions, StringKey, Target } from './public.js';
export type { StaticChart } from './static.js';
