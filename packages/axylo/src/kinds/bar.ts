/** The bar chart's stages (core/composition.ts): aligned data on bands, bar and "no data" rectangles, bar outlines. */
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeAligned } from '../data/normalize';
import { openAlignedStore } from '../data/store';
import { buildAlignedView } from '../view';
import { barScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { barSwatch } from '../dom/interaction';
import { svgBand, svgRects, svgRule } from '../render/svg';
import { canvasBand, canvasRects, canvasRule } from '../render/canvas';

export const BAR: Composition = {
  kind: 'bar',
  normalize: normalizeAligned as Composition['normalize'],
  openStore: openAlignedStore as Composition['openStore'],
  view: buildAlignedView as Composition['view'],
  scene: barScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: barSwatch, stepInSeries: null, sliceList: null },
  // Bars and their patterns, "no data" boxes (rects), references, axes, the cursor and bar outlines (rules).
  svg: { rects: svgRects, rule: svgRule, band: svgBand },
  canvas: { rects: canvasRects, rule: canvasRule, band: canvasBand },
};
