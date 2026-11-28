/**
 * W4 integration review (blocker 3): the size legend is published with the revision the plot draws, in the same
 * frame, so author callbacks (onDiagnostic, delivered after the frame) and the whole-figure export seam never see
 * a new plot and table beside the old legend.
 *
 * Rule under test (export contract CHROME: the figure is one revision; controller: author code runs after the
 * frame is complete): on the real interaction layer in Node, a size-only update to `alt` (label Altitude, unit m)
 * whose format throws for the reference value 25 reports AX160 after the frame; inside that onDiagnostic call the
 * legend already reads Altitude with the reference sizes of a largest 40 (25, 5, 1: spatial/bubble/legend.ts),
 * matching the drawn table's size header, with no microtask in between.
 */
import { describe, expect, it } from 'vitest';
import { controllerFor } from '../../../src/core/controller';
import type { Composition } from '../../../src/core/composition';
import type { MarkRenderer, PaintBindings, ResolvedTheme } from '../../../src/core/contracts';
import { createFigure } from '../../../src/dom/figure';
import { createInteraction, type Actions, type Committed } from '../../../src/dom/interaction';
import { defaultMessages } from '../../../src/messages';
import { openBubbleChart } from '../../../src/spatial/bubble';
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
  return { rec, chart, interaction, fig, commit, lists, texts, settle, composition: composition! as { lookup: Composition['lookup'] } };
}

describe('size legend published with the drawn revision', () => {
  it('an onDiagnostic call after a size-only update sees the new legend beside the new table, synchronously', async () => {
    const t = setup({});
    t.commit();
    await Promise.resolve();
    expect(t.texts()).toEqual([['pop', '1,000', '250', '50']]);
    const seen: { code: string; legend: (string | null)[][]; header: string | undefined }[] = [];
    const format = (v: number) => { if (v === 25) throw new Error('no 25'); return `${v} m`; };
    t.chart.update({
      size: { field: 'alt', label: 'Altitude', unit: 'm', format },
      onDiagnostic: (d: { code: string }) => seen.push({ code: d.code, legend: t.texts(), header: t.rec.committed?.reader.table?.headers.at(-1) }),
    } as never);
    seen.length = 0;
    // The frame only: no commit of the separate interaction and no microtask before the callbacks run.
    t.rec.frames();
    const ax160 = seen.filter(s => s.code === 'AX160');
    expect(ax160.length).toBeGreaterThan(0);
    for (const s of ax160) {
      expect(s.header).toBe('Altitude (m)');
      expect(s.legend.map(entry => entry[0])).toEqual(['Altitude (m)']);
      expect(s.legend[0]!.slice(1)).toEqual([expect.stringContaining('25'), '5 m', '1 m']);
    }
  });

  it('a size format that calls update while the legend is looked up: every onDiagnostic call sees the legend of the plot and table drawn', async () => {
    const t = setup({});
    t.commit();
    await Promise.resolve();
    const seen: { legend: string | null | undefined; header: string | undefined }[] = [];
    let updates = 0, inLookup = false;
    // The lookup stage is marked from outside (the composition object the controller calls), so the size
    // format re-enters update() exactly while the lookup formats the legend texts.
    const lookup = t.composition.lookup;
    t.composition.lookup = (...args) => { inLookup = true; try { return lookup(...args); } finally { inLookup = false; } };
    const format = (v: number) => {
      if (v === 25) throw new Error('no 25');
      if (inLookup && updates < 3) { updates++; t.chart.update({ title: `T${updates}` }); }
      return `${v} m`;
    };
    t.chart.update({
      size: { field: 'alt', label: 'Altitude', unit: 'm', format },
      onDiagnostic: () => seen.push({ legend: t.texts()[0]?.[0], header: t.rec.committed?.reader.table?.headers.at(-1) }),
    } as never);
    seen.length = 0;
    for (let k = 0; k < 8; k++) t.rec.frames();
    expect(updates).toBeGreaterThan(0);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.legend).toBe(s.header);
    await Promise.resolve();
    await Promise.resolve();
    expect(t.texts()[0]?.[0]).toBe('Altitude (m)');
  });
});
