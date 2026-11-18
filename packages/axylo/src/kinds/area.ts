/** The area chart's stages (core/composition.ts): aligned data, fills with their edges and seams, x cursor. */
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeAligned } from '../data/normalize';
import { openAlignedStore } from '../data/store';
import { buildAlignedView } from '../view';
import { areaScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { areaSwatch } from '../dom/interaction';
import { svgArea, svgBand, svgPath, svgPoints, svgRule } from '../render/svg';
import { canvasArea, canvasBand, canvasPath, canvasPoints, canvasRule } from '../render/canvas';

export const AREA: Composition = {
  kind: 'area',
  normalize: normalizeAligned as Composition['normalize'],
  openStore: openAlignedStore as Composition['openStore'],
  view: buildAlignedView as Composition['view'],
  scene: areaScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: areaSwatch, stepInSeries: null, sliceList: null },
  // Fills, their edges and stack seams (paths), markers, references, axes and the cursor, focus points.
  svg: { area: svgArea, path: svgPath, points: svgPoints, rule: svgRule, band: svgBand },
  canvas: { area: canvasArea, path: canvasPath, points: canvasPoints, rule: canvasRule, band: canvasBand },
};
