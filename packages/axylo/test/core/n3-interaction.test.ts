/**
 * Cycle N3 in Node, on the minimal DOM of n3-dom.ts (the browser evidence is n3-interaction-a11y.browser.test.ts):
 * - F-RESP-2 (spec I1, I4, A7): a touch tap where the readout is 'none' speaks the tapped datum's reading once,
 *   in the proxy's reading language; floating and strip readouts, and a mouse click, do not.
 * - F-A11Y-6 (spec A10): the proxy is named by its own element, whose language is plotLabel's, never the
 *   proxy's lang, which follows pointAll / pointOf; both directions on a German page, while focused.
 */
import { describe, expect, it } from 'vitest';
import { createFigure } from '../../src/dom/figure';
import { createInteraction, type Actions, type Committed, type InteractionParts } from '../../src/dom/interaction';
import { lineSwatch } from '../../src/dom/swatch';
import { alignedTargetMarks } from '../../src/core/focus';
import type { DatumRef, MarkRenderer, PaintBindings, ResolvedTheme } from '../../src/core/contracts';
import type { Messages } from '../../src/public';
import { defaultMessages } from '../../src/messages';
import { record } from './host';
import { TestDocument, TestEvent, type TestElement } from './n3-dom';

type Rec = ReturnType<typeof record>;

