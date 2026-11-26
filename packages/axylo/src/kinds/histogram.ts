import { linearScale } from '../scale';
import { cartesianLayout } from '../core/axes';
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeHistogram, openHistogramStore } from '../data/histogram';
import { resolveOptions } from '../data/options';
import { buildPlainAlignedView } from '../view';
import { barScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { barSwatch } from '../dom/bar-swatch';
import { svgBand, svgRects, svgRule } from '../render/svg';

let layout: Composition['layout'] | undefined;

export const HISTOGRAM: Composition = {
  kind: 'histogram',
  normalize: normalizeHistogram,
  openStore: openHistogramStore,
  resolve: resolveOptions,
  view: buildPlainAlignedView as Composition['view'],
  get layout() { return layout ??= cartesianLayout({ linear: linearScale }); },
  scene: barScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: barSwatch, stepInSeries: null, sliceList: null },
  // Bars and their patterns, "no data" boxes (rects), references, axes, the cursor and bar outlines (rules).
  svg: { rects: svgRects, rule: svgRule, band: svgBand },
};
