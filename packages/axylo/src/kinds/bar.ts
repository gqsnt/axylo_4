/** The bar chart's stages (core/composition.ts): aligned data on bands, bar and "no data" rectangles, bar outlines. */
import { alignedLayout } from '../core/axes';
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeAligned } from '../data/normalize';
import { openAlignedStore } from '../data/store';
import { buildAlignedView } from '../view';
import { barScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { createTimeReadout } from '../format/time';
import { barSwatch } from '../dom/bar-swatch';
import { svgBand, svgRects, svgRule } from '../render/svg';

export const BAR: Composition = {
  kind: 'bar',
  normalize: normalizeAligned as Composition['normalize'],
  openStore: openAlignedStore as Composition['openStore'],
  view: buildAlignedView as Composition['view'],
  get layout() { return alignedLayout(); },
  timeReadout: createTimeReadout,
  scene: barScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: barSwatch, stepInSeries: null, sliceList: null },
  // Bars and their patterns, "no data" boxes (rects), references, axes, the cursor and bar outlines (rules).
  svg: { rects: svgRects, rule: svgRule, band: svgBand },
};

/**
 * The same stages without streaming storage, for `axylo/static`. A separate literal rather than a spread or a
 * prototype of the one above: either costs the root entry bytes (and a spread would run the layout getter at
 * import). test/core/static-stream.test.ts checks that the two agree on every stage but `openStore`.
 */
export const BAR_STATIC: Composition = {
  kind: 'bar',
  normalize: normalizeAligned as Composition['normalize'],
  view: buildAlignedView as Composition['view'],
  get layout() { return alignedLayout(); },
  timeReadout: createTimeReadout,
  scene: barScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: barSwatch, stepInSeries: null, sliceList: null },
  // Bars and their patterns, "no data" boxes (rects), references, axes, the cursor and bar outlines (rules).
  svg: { rects: svgRects, rule: svgRule, band: svgBand },
};