function setup(r: Rec, extra: Partial<Committed> = {}, place?: (doc: TestDocument, root: TestElement) => void) {
  r.frames();
  const cf = r.committed!;
  const doc = new TestDocument();
  const root = doc.createElement('div');
  if (place) place(doc, root); else doc.body.appendChild(root);
  const fig = createFigure(root as unknown as HTMLElement, 'n3', {
    marks: doc.createElement('svg') as unknown as Element,
    text: doc.createElement('div') as unknown as Element,
  });
  const said: { text: string; lang: string | null }[] = [];
  const announce = fig.announce.bind(fig);
  fig.announce = (text, lang = null) => { said.push({ text, lang }); announce(text, lang); };
  const selected: DatumRef[] = [];
  const renderer: MarkRenderer = { kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement, draw() {}, drawOverlay() {}, destroy() {} };
  const actions: Actions = { zoom() {}, toggle() {}, pause() {}, select(ref) { selected.push(ref); }, hover() {} };
  const parts: InteractionParts = { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null };
  const interaction = createInteraction(parts, fig, renderer, actions);
  const d: Committed = {
    kind: 'line', view: cf.view, formatters: cf.formatters, messages: defaultMessages, reader: cf.reader,
    tooSmall: false, ready: true, interactive: true, tooltip: true, legend: 'bottom', zoom: false, zoomed: false,
    streaming: false, paused: false, epoch: 1, english: () => null, pageLang: null,
    layout: cf.layout, lookup: cf.lookup, bindings: {} as PaintBindings, theme: {} as ResolvedTheme, pixelRatio: 1, ...extra,
  };
  interaction.prepare(d);
  interaction.commit(d);
  const plot = fig.plot as unknown as TestElement;
  const proxy = plot.children.find(c => c.id === 'n3-proxy')!;
  const at = (ordinal: number) => {
    let ref = cf.lookup.step(null, 'first')!;
    for (let i = 0; i < ordinal; i++) ref = cf.lookup.step(ref, 'next')!;
    const b = cf.lookup.anchor(ref)!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const ref = (ordinal: number) => {
    let r = cf.lookup.step(null, 'first')!;
    for (let i = 0; i < ordinal; i++) r = cf.lookup.step(r, 'next')!;
    return r;
  };
  const tapAt = (p: { x: number; y: number }, pointerType = 'touch', t0 = 100) => {
    plot.dispatchEvent(new TestEvent('pointerdown', { pointerType, pointerId: 1, clientX: p.x, clientY: p.y, timeStamp: t0 }));
    plot.dispatchEvent(new TestEvent('pointerup', { pointerType, pointerId: 1, clientX: p.x, clientY: p.y, timeStamp: t0 + 50 }));
    doc.defaultView.flushFrames();
  };
  const tap = (ordinal: number, pointerType = 'touch', t0 = 100) => {
    const p = at(ordinal);
    plot.dispatchEvent(new TestEvent('pointerdown', { pointerType, pointerId: 1, clientX: p.x, clientY: p.y, timeStamp: t0 }));
    plot.dispatchEvent(new TestEvent('pointerup', { pointerType, pointerId: 1, clientX: p.x, clientY: p.y, timeStamp: t0 + 50 }));
    doc.defaultView.flushFrames();
  };
  const focus = () => { proxy.focus(); proxy.dispatchEvent(new TestEvent('focus', { bubbles: false })); doc.defaultView.flushFrames(); };
  const key = (k: string) => { proxy.dispatchEvent(new TestEvent('keydown', { key: k })); doc.defaultView.flushFrames(); };
  const label = () => {
    const id = proxy.getAttribute('aria-labelledby');
    return id ? plot.children.find(c => c.id === id) ?? null : null;
  };
  const end = () => { interaction.destroy(); fig.destroy(); };
  return { doc, fig, d, layout: cf.layout, interaction, proxy, plot, said, selected, ref, tap, tapAt, focus, key, label, end };
}

const line = () => record('line', { title: 'Load', data: [0, 1, 2, 3, 4].map(x => ({ x, y: x * 10 })), x: 'x', y: { field: 'y', label: 'Load' } });

describe('F-RESP-2: a touch tap with readout none speaks the tapped datum (spec I1, I4, A7)', () => {
  it('speaks the proxy\'s reading of the tapped datum once per tap, in the proxy\'s language, and selects it', () => {
    const t = setup(line(), { readoutMode: 'none' });
    t.tap(2);
    expect(t.said).toHaveLength(1);
    expect(t.said[0]!.text).toBe(t.proxy.getAttribute('aria-valuetext'));
    // pointAll '{x}. {values}. {position}', seriesValue '{series} {value}', position 'Point {index} of {count}'.
    expect(t.said[0]!.text).toBe('2. Load 20. Point 3 of 5');
    expect(t.said[0]!.lang).toBe(t.proxy.getAttribute('lang'));
    expect(t.selected).toHaveLength(1);
    expect((t.fig.tooltip as unknown as TestElement).hidden).toBe(true);
    t.tap(4, 'touch', 1000);
    expect(t.said.map(s => s.text)).toEqual(['2. Load 20. Point 3 of 5', '4. Load 40. Point 5 of 5']);
    // A tap on the same datum again is the reader asking again: it is said again.
    t.tap(4, 'touch', 2000);
    expect(t.said).toHaveLength(3);
    expect(t.said[2]!.text).toBe('4. Load 40. Point 5 of 5');
    t.end();
  });

  it('each valid tap emits exactly one select, of the tapped datum, and one announcement; a tap on no datum neither', () => {
    const t = setup(line(), { readoutMode: 'none' });
    for (const [i, ordinal] of [3, 0, 3].entries()) {
      t.tap(ordinal, 'touch', 100 + i * 1000);
      expect(t.selected).toHaveLength(i + 1);
      expect(t.selected[i]).toEqual(t.ref(ordinal));
      expect(t.said).toHaveLength(i + 1);
    }
    expect(t.said.map(s => s.text)).toEqual(['3. Load 30. Point 4 of 5', '0. Load 0. Point 1 of 5', '3. Load 30. Point 4 of 5']);
    // Far outside the plot no datum is under the finger.
    t.tapAt({ x: -5000, y: -5000 }, 'touch', 9000);
    expect(t.selected).toHaveLength(3);
    expect(t.said).toHaveLength(3);
    t.end();
  });

  it('tooltip: false is the author\'s choice of no readout: a tap selects but never speaks, in any readout mode', () => {
    for (const readoutMode of ['none', 'floating', 'strip'] as const) {
      const t = setup(line(), { readoutMode, tooltip: false });
      t.tap(2);
      t.tap(4, 'touch', 1000);
      expect(t.said, readoutMode).toEqual([]);
      expect(t.selected, readoutMode).toEqual([t.ref(2), t.ref(4)]);
      t.end();
    }
  });

  it('on a German page with built-in English readings the announcement is marked en', () => {
    const t = setup(line(), { readoutMode: 'none', pageLang: 'de', english: () => 'en' });
    t.tap(1);
    expect(t.said).toEqual([{ text: '1. Load 10. Point 2 of 5', lang: 'en' }]);
    t.end();
  });

  it('says nothing where a readout shows the value: floating (pinned tooltip) and strip', () => {
    for (const readoutMode of ['floating', 'strip'] as const) {
      const t = setup(line(), { readoutMode });
      t.tap(2);
      expect(t.said, readoutMode).toEqual([]);
      expect(t.selected, readoutMode).toHaveLength(1);
      t.end();
    }
  });

  it('a mouse click with readout none focuses the proxy instead and makes no announcement (unchanged)', () => {
    const t = setup(line(), { readoutMode: 'none' });
    t.tap(2, 'mouse');
    expect(t.said).toEqual([]);
    expect(t.doc.activeElement).toBe(t.proxy);
    expect(t.proxy.getAttribute('aria-valuetext')).toBe('2. Load 20. Point 3 of 5');
    t.end();
  });
});

describe('F-A11Y-6: the plot name has its own language (spec A10)', () => {
  const two = () => record('line', { title: 'T', data: [0, 1, 2].flatMap(x => ['Nord', 'Süd'].map((s, i) => ({ x, s, y: x + i * 5 }))), x: 'x', y: 'y', series: 's' });
  const translated = (keys: readonly (keyof Messages)[]) => (k: keyof Messages) => (keys.includes(k) ? null : 'en');

  for (const [name, messages, english, plotLabel, labelLang, allLang, oneLang] of [
    ['pointAll translated; plotLabel and pointOf built in', { ...defaultMessages, pointAll: '{x}: {values}. {position}' }, translated(['pointAll']), 'Chart plot', 'en', null, 'en'],
    ['plotLabel and pointOf translated; pointAll built in', { ...defaultMessages, plotLabel: 'Diagrammfläche', pointOf: '{series}, {x}, {value}. Punkt {index} von {count}.' }, translated(['plotLabel', 'pointOf']), 'Diagrammfläche', 'de', 'en', null],
    // The German name stays tagged German while the proxy switches to the built-in English one-series reading.
    ['plotLabel and pointAll translated; pointOf built in', { ...defaultMessages, plotLabel: 'Diagrammfläche', pointAll: '{x}: {values}. {position}' }, translated(['plotLabel', 'pointAll']), 'Diagrammfläche', 'de', null, 'en'],
  ] as const) {
    it(`${name}: label "${plotLabel}" in ${labelLang} throughout; the proxy is ${allLang ?? 'untagged'} for all series and ${oneLang ?? 'untagged'} for one`, () => {
      const t = setup(two(), { messages, english, pageLang: 'de' });
      const label = t.label()!;
      expect(label).not.toBeNull();
      expect(label.textContent).toBe(plotLabel);
      expect(label.getAttribute('lang')).toBe(labelLang);
      expect(label.getAttribute('aria-hidden')).toBe('true');
      expect(t.proxy.getAttribute('aria-label')).toBe(plotLabel);
      expect(t.proxy.getAttribute('lang')).toBe(allLang);

      t.focus();
      t.key('Home');
      expect(t.proxy.getAttribute('lang')).toBe(allLang);
      const all = t.proxy.getAttribute('aria-valuetext');
      t.key('ArrowDown');
      expect(t.doc.activeElement).toBe(t.proxy);
      expect(t.proxy.getAttribute('lang')).toBe(oneLang);
      expect(t.proxy.getAttribute('aria-valuetext')).not.toBe(all);
      expect(t.label()).toBe(label);
      expect(label.getAttribute('lang')).toBe(labelLang);
      t.key('Escape');
      expect(t.doc.activeElement).toBe(t.proxy);
      expect(t.proxy.getAttribute('lang')).toBe(allLang);
      expect(t.proxy.getAttribute('aria-valuetext')).toBe(all);
      expect(t.label()).toBe(label);
      expect(label.getAttribute('lang')).toBe(labelLang);
      t.end();
    });
  }

  // Spec A10: only text in another language than the page's is tagged. The controller's own English marking and
  // committed page language (the inherited tag as found, English included), not the stubs above, drive the plot's
  // parts here, on English pages with and without a subtag and on a German one.
  const tagged = (root: TestElement) => {
    const found: string[] = [];
    const walk = (e: TestElement) => { if (e.getAttribute('lang') !== null) found.push(`${e.id || e.tagName}=${e.getAttribute('lang')}`); e.children.forEach(walk); };
    walk(root);
    return found;
  };
  for (const [pageLang, labelLang] of [['en', null], ['en-GB', null], ['EN-us', null], ['de', 'en']] as const) {
    it(`a lang="${pageLang}" page: the plot's name carries ${labelLang ?? 'no'} language tag${labelLang ? '' : ', nor does anything in the plot'}`, () => {
      const r = record('line', { title: 'T', data: [0, 1, 2].map(x => ({ x, y: x })), x: 'x', y: 'y' }, { pageLang });
      r.frames();
      const cf = r.committed!;
      expect(cf.pageLang).toBe(pageLang);
      const t = setup(r, { english: cf.english, pageLang: cf.pageLang });
      expect(t.label()!.textContent).toBe('Chart plot');
      expect(t.label()!.getAttribute('lang')).toBe(labelLang);
      if (labelLang === null) {
        expect(tagged(t.plot)).toEqual([]);
        t.focus();
        t.key('Home');
        t.key('ArrowRight');
        expect(tagged(t.plot)).toEqual([]);
      }
      t.end();
    });
  }

  it('a page with no language: nothing in the plot is tagged, before and while focused', () => {
    // A page with no lang inherits nothing to mark against: the controller marks no text English there, as on an
    // English page (the host stub always reports a language, so the committed values are given directly).
    const t = setup(two(), { english: () => null, pageLang: null });
    expect(t.label()!.textContent).toBe('Chart plot');
    expect(tagged(t.plot)).toEqual([]);
    t.focus();
    t.key('Home');
    t.key('ArrowDown');
    expect(tagged(t.plot)).toEqual([]);
    t.key('Escape');
    expect(tagged(t.plot)).toEqual([]);
    t.end();
  });

  it('the label follows a messages change and is removed with the interaction', () => {
    const t = setup(two());
    expect(t.label()!.textContent).toBe('Chart plot');
    t.interaction.commit({ ...t.d, messages: { ...defaultMessages, plotLabel: 'Plot area' } });
    expect(t.label()!.textContent).toBe('Plot area');
    const id = t.proxy.getAttribute('aria-labelledby')!;
    expect(t.plot.children.filter(c => c.id === id)).toHaveLength(1);
    t.end();
    expect(t.plot.children.find(c => c.id === id)).toBeUndefined();
  });
});

describe('F-A11Y-6: the plot name\'s id never takes a page id (spec A1: ids unique)', () => {
  const span = (doc: TestDocument, id: string, text: string) => { const e = doc.createElement('span'); e.id = id; e.textContent = text; return e; };
  const byId = (root: TestElement, id: string): TestElement[] =>
    [...(root.id === id ? [root] : []), ...root.children.flatMap(c => byId(c, id))];

  it('in the document: ids already named like the label are skipped, and the page\'s elements keep their text', () => {
    const t = setup(line(), {}, (doc, root) => doc.body.append(span(doc, 'n3-l', 'Not the chart'), span(doc, 'n3-l0', 'Neither'), root));
    const id = t.proxy.getAttribute('aria-labelledby')!;
    // The id grows by a 0 while it is taken: n3-l, n3-l0, n3-l00.
    expect(id).toBe('n3-l00');
    expect(t.label()!.textContent).toBe('Chart plot');
    expect(byId(t.doc.documentElement, id)).toHaveLength(1);
    expect(t.doc.getElementById('n3-l')!.textContent).toBe('Not the chart');
    expect(t.doc.getElementById('n3-l0')!.textContent).toBe('Neither');
    t.end();
  });

  it('in a shadow root: ids in the shadow tree, where aria-labelledby resolves, are skipped', () => {
    let shadow: TestElement | null = null;
    const t = setup(line(), {}, (doc, root) => {
      const host = doc.createElement('div');
      doc.body.append(host);
      const sr = shadow = doc.createElement('#shadow-root');
      // The minimal DOM has no shadow trees: a fragment that answers as one (nodeType 11, host, its own getElementById).
      Object.defineProperties(sr, {
        nodeType: { value: 11 }, host: { value: host }, isConnected: { value: true },
        getElementById: { value: (id: string) => byId(sr, id).find(e => e !== sr) ?? null },
      });
      sr.append(span(doc, 'n3-l', 'Shadow'), span(doc, 'n3-l0', 'Shadow too'), root);
    });
    const id = t.proxy.getAttribute('aria-labelledby')!;
    expect(id).toBe('n3-l00');
    expect(t.label()!.textContent).toBe('Chart plot');
    expect(byId(shadow!, id)).toHaveLength(1);
    t.end();
  });

  it('with no collision the id is the figure\'s own -l suffix, and stays the same across commits', () => {
    const t = setup(line());
    expect(t.proxy.getAttribute('aria-labelledby')).toBe('n3-l');
    t.interaction.commit({ ...t.d, messages: { ...defaultMessages, plotLabel: 'Plot area' } });
    expect(t.proxy.getAttribute('aria-labelledby')).toBe('n3-l');
    t.end();
  });
});

describe('F-A11Y-6: the plot name\'s id is checked again where the chart reattaches (spec A1: ids unique)', () => {
  const span = (doc: TestDocument, id: string, text: string) => { const e = doc.createElement('span'); e.id = id; e.textContent = text; return e; };
  const byId = (root: TestElement, id: string): TestElement[] =>
    [...(root.id === id ? [root] : []), ...root.children.flatMap(c => byId(c, id))];
  const shadowIn = (doc: TestDocument) => {
    const host = doc.createElement('div');
    doc.body.append(host);
    const sr = doc.createElement('#shadow-root');
    // As above: a fragment that answers as a shadow root, with its own getElementById (first in tree order).
    Object.defineProperties(sr, {
      nodeType: { value: 11 }, host: { value: host }, isConnected: { value: true },
      getElementById: { value: (id: string) => byId(sr, id).find(e => e !== sr) ?? null },
    });
    return sr;
  };

  it('moved from the document into a shadow root, then to another and back: taken ids are skipped, the page keeps its elements, and the slider is the same node', () => {
    let root: TestElement | null = null;
    const t = setup(line(), {}, (doc, r) => { root = r; doc.body.appendChild(r); });
    const proxy = t.proxy;
    expect(proxy.getAttribute('aria-labelledby')).toBe('n3-l');
    const move = (into: TestElement) => { t.interaction.detach(); root!.remove(); into.appendChild(root!); t.interaction.attach(); };

    const first = shadowIn(t.doc);
    const a = span(t.doc, 'n3-l', 'Not the chart');
    first.append(a);
    move(first);
    expect(t.plot.children.find(c => c.id === 'n3-proxy')).toBe(proxy);
    expect(proxy.getAttribute('aria-labelledby')).toBe('n3-l0');
    expect(t.label()!.textContent).toBe('Chart plot');
    expect(byId(first, 'n3-l0')).toHaveLength(1);
    expect(byId(first, 'n3-l')).toEqual([a]);
    expect(a.textContent).toBe('Not the chart');

    const second = shadowIn(t.doc);
    second.append(span(t.doc, 'n3-l', 'Taken'), span(t.doc, 'n3-l0', 'Taken too'));
    move(second);
    expect(proxy.getAttribute('aria-labelledby')).toBe('n3-l00');
    expect(t.label()!.textContent).toBe('Chart plot');
    expect(byId(second, 'n3-l00')).toHaveLength(1);

    // Back in the document, where nothing is named like the label: the shortest id again.
    move(t.doc.body);
    expect(proxy.getAttribute('aria-labelledby')).toBe('n3-l');
    expect(t.label()!.textContent).toBe('Chart plot');
    t.end();
  });

  it('reattached in the same tree, a lookup that finds the label itself keeps its id', () => {
    let root: TestElement | null = null;
    const t = setup(line(), {}, (doc, r) => { root = r; doc.body.append(span(doc, 'n3-l', 'Page'), r); });
    expect(t.proxy.getAttribute('aria-labelledby')).toBe('n3-l0');
    t.interaction.detach();
    t.interaction.attach();
    expect(t.proxy.getAttribute('aria-labelledby')).toBe('n3-l0');
    expect(t.label()!.id).toBe('n3-l0');
    expect(t.doc.getElementById('n3-l0')).toBe(t.label());
    expect(t.doc.getElementById('n3-l')!.textContent).toBe('Page');
    expect(root).not.toBeNull();
    t.end();
  });
});
