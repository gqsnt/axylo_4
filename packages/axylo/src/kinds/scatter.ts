/** The scatter chart's stages (core/composition.ts): point data and storage, point marks, the point grid lookup. */
import type { Composition } from '../core/composition';
import { scatterTargetMarks, stepInSeries } from '../core/focus';
import { normalizePoints } from '../data/normalize';
import { openPointStore } from '../data/store-unaligned';
import { buildScatterView } from '../view';
import { scatterScene } from '../scene';
import { scatterLookupFor } from '../lookup';
import { scatterReader } from '../reader';
import { pointSwatch } from '../dom/interaction';
import { svgBand, svgPoints, svgRule } from '../render/svg';

export const SCATTER: Composition = {
  kind: 'scatter',
  normalize: (_kind, resolved, env, sink, version) => normalizePoints(resolved, env, sink, version),
  openStore: openPointStore as Composition['openStore'],
  view: buildScatterView as Composition['view'],
  scene: scatterScene,
  lookup: scatterLookupFor,
  reader: scatterReader,
  interaction: { overlay: scatterTargetMarks, swatch: pointSwatch, stepInSeries, sliceList: null },
  // Points and highlighted points, references, axes and the focus ring (rules).
  svg: { points: svgPoints, rule: svgRule, band: svgBand },
};
