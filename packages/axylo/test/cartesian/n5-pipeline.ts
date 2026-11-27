/**
 * The Cartesian stage pipeline in Node for the N5 tests, as n4-pipeline.ts runs it, plus what the N5 cases need:
 * hidden series (legend toggles), a previous view, and per-field formatters built the way the controller builds
 * them (core/controller-helpers.ts buildFormatSpec: one formatter per frame series, from the field's own
 * `format` and unit).
 */
import { parseCartesianInput } from '../../src/cartesian/options';
import { normalizeCartesian } from '../../src/cartesian/normalize';
import { buildCartesianView } from '../../src/cartesian/view';
import { createCartesianLayoutStage } from '../../src/cartesian/layout';
import { buildCartesianScene } from '../../src/cartesian/scene';
import { createCartesianLookup } from '../../src/cartesian/lookup';
import { createCartesianReader } from '../../src/cartesian/reader';
import { createMarkSwatch } from '../../src/cartesian/mark-swatch';
import type { CartesianStateRef } from '../../src/cartesian/meta';
import { reportCartesian } from '../../src/cartesian/diagnostics';
import { DiagnosticCollector, readerDisclosure } from '../../src/diagnostics/collector';
import { resolveOptions } from '../../src/data/options';
import { createFormatters } from '../../src/format';
import { defaultMessages } from '../../src/messages';
import { readerWith } from '../../src/reader';
import type { AxisContext } from '../../src/core/axes';
import type { AlignedView, Layout, Mark } from '../../src/core/contracts';
import { measurer, style } from './n4-pipeline';
import { xSlotPixel } from '../../src/cartesian/bar-geom';

export interface N5Options {
  readonly width?: number;
  readonly height?: number;
  readonly zoom?: readonly [number, number] | null;
  readonly hidden?: readonly string[];
  readonly previous?: AlignedView | null;
}

export function n5run(input: Record<string, unknown>, opts: N5Options = {}) {
  const { width = 960, height = 400, zoom = null, hidden = [], previous = null } = opts;
  const parsed = parseCartesianInput(input);
  const stateRef: CartesianStateRef = { meta: parsed.meta };
  const sink = new DiagnosticCollector();
  for (const issue of parsed.issues) reportCartesian(sink, issue.code, 'chart-error', { field: issue.field, detail: issue.detail });
  const clean = { ...parsed.translated };
  const strip = (item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) if (!k.startsWith('__')) out[k] = v;
    return out;
  };
  clean.y = Array.isArray(clean.y) ? clean.y.map(strip) : strip(clean.y);
  const resolved = resolveOptions('line', clean, sink);
  const frame = normalizeCartesian(stateRef, 'line', resolved, { timeZone: 'UTC' }, sink, { epoch: 1, revision: 1 });
  const view = buildCartesianView(stateRef, frame, {
    kind: 'line', hidden: new Set(hidden), zoom: zoom as never, xField: resolved.x, xDomain: resolved.x.domain,
    valueDomain: null, valueField: resolved.values[0]?.field, references: Array.isArray(clean.reference) ? clean.reference as never : [],
    previous, stacked: false, horizontal: false, compact: false,
  }, sink);
  const ctx: AxisContext = { resolved, locale: 'en-US', compact: false, xLabelGiven: true, valueTitle: 'Value' };
  const byField = new Map(resolved.values.map(v => [v.field, v]));
  // One formatter per carrier series of the accepted frame (not of the published view), as the controller makes them.
  const formatters = createFormatters({
    series: frame.series.map(s => ({ field: s.field, unit: s.unit, scale: s.valueScale, format: byField.get(s.field)?.format ?? null })),
    x: { field: resolved.x.field, kind: frame.x.kind, unit: resolved.x.unit, timeZone: frame.x.timeZone, dateUnit: frame.x.dateUnit, categories: frame.x.categories },
    locale: 'en-US',
    messages: defaultMessages,
  }, { locale: 'en-US', timeZone: 'UTC' });
  const layoutStage = createCartesianLayoutStage(stateRef);
  const layout: Layout = layoutStage.compute(view, { width, height }, { measurer, style }, ctx);
  const scene = buildCartesianScene(stateRef, view, layout, 1);
  const lookup = createCartesianLookup(stateRef, view, layout, formatters, defaultMessages);
  const reader = readerWith(createCartesianReader(stateRef), {
    view, formatters, messages: defaultMessages, type: 'Line', title: 'N5',
    disclosure: readerDisclosure(sink.inputs()), locale: 'en-US',
  });
  const swatch = createMarkSwatch(stateRef);
  return { parsed, stateRef, frame, view, layout, scene, lookup, reader, formatters, swatch, diagnostics: sink.inputs() };
}

export type N5Run = ReturnType<typeof n5run>;

export function plotOf(layout: Layout): Extract<Layout, { kind: 'plot' }> {
  if (layout.kind !== 'plot') throw new Error(`expected a plot layout, got ${layout.kind}`);
  return layout;
}

/** The y scale a layout draws axis `index` with. */
export function yScaleOf(layout: Layout, index: 0 | 1) {
  const p = plotOf(layout).projection;
  if (p.kind === 'ring') throw new Error('ring');
  const axes = p.yAxes ?? [p.kind === 'xy' ? p.y : p.value];
  return axes[index]!;
}

export function xPixel(layout: Layout, view: AlignedView, slot: number): number {
  const p = plotOf(layout).projection;
  if (p.kind === 'ring') throw new Error('ring');
  return xSlotPixel(p.kind === 'xy' ? p.x : p.band, view.frame.x.values, slot);
}

export const marksOf = <T extends Mark['type']>(run: N5Run, type: T, series?: number) =>
  run.scene.marks.filter((m): m is Extract<Mark, { type: T }> => m.type === type && (series === undefined || (m as { series?: number }).series === series));
