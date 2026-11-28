/**
 * A heatmap whose controller drives the real figure and the real interaction layer (createFigure and
 * createInteraction on the N3 DOM double) as its host's figure and interaction, so prepare and commit arrive
 * exactly when the controller makes them, control-cache hits included. The plot size is the test's to change.
 */
import type { MarkRenderer } from '../../../src/core/contracts';
import { staticControllerFor, type Controller } from '../../../src/core/controller';
import { createFigure } from '../../../src/dom/figure';
import { createInteraction, type Actions, type Interaction } from '../../../src/dom/interaction';
import { openHeatmapChart, type HeatmapHandle } from '../../../src/spatial/heatmap/chart';
import { TestDocument, type TestElement } from '../../core/n3-dom';
import { record } from './host';

/**
 * `room` makes the measure geometry-aware: the plot is the host size less what the laid-out legend list takes
 * (any list not `display: none` and in a displayed slot, seen or not), by its slot: bottom/top take height, the
 * side slot takes width. Without it the plot is the host size whatever the figure holds.
 */
export interface LegendRoom { readonly height: number; readonly width: number }

export function openLive(options: unknown, start: { width: number; height: number } = { width: 720, height: 420 }, room?: LegendRoom) {
  const size = { ...start };
  const rec = record(size);
  const doc = new TestDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const fig = createFigure(root as unknown as HTMLElement, 'hm', {
    marks: doc.createElement('svg') as unknown as Element,
    text: doc.createElement('div') as unknown as Element,
  });
  const renderer: MarkRenderer = { kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement, draw() {}, drawOverlay() {}, destroy() {} };
  const actions: Actions = { zoom() {}, toggle() {}, pause() {}, select() {}, hover() {} };
  let interaction: Interaction | null = null;
  let controller: Controller | null = null;
  const handle: HeatmapHandle = openHeatmapChart(options, (composition, translated) => {
    interaction = createInteraction(composition.interaction, fig, renderer, actions);
    const host = { ...rec.host, figure: fig, interaction, dispose() { interaction!.destroy(); rec.host.dispose(); } };
    // The size the controller measures is the test's, read at each measure.
    host.measure = () => {
      const list = room ? laidOut() : null;
      if (!list) return { ...size };
      const side = String(list.parentElement?.className ?? '').includes('controls-side');
      return side ? { width: size.width - room!.width, height: size.height } : { width: size.width, height: size.height - room!.height };
    };
    controller = staticControllerFor(composition, translated, host);
    return controller.handle as unknown as HeatmapHandle;
  });
  const settle = (): number => { const n = rec.frames(20); doc.defaultView.flushFrames(); return n; };
  const top = root as unknown as TestElement;
  const legend = () => top.querySelector('.axylo-heatmap-legend');
  /** The legend list if it takes room in the figure: neither it nor an ancestor hidden or display: none. */
  const laidOut = () => {
    const list = legend();
    for (let el: TestElement | null = list; el; el = el.parentElement) {
      if (el.hidden || el.style['display'] === 'none') return null;
      if (el === top) return list;
    }
    return null;
  };
  /** The legend as a reader sees it: laid out, and neither visibility: hidden nor aria-hidden. */
  const shown = () => {
    const list = laidOut();
    return list && list.style['visibility'] !== 'hidden' && list.getAttribute('aria-hidden') !== 'true' ? list : null;
  };
  settle();
  // The first frame arranges before any model is committed, so the bar has no room yet when it is measured; in a
  // page the ResizeObserver then reports the plot the painted bar shrank. With a geometry-aware measure, do the same.
  if (room) { controller!.invalidate.resize(); settle(); }
  const ticks = () => shown()?.querySelectorAll('.axylo-heatmap-tick').map(t => t.textContent) ?? null;
  const resize = (width: number, height: number): number => {
    size.width = width;
    size.height = height;
    controller!.invalidate.resize();
    return settle();
  };
  return {
    rec, handle, root: top, legend, laidOut, shown, ticks, resize, settle, size,
    get controller() { return controller!; },
    get interaction() { return interaction!; },
    fig, doc,
  };
}
