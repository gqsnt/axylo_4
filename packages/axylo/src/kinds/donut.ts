/** The donut chart's stages (core/composition.ts): slice data and storage, arcs, the slice lookup and list. */
import type { Composition } from '../core/composition';
import { donutTargetMarks } from '../core/focus';
import { normalizeDonut } from '../data/normalize';
import { openDonutStore } from '../data/store-unaligned';
import { buildDonutView } from '../view';
import { donutScene } from '../scene';
import { donutLookupFor } from '../lookup';
import { donutReader } from '../reader';
import { donutSliceList, pointSwatch } from '../dom/interaction';
import { svgArcs, svgRule } from '../render/svg';

export const DONUT: Composition = {
  kind: 'donut',
  normalize: (_kind, resolved, env, sink, version) => normalizeDonut(resolved, env, sink, version),
  openStore: openDonutStore as Composition['openStore'],
  view: buildDonutView as Composition['view'],
  scene: donutScene,
  lookup: donutLookupFor,
  reader: donutReader,
  interaction: { overlay: donutTargetMarks, swatch: pointSwatch, stepInSeries: null, sliceList: donutSliceList },
  // Slices and slice outlines (arcs), the focus ring (rules).
  svg: { arcs: svgArcs, rule: svgRule },
};
