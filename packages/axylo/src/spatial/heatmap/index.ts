/**
 * The heatmap of `axylo/spatial` (cycle N8a): a matrix of colored cells, one per (row, column) pair of the data.
 *
 * - Zero edits to the shared contracts, zero bytes in the root and static bundles, nothing at import time.
 * - Colors: quantized OKLab sequential (viridis) or symmetric diverging scale, live CSS custom properties.
 * - Constant DOM: one SVG path per color bin, plus one for missing and one for invalid cells.
 * - Exact readings: tooltip, keyboard (2D grid), table and summary read the frame, never a color.
 * - Diagnostics AX182–AX186 (duplicate cells, invalid values, unusable domains, sub-pixel cells, dense input).
 *
 * The future `src/spatial.ts` barrel re-exports this module.
 */
import type { CommonOptions, Diagnostic, Target } from '../../public';
import type { StaticChart } from '../../static';
import { createStaticChart } from '../../core/chart';
import { namingDiagnostics, toPublic } from '../../core/stages';
import { resolveOptions } from '../../data/options';
import { DiagnosticCollector } from '../../diagnostics/collector';
import { openHeatmapChart } from './chart';
import { issueDiagnostic, normalizeHeatmap, parseHeatmapInput } from './core';

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

/** Creates a heatmap in `target`. */
export function heatmap<Row>(target: Target, options: HeatmapOptions<Row>): HeatmapChart<Row> {
  return openHeatmapChart(options, (composition, translated) => createStaticChart(composition, target, translated)) as unknown as
    HeatmapChart<Row>;
}

/**
 * Validates heatmap options and data without a DOM (Node and SSR safe): every call-time finding (AX101, AX150,
 * AX182, AX183, AX184, AX186, …). AX185 depends on the drawn size and is reported by a chart only.
 */
export function validateHeatmap<Row>(options: HeatmapOptions<Row>): readonly Diagnostic[] {
  const parsed = parseHeatmapInput(options);
  const sink = new DiagnosticCollector();
  for (const issue of parsed.issues) sink.add(issueDiagnostic(issue));
  const resolved = resolveOptions('line', parsed.translated, sink);
  normalizeHeatmap(parsed.meta, resolved, sink, { epoch: 1, revision: 1 });
  for (const d of namingDiagnostics(parsed.translated)) sink.add(d);
  return toPublic(sink.inputs(), resolved.name);
}

export { heatmapInternals, type HeatmapInternals } from './chart';
export type { LegendModel, LegendTick } from './legend';
export type { CommonOptions, Diagnostic, Target } from '../../public';
export type { StaticChart } from '../../static';
