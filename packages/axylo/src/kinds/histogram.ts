import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeHistogram, openHistogramStore } from '../data/histogram';
import { resolveOptions } from '../data/options';
import { buildAlignedView } from '../view';
import { barScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { barSwatch } from '../dom/interaction';
import { svgBand, svgRects, svgRule } from '../render/svg';

export const HISTOGRAM: Composition = {
  kind: 'histogram',
  normalize: normalizeHistogram,
  openStore: openHistogramStore,
  resolve: resolveOptions,
  view: buildAlignedView as Composition['view'],
  scene: barScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: barSwatch, stepInSeries: null, sliceList: null },
  // Bars and their patterns, "no data" boxes (rects), references, axes, the cursor and bar outlines (rules).
  svg: { rects: svgRects, rule: svgRule, band: svgBand },
};
