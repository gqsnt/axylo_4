/** The line chart's stages (core/composition.ts): aligned data, line and point marks, x cursor. */
import { alignedLayout } from '../core/axes';
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeAligned } from '../data/normalize';
import { openAlignedStore } from '../data/store';
import { buildPlainAlignedView } from '../view';
import { lineScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { createTimeReadout } from '../format/time';
import { lineSwatch } from '../dom/swatch';
import { svgBand, svgPath, svgPoints, svgRule } from '../render/svg';

export const LINE: Composition = {
  kind: 'line',
  normalize: normalizeAligned as Composition['normalize'],
  openStore: openAlignedStore as Composition['openStore'],
  view: buildPlainAlignedView as Composition['view'],
  get layout() { return alignedLayout(); },
  timeReadout: createTimeReadout,
  scene: lineScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null },
  // Lines and markers, references (bands and rules), axes and the cursor (rules), focus points.
  svg: { path: svgPath, points: svgPoints, rule: svgRule, band: svgBand },
};

/**
 * The same stages without streaming storage, for `axylo/static`. A separate literal rather than a spread or a
 * prototype of the one above: either costs the root entry bytes (and a spread would run the layout getter at
 * import). test/core/static-stream.test.ts checks that the two agree on every stage but `openStore`.
 */
export const LINE_STATIC: Composition = {
  kind: 'line',
  normalize: normalizeAligned as Composition['normalize'],
  view: buildPlainAlignedView as Composition['view'],
  get layout() { return alignedLayout(); },
  timeReadout: createTimeReadout,
  scene: lineScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null },
  // Lines and markers, references (bands and rules), axes and the cursor (rules), focus points.
  svg: { path: svgPath, points: svgPoints, rule: svgRule, band: svgBand },
};
