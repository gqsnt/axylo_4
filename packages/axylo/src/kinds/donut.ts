/** The donut chart's stages (core/composition.ts): slice data and storage, arcs, the slice lookup and list. */
import { baseLayoutKey, type LayoutStage, type Composition } from '../core/composition';
import { donutTargetMarks } from '../core/focus';
import { normalizeDonut } from '../data/normalize';
import { openDonutStore } from '../data/store-unaligned';
import { buildDonutView } from '../view';
import { donutScene } from '../scene';
import { donutLookupFor } from '../lookup';
import { donutReader } from '../reader';
import { donutSliceList, pointSwatch } from '../dom/interaction';
import { svgArcs, svgRule } from '../render/svg';

const unchanged = { remedies: [], hidden: 0 } as const;
const donutLayout: LayoutStage = {
  layoutKey: baseLayoutKey,
  compute(_view, { width, height }, _text, { compact }) {
    const size = { width, height };
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { ...size, kind: 'unmeasured' };
    if (!compact && (width < 120 || height < 80)) return { ...size, kind: 'too-small' };
    const x = compact ? Math.min(2, width / 2) : 0;
    const y = compact ? Math.min(2, height / 2) : 0;
    const plot = { x, y, width: width - 2 * x, height: height - 2 * y };
    const r1 = Math.min(plot.width, plot.height) / 2;
    const projection = { kind: 'ring' as const, cx: x + plot.width / 2, cy: y + plot.height / 2, r0: r1 * 0.6, r1 };
    return compact ? { ...size, kind: 'compact', plot, projection }
      : { ...size, kind: 'plot', plot, projection, xTicks: [], yTicks: [], texts: [], fit: { x: unchanged, y: unchanged } };
  },
};

export const DONUT: Composition = {
  kind: 'donut',
  normalize: (_kind, resolved, env, sink, version) => normalizeDonut(resolved, env, sink, version),
  openStore: openDonutStore as Composition['openStore'],
  view: buildDonutView as Composition['view'],
  layout: donutLayout,
  scene: donutScene,
  lookup: donutLookupFor,
  reader: donutReader,
  interaction: { overlay: donutTargetMarks, swatch: pointSwatch, stepInSeries: null, sliceList: donutSliceList },
  // Slices and slice outlines (arcs), the focus ring (rules).
  svg: { arcs: svgArcs, rule: svgRule },
};
