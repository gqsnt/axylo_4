/**
 * The size legend on the real interaction layer in Node (the minimal DOM of test/core/n3-dom.ts): mounted through
 * `sliceList` beside the toolbar, refreshed on a single-series chart when its size, data or locale change (the
 * toolbar does not call `sliceList` again for those: its inputs only cover several series), removed when the
 * legend is turned off, and released when the interaction is destroyed. The Chrome test repeats this on a page.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor } from '../../../src/core/controller';
import type { Composition } from '../../../src/core/composition';
import type { MarkRenderer, PaintBindings, ResolvedTheme } from '../../../src/core/contracts';
import { createFigure } from '../../../src/dom/figure';
import { createInteraction, type Actions, type Committed } from '../../../src/dom/interaction';
import { defaultMessages } from '../../../src/messages';
import { bubbleInternals, openBubbleChart } from '../../../src/spatial/bubble';
import { record } from '../../finance/host';
import { TestDocument, type TestElement } from '../../core/n3-dom';

const ROWS = [{ x: 1, y: 1, pop: 1000, alt: 30 }, { x: 2, y: 2, pop: 10, alt: 40 }];

function setup(options: Record<string, unknown>) {
  const rec = record();
  let composition: Composition | null = null;
  const chart = openBubbleChart({ title: 'Legend', data: ROWS, x: 'x', y: 'y', size: 'pop', ...options }, (c, input) => {
    composition = c;
    return controllerFor(c, input, rec.host, null).handle;
  });
  rec.frames();
  const doc = new TestDocument();
  const root = doc.createElement('div');
  doc.body.appendChild(root);
  const fig = createFigure(root as unknown as HTMLElement, 'n8b', {
    marks: doc.createElement('svg') as unknown as Element, text: doc.createElement('div') as unknown as Element,
  });
  const renderer: MarkRenderer = { kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement, draw() {}, drawOverlay() {}, destroy() {} };
  const actions: Actions = { zoom() {}, toggle() {}, pause() {}, select() {}, hover() {} };
  const interaction = createInteraction(composition!.interaction, fig, renderer, actions);
  const commit = (extra: Partial<Committed> = {}) => {
    const cf = rec.committed!;
    const d: Committed = {
      kind: 'scatter', view: cf.view, formatters: cf.formatters, messages: defaultMessages, reader: cf.reader,
      tooSmall: false, ready: true, interactive: true, tooltip: true, legend: 'bottom', zoom: false, zoomed: false,
      streaming: false, paused: false, epoch: 1, english: () => null, pageLang: null,
      layout: cf.layout, lookup: cf.lookup, bindings: {} as PaintBindings, theme: {} as ResolvedTheme, pixelRatio: 1, ...extra,
    };
    interaction.prepare(d);
    interaction.commit(d);
  };
  const lists = (): TestElement[] => {
    const out: TestElement[] = [];
    const walk = (e: TestElement) => { if (e.tagName?.toLowerCase() === 'ul' && e.className.includes('axylo-bubble-legend')) out.push(e); e.children.forEach(walk); };
    walk(root);
    return out;
  };
  const texts = () => lists().map(ul => ul.children.map(li => li.textContent));
  const settle = async () => { rec.frames(); commit(); await Promise.resolve(); await Promise.resolve(); };
  return { rec, chart, interaction, fig, commit, lists, texts, settle };
}

describe('size legend lifecycle (Node DOM)', () => {
  it('a single-series chart refreshes the legend on size, data and locale changes, and releases it on destroy', async () => {
    const t = setup({});
    t.commit();
    expect(t.texts()).toEqual([['pop', '1,000', '250', '50']]);
    const list = t.lists()[0]!;

    t.chart.update({ size: { field: 'alt', label: 'Altitude', unit: 'm' } } as never);
    await t.settle();
    // Largest size 40: the nice sizes at or below 40, 25/4 and 25/16 are 25, 5 and 1.
    expect(t.texts()).toEqual([['Altitude (m)', '25 m', '5 m', '1 m']]);
    // The same list element, refreshed in place: the toolbar never asked for it again.
    expect(t.lists()[0]).toBe(list);

    t.chart.update({ data: ROWS.map(r => ({ ...r, alt: r.alt * 100 })) } as never);
    await t.settle();
    // Largest 4,000: 2,500, then 625 → 500 and 156.25 → 100.
    expect(t.texts()).toEqual([['Altitude (m)', '2,500 m', '500 m', '100 m']]);

    t.chart.update({ locale: 'de-DE' } as never);
    await t.settle();
    expect(t.texts()).toEqual([['Altitude (m)', '2.500 m', '500 m', '100 m']]);

    t.rec.frames();
    t.commit({ legend: false });
    expect(t.lists()).toEqual([]);
    t.commit({ legend: 'bottom' });
    expect(t.texts()).toEqual([['Altitude (m)', '2.500 m', '500 m', '100 m']]);

    t.interaction.destroy();
    t.fig.destroy();
    expect(t.lists()).toEqual([]);
    // Nothing mounted is kept for a later refresh.
    t.chart.update({ size: 'pop' } as never);
    t.rec.frames();
    await Promise.resolve();
    expect(t.lists()).toEqual([]);
    expect(bubbleInternals(t.chart)!.legend!.title).toBe('pop');
  });

  it('the legend circles are the painted radii and carry no tab stop', () => {
    const t = setup({ radius: { min: 0, max: 20 } });
    t.commit();
    const ul = t.lists()[0]!;
    const svg = ul.children[0]!.children[0]!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.children.map(c => Number(c.getAttribute('r')))).toEqual([20, 10, Number((20 * Math.sqrt(0.05)).toPrecision(7))]);
    expect(ul.children.every(li => li.getAttribute('tabindex') === null)).toBe(true);
    t.interaction.destroy();
  });
});
