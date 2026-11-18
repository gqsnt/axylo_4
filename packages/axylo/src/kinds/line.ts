/** The line chart's stages (core/composition.ts): aligned data, line and point marks, x cursor. */
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeAligned } from '../data/normalize';
import { openAlignedStore } from '../data/store';
import { buildAlignedView } from '../view';
import { lineScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { lineSwatch } from '../dom/interaction';
import { svgBand, svgPath, svgPoints, svgRule } from '../render/svg';
import { canvasBand, canvasPath, canvasPoints, canvasRule } from '../render/canvas';

export const LINE: Composition = {
  kind: 'line',
  normalize: normalizeAligned as Composition['normalize'],
  openStore: openAlignedStore as Composition['openStore'],
  view: buildAlignedView as Composition['view'],
  scene: lineScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null },
  // Lines and markers, references (bands and rules), axes and the cursor (rules), focus points.
  svg: { path: svgPath, points: svgPoints, rule: svgRule, band: svgBand },
  canvas: { path: canvasPath, points: canvasPoints, rule: canvasRule, band: canvasBand },
};
