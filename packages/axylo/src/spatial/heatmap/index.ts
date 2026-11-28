/**
 * The heatmap of `axylo/spatial` (cycle N8a): a matrix of colored cells, one per (row, column) pair of the data.
 *
 * - Zero edits to the shared contracts, zero bytes in the root and static bundles, nothing at import time.
 * - Colors: quantized OKLab sequential (viridis) or symmetric diverging scale, live CSS custom properties.
 * - Constant DOM: one SVG path per color bin, plus one for missing and one for invalid cells.
 * - Exact readings: tooltip, keyboard (2D grid), table and summary read the frame, never a color.
 * - Diagnostics AX182–AX186 (duplicate cells, invalid values, unusable domains, sub-pixel cells, dense input).
 *
 * The `axylo/spatial` entry (src/spatial.ts) opens charts through this module.
 */
import type { Diagnostic, Target } from '../../public';
import type { HeatmapChart, HeatmapOptions } from '../../spatial';
import { createStaticChart } from '../../core/chart';
import { namingDiagnostics, toPublic } from '../../core/stages';
import { resolveOptions } from '../../data/options';
import { DiagnosticCollector } from '../../diagnostics/collector';
import { openHeatmapChart } from './chart';
import { issueDiagnostic, normalizeHeatmap, parseHeatmapInput } from './core';

// Declared in the entry file (spatial.ts): the package ships that declaration file, not this module's.
export type { HeatmapAxisField, HeatmapChart, HeatmapColorOptions, HeatmapOptions, HeatmapValueField } from '../../spatial';

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
