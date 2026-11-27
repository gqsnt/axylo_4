/**
 * The real interaction layer (createInteraction on the N3 DOM double) over a recorded commit, as
 * test/core/n3-interaction.test.ts sets it up; shared by the heatmap lifecycle and committed-state tests.
 */
import type { DatumRef, MarkRenderer } from '../../../src/core/contracts';
import { createFigure } from '../../../src/dom/figure';
import { createInteraction, type Actions, type Committed } from '../../../src/dom/interaction';
import { TestDocument, TestEvent, type TestElement } from '../../core/n3-dom';
import type { openRecorded } from './host';

/** The real interaction layer over a recorded commit, as test/core/n3-interaction.test.ts sets it up. */
export function interactive(rec: ReturnType<typeof openRecorded>['rec'], composition: ReturnType<typeof openRecorded>['composition']) {
  const doc = new TestDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const fig = createFigure(root as unknown as HTMLElement, 'hm', {
    marks: doc.createElement('svg') as unknown as Element,
    text: doc.createElement('div') as unknown as Element,
  });
  const said: string[] = [];
  const announce = fig.announce.bind(fig);
  fig.announce = (text, lang = null) => { said.push(text); announce(text, lang); };
  const renderer: MarkRenderer = { kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement, draw() {}, drawOverlay() {}, destroy() {} };
  const hovered: (DatumRef | null)[] = [];
  const actions: Actions = { zoom() {}, toggle() {}, pause() {}, select() {}, hover(ref) { hovered.push(ref); } };
  const interaction = createInteraction(composition.interaction, fig, renderer, actions);
  const show = (d: Committed) => { interaction.prepare(d); interaction.commit(d); doc.defaultView.flushFrames(); };
  show(rec.committed!);
  const plot = fig.plot as unknown as TestElement;
  const proxy = () => plot.children.find(c => c.id === 'hm-proxy')!;
  const legend = () => (root as unknown as TestElement).querySelector('.axylo-heatmap-legend');
  // The legend as a reader sees it: in the tree, and neither it nor an ancestor hidden or display: none.
  const shownLegend = () => {
    const list = legend();
    for (let el: TestElement | null = list; el; el = el.parentElement) {
      if (el.hidden || el.style['display'] === 'none') return null;
      if (el === (root as unknown as TestElement)) return list;
    }
    return null;
  };
  const ticks = () => legend()?.querySelectorAll('.axylo-heatmap-tick').map(t => t.textContent) ?? null;
  const focus = () => { proxy().focus(); proxy().dispatchEvent(new TestEvent('focus', { bubbles: false })); doc.defaultView.flushFrames(); };
  const key = (k: string) => { proxy().dispatchEvent(new TestEvent('keydown', { key: k })); doc.defaultView.flushFrames(); };
  const reading = () => proxy().getAttribute('aria-valuetext');
  const hover = (x: number, y: number) => {
    (fig.stage as unknown as TestElement).dispatchEvent(new TestEvent('pointermove', { pointerType: 'mouse', pointerId: 1, clientX: x, clientY: y, timeStamp: 10 }));
    doc.defaultView.flushFrames();
  };
  // The tooltip DOM needs real layout (the Chrome test reads it); here: the model the layer renders for the hovered ref.
  const tooltip = () => {
    const ref = hovered.at(-1);
    if (!ref || ref.kind !== 'point') return '';
    const m = rec.committed!.lookup.tooltip({ kind: 'point', refs: [ref], count: 1 });
    return [m.title, ...m.rows.map(r => `${r.seriesLabel} ${r.value}`)].join(' | ');
  };
  return { doc, fig, interaction, show, legend, shownLegend, ticks, focus, key, reading, hover, tooltip, said, root: root as unknown as TestElement };
}

