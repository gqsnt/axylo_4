/** The scatter chart's stages (core/composition.ts): point data and storage, point marks, the point grid lookup. */
import { linearScale } from '../scale';
import { cartesianLayout, temporalTicks, timeScale } from '../core/axes';
import type { Composition } from '../core/composition';
import { scatterTargetMarks, stepInSeries } from '../core/focus';
import { normalizePoints } from '../data/normalize';
import { openPointStore } from '../data/store-unaligned';
import { buildScatterView } from '../view';
import { scatterScene } from '../scene';
import { scatterLookupFor } from '../lookup';
import { scatterReader } from '../reader';
import { createTimeReadout } from '../format/time';
import { pointSwatch } from '../dom/swatch';
import { svgBand, svgPoints, svgRule } from '../render/svg';

let layout: Composition['layout'] | undefined;

export const SCATTER: Composition = {
  kind: 'scatter',
  normalize: (_kind, resolved, env, sink, version) => normalizePoints(resolved, env, sink, version),
  openStore: openPointStore as Composition['openStore'],
  view: buildScatterView as Composition['view'],
  get layout() { return layout ??= cartesianLayout({ linear: linearScale, time: timeScale, temporalTicks }); },
  timeReadout: createTimeReadout,
  scene: scatterScene,
  lookup: scatterLookupFor,
  reader: scatterReader,
  interaction: { overlay: scatterTargetMarks, swatch: pointSwatch, stepInSeries, sliceList: null },
  // Points and highlighted points, references, axes and the focus ring (rules).
  svg: { points: svgPoints, rule: svgRule, band: svgBand },
};

/**
 * The same stages without streaming storage, for `axylo/static`. A separate literal rather than a spread or a
 * prototype of the one above: either costs the root entry bytes (and a spread would run the layout getter at
 * import). test/core/static-stream.test.ts checks that the two agree on every stage but `openStore`.
 */
export const SCATTER_STATIC: Composition = {
  kind: 'scatter',
  normalize: (_kind, resolved, env, sink, version) => normalizePoints(resolved, env, sink, version),
  view: buildScatterView as Composition['view'],
  get layout() { return layout ??= cartesianLayout({ linear: linearScale, time: timeScale, temporalTicks }); },
  timeReadout: createTimeReadout,
  scene: scatterScene,
  lookup: scatterLookupFor,
  reader: scatterReader,
  interaction: { overlay: scatterTargetMarks, swatch: pointSwatch, stepInSeries, sliceList: null },
  // Points and highlighted points, references, axes and the focus ring (rules).
  svg: { points: svgPoints, rule: svgRule, band: svgBand },
};
