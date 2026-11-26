/** The area chart's stages (core/composition.ts): aligned data, fills with their edges and seams, x cursor. */
import { alignedLayout } from '../core/axes';
import type { Composition } from '../core/composition';
import { alignedTargetMarks } from '../core/focus';
import { normalizeAligned } from '../data/normalize';
import { openAlignedStore } from '../data/store';
import { buildStack, reportStack } from '../view/stack';
import { alignedViewWith } from '../view';
import { areaScene } from '../scene';
import { alignedLookupFor } from '../lookup';
import { alignedReader } from '../reader';
import { createTimeReadout } from '../format/time';
import { areaSwatch } from '../dom/swatch';
import { svgArea, svgBand, svgPath, svgPoints, svgRule } from '../render/svg';

let view: Composition['view'] | undefined;

export const AREA: Composition = {
  kind: 'area',
  normalize: normalizeAligned as Composition['normalize'],
  openStore: openAlignedStore as Composition['openStore'],
  get view() { return view ??= alignedViewWith({ buildStack, reportStack }) as Composition['view']; },
  get layout() { return alignedLayout(); },
  timeReadout: createTimeReadout,
  scene: areaScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: areaSwatch, stepInSeries: null, sliceList: null },
  // Fills, their edges and stack seams (paths), markers, references, axes and the cursor, focus points.
  svg: { area: svgArea, path: svgPath, points: svgPoints, rule: svgRule, band: svgBand },
};

/**
 * The same stages without streaming storage, for `axylo/static`. A separate literal rather than a spread or a
 * prototype of the one above: either costs the root entry bytes (and a spread would run the layout getter at
 * import). test/core/static-stream.test.ts checks that the two agree on every stage but `openStore`.
 */
export const AREA_STATIC: Composition = {
  kind: 'area',
  normalize: normalizeAligned as Composition['normalize'],
  get view() { return view ??= alignedViewWith({ buildStack, reportStack }) as Composition['view']; },
  get layout() { return alignedLayout(); },
  timeReadout: createTimeReadout,
  scene: areaScene,
  lookup: alignedLookupFor,
  reader: alignedReader,
  interaction: { overlay: alignedTargetMarks, swatch: areaSwatch, stepInSeries: null, sliceList: null },
  // Fills, their edges and stack seams (paths), markers, references, axes and the cursor, focus points.
  svg: { area: svgArea, path: svgPath, points: svgPoints, rule: svgRule, band: svgBand },
};
