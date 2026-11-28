/**
 * N7b whole-figure SVG composition on a small fake DOM (Node has none). The fake gives each element a
 * computed style and a box, and each text node its line boxes, the way a laid-out page would; the export must
 * place every visible part at its box, leave out what is hidden or not part of a figure, keep rotation, split
 * wrapped text by line, resolve paint, and keep the figure's name and description. Real layout and paint are
 * checked in Chrome (tests/dist/export.browser.test.ts with tests/dist/export-conformance.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportSvg } from '../../src/export';
import { register } from '../../src/export/contract';

interface Box { x: number; y: number; w: number; h: number }
const rect = (b: Box) => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h, width: b.w, height: b.h, x: b.x, y: b.y });
type Rect = ReturnType<typeof rect>;

class FakeText {
  readonly nodeType = 3;
  parentElement: FakeElement | null = null;
  /** One box per line, and optionally one per character (for wrapped text). */
  constructor(readonly data: string, readonly lines: Box[], readonly chars?: Box[]) {}
}

type Style = Record<string, string>;
const DEFAULT_STYLE: Style = {
  display: 'block', visibility: 'visible', opacity: '1', transform: 'none', color: 'rgb(17, 17, 17)', fontFamily: '"Fake Sans", sans-serif',
  fontSize: '14px', fontWeight: '400', fontStyle: 'normal', textDecoration: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', overflow: 'visible',
  letterSpacing: 'normal', wordSpacing: '0px',
};

class FakeElement {
  readonly nodeType = 1;
  parentElement: FakeElement | null = null;
  childNodes: (FakeElement | FakeText)[] = [];
  readonly attrs = new Map<string, string>();
  shadowRoot = null;
  ownerDocument!: FakeDocument;
  constructor(readonly localName: string, attrs: Record<string, string> = {}, public style: Style = {}, public box: Box = { x: 0, y: 0, w: 0, h: 0 }) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  get parentNode(): FakeElement | null { return this.parentElement; }
  get attributes(): { name: string; value: string }[] { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  querySelectorAll(): FakeElement[] { return this.children.flatMap(c => [c, ...c.querySelectorAll()]); }
  get children(): FakeElement[] { return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement); }
  append(...nodes: (FakeElement | FakeText)[]): this {
    for (const n of nodes) { n.parentElement = this; this.childNodes.push(n); }
    return this;
  }
  get textContent(): string { return this.childNodes.map(n => (n instanceof FakeElement ? n.textContent : n.data)).join(''); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  getBoundingClientRect(): Rect { return rect(this.box); }
  getRootNode(): FakeDocument { return this.ownerDocument; }
  remove(): void {
    const p = this.parentElement;
    if (p) p.childNodes = p.childNodes.filter(n => n !== this);
    this.parentElement = null;
  }
  cloneNode(deep: boolean): FakeElement {
    const copy = new FakeElement(this.localName, Object.fromEntries(this.attrs), { ...this.style }, this.box);
    copy.ownerDocument = this.ownerDocument;
    if (deep) for (const n of this.childNodes) copy.append(n instanceof FakeElement ? n.cloneNode(true) : new FakeText(n.data, n.lines, n.chars));
    return copy;
  }
  matches(selector: string): boolean { return selector.split(',').some(s => simpleMatch(this, s.trim())); }
  closest(selector: string): FakeElement | null {
    for (let at: FakeElement | null = this; at; at = at.parentElement) if (at.matches(selector)) return at;
    return null;
  }
  querySelector(selector: string): FakeElement | null {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }
}

/** Tag, `.class`, `[attr]` and `:not(.class)` compounds: all the exporter's selectors use. */
function simpleMatch(el: FakeElement, selector: string): boolean {
  const classes = (el.getAttribute('class') ?? '').split(/\s+/);
  let rest = selector;
  const not = /:not\(([^)]*)\)/.exec(rest);
  if (not) {
    if (simpleMatch(el, not[1]!)) return false;
    rest = rest.replace(not[0], '');
  }
  for (const part of rest.match(/[.#]?[\w-]+|\[[\w-]+\]/g) ?? []) {
    if (part.startsWith('.')) { if (!classes.includes(part.slice(1))) return false; }
    else if (part.startsWith('[')) { if (!el.attrs.has(part.slice(1, -1))) return false; }
    else if (el.localName !== part) return false;
  }
  return true;
}

class FakeRange {
  #node: FakeText | null = null;
  #start = 0;
  #end = 0;
  selectNodeContents(node: FakeText): void { this.#node = node; this.#start = 0; this.#end = node.data.length; }
  setStart(node: FakeText, i: number): void { this.#node = node; this.#start = i; }
  setEnd(_node: FakeText, i: number): void { this.#end = i; }
  getClientRects(): Rect[] { return this.#node!.lines.map(rect); }
  getBoundingClientRect(): Rect {
    const n = this.#node!;
    const boxes = this.#start === 0 && this.#end === n.data.length ? n.lines : n.chars!.slice(this.#start, this.#end);
    const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
    return rect({ x, y, w: Math.max(...boxes.map(b => b.x + b.w)) - x, h: Math.max(...boxes.map(b => b.y + b.h)) - y });
  }
}

function serialize(el: FakeElement): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const attrs = [...el.attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<${el.localName}${attrs}>${el.childNodes.map(n => (n instanceof FakeElement ? serialize(n) : esc(n.data))).join('')}</${el.localName}>`;
}

class FakeDocument {
  readonly URL = 'https://example.test/page?q=1#top';
  readonly byId = new Map<string, FakeElement>();
  readonly defaultView = {
    getComputedStyle: (el: FakeElement) => {
      const s = { ...DEFAULT_STYLE, ...el.style };
      return { ...s, getPropertyValue: (name: string) => s[name] ?? s[name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] ?? '' };
    },
    XMLSerializer: class { serializeToString(el: FakeElement) { return serialize(el); } },
    /** The two numbers of a computed `matrix(a, b, …)` the exporter reads, identity for `none`. */
    DOMMatrix: class { a = 1; b = 0; constructor(t: string) { const m = /^matrix\(([^,]+),([^,]+)/.exec(t); if (m) { this.a = +m[1]!; this.b = +m[2]!; } } },
  };
  createRange(): FakeRange { return new FakeRange(); }
  getElementById(id: string): FakeElement | null { return this.byId.get(id) ?? null; }
}

function el(doc: FakeDocument, tag: string, attrs: Record<string, string>, style: Style, box: Box, ...kids: (FakeElement | FakeText)[]): FakeElement {
  const e = new FakeElement(tag, attrs, style, box);
  e.ownerDocument = doc;
  if (attrs.id) doc.byId.set(attrs.id, e);
  return e.append(...kids);
}

/**
 * A full figure at page offset (100, 50), 600 × 400: caption (title, subtitle, hidden description), the
 * plot (mark surface with an overlay, a label rotated -45° and one on two lines), a bottom legend of two
 * entries and a "View as table" control, a hidden tooltip and the note, wrapped over two lines.
 */
function figure(doc: FakeDocument, rootStyle: Style = {}) {
  const t = (s: string, b: Box, chars?: Box[]) => new FakeText(s, [b], chars);
  const swatch = (x: number) => el(doc, 'svg', { class: 'axylo-swatch', viewBox: '0 0 20 12', 'aria-hidden': 'true' }, { color: 'rgb(0, 90, 200)' }, { x, y: 402, w: 20, h: 12 },
    el(doc, 'path', { d: 'M5 1H15V11H5Z', fill: 'currentColor' }, { fill: 'rgb(0, 90, 200)', stroke: 'none' }, { x, y: 402, w: 10, h: 10 }));
  const noteText = 'Values not shown: 1. See the table.';
  const noteChars = [...noteText].map((_, i) => (i < 21 ? { x: 110 + 8 * i, y: 430, w: 8, h: 16 } : { x: 110 + 8 * (i - 21), y: 446, w: 8, h: 16 }));
  const fig = el(doc, 'figure', { class: 'axylo axylo-figure', id: 'c', 'aria-labelledby': 'c-t', 'aria-describedby': 'c-s' }, {}, { x: 100, y: 50, w: 600, h: 400 },
    el(doc, 'div', { class: 'axylo-caption' }, {}, { x: 100, y: 50, w: 600, h: 44 },
      el(doc, 'div', { class: 'axylo-title', id: 'c-t' }, { fontWeight: '600', fontSize: '18px' }, { x: 100, y: 50, w: 600, h: 24 }, t('Revenue & "cost"', { x: 100, y: 52, w: 160, h: 20 })),
      el(doc, 'p', { class: 'axylo-subtitle' }, { color: 'rgb(90, 90, 90)' }, { x: 100, y: 74, w: 600, h: 18 }, t('In USD', { x: 100, y: 75, w: 50, h: 16 })),
      el(doc, 'p', { class: 'axylo-description axylo-visually-hidden', id: 'c-s' }, {}, { x: 0, y: 0, w: 1, h: 1 }, t('Line chart of revenue.', { x: 0, y: 0, w: 1, h: 1 }))),
    el(doc, 'div', { class: 'axylo-body' }, {}, { x: 100, y: 94, w: 600, h: 300 },
      el(doc, 'div', { class: 'axylo-stage' }, {}, { x: 100, y: 94, w: 600, h: 300 },
        el(doc, 'div', { class: 'axylo-plot' }, {}, { x: 100, y: 94, w: 600, h: 300 },
          el(doc, 'svg', { class: 'axylo-svg', viewBox: '0 0 600 300', width: '600', height: '300', 'aria-hidden': 'true', style: 'position: absolute' }, {}, { x: 100, y: 94, w: 600, h: 300 },
            el(doc, 'defs', {}, { display: 'none' }, { x: 0, y: 0, w: 0, h: 0 },
              el(doc, 'clipPath', { id: 'clip-1' }, { display: 'none' }, { x: 0, y: 0, w: 0, h: 0 })),
            el(doc, 'g', { class: 'axylo-scene' }, { fill: 'rgb(0, 0, 0)' }, { x: 100, y: 94, w: 600, h: 300 },
              el(doc, 'path', { d: 'M0 0L10 10', 'clip-path': 'url(#clip-1)', style: 'color: var(--axylo-series-color-1)' }, { fill: 'none', stroke: 'rgb(0, 90, 200)', 'stroke-width': '2px' }, { x: 100, y: 94, w: 10, h: 10 }),
              el(doc, 'path', { d: 'M1 1', class: 'gone' }, { display: 'none' }, { x: 0, y: 0, w: 0, h: 0 })),
            el(doc, 'g', { class: 'axylo-overlay' }, {}, { x: 100, y: 94, w: 600, h: 300 },
              el(doc, 'path', { d: 'M5 5', class: 'crosshair' }, { stroke: 'rgb(1, 2, 3)' }, { x: 0, y: 0, w: 0, h: 0 }))),
          el(doc, 'div', { class: 'axylo-text' }, {}, { x: 100, y: 94, w: 600, h: 300 },
            el(doc, 'div', { class: 'axylo-label' }, { transform: 'matrix(0.707107, -0.707107, 0.707107, 0.707107, 140, 380)' }, { x: 120, y: 350, w: 40, h: 40 },
              el(doc, 'div', {}, {}, { x: 120, y: 350, w: 40, h: 40 }, t('January', { x: 120, y: 350, w: 40, h: 40 }))),
            el(doc, 'div', { class: 'axylo-label' }, {}, { x: 300, y: 370, w: 60, h: 30 },
              el(doc, 'div', {}, {}, { x: 300, y: 370, w: 60, h: 15 }, t('Q1', { x: 320, y: 370, w: 20, h: 15 })),
              el(doc, 'div', {}, {}, { x: 300, y: 385, w: 60, h: 15 }, t('2026', { x: 315, y: 385, w: 30, h: 15 }))),
            el(doc, 'div', { class: 'axylo-label', hidden: '' }, {}, { x: 0, y: 0, w: 10, h: 10 }, t('Hidden label', { x: 0, y: 0, w: 10, h: 10 }))),
          el(doc, 'input', { class: 'axylo-proxy' }, {}, { x: 100, y: 94, w: 1, h: 1 }),
          el(doc, 'p', { class: 'axylo-message', hidden: '' }, {}, { x: 0, y: 0, w: 0, h: 0 }, t('Loading chart.', { x: 0, y: 0, w: 10, h: 10 }))),
        el(doc, 'div', { class: 'axylo-readout', hidden: '' }, {}, { x: 0, y: 0, w: 0, h: 0 }, t('Readout', { x: 0, y: 0, w: 10, h: 10 })))),
    el(doc, 'div', { class: 'axylo-controls' }, {}, { x: 100, y: 398, w: 600, h: 24 },
      el(doc, 'div', { class: 'axylo-toolbar' }, {}, { x: 100, y: 398, w: 600, h: 24 },
        el(doc, 'button', { class: 'axylo-control axylo-legend-entry' }, {}, { x: 100, y: 398, w: 90, h: 20 },
          swatch(104), el(doc, 'span', { class: 'axylo-control-label' }, {}, { x: 128, y: 400, w: 60, h: 16 }, t('Revenue', { x: 128, y: 400, w: 60, h: 16 }))),
        el(doc, 'button', { class: 'axylo-control axylo-legend-entry axylo-struck' }, {}, { x: 200, y: 398, w: 70, h: 20 },
          swatch(204), el(doc, 'span', { class: 'axylo-control-label' }, { textDecoration: 'line-through' }, { x: 228, y: 400, w: 40, h: 16 }, t('Cost', { x: 228, y: 400, w: 40, h: 16 }))),
        el(doc, 'button', { class: 'axylo-control' }, {}, { x: 600, y: 398, w: 100, h: 20 }, t('View as table', { x: 600, y: 400, w: 100, h: 16 })))),
    el(doc, 'p', { class: 'axylo-note' }, {}, { x: 100, y: 428, w: 200, h: 36 }, t(noteText, { x: 110, y: 430, w: 168, h: 32 }, noteChars)),
    el(doc, 'div', { class: 'axylo-tooltip', hidden: '' }, {}, { x: 0, y: 0, w: 50, h: 50 }, t('Tooltip', { x: 0, y: 0, w: 50, h: 50 })));
  // Two line boxes for the wrapped note.
  (fig.children.at(-2)!.childNodes[0] as FakeText).lines.splice(0, 1, { x: 110, y: 430, w: 168, h: 16 }, { x: 110, y: 446, w: 112, h: 16 });
  const root = el(doc, 'div', { id: 'chart', class: 'axylo' }, rootStyle, { x: 100, y: 50, w: 600, h: 400 }, fig);
  const body = el(doc, 'body', {}, {}, { x: 0, y: 0, w: 900, h: 700 }, root);
  // Registered the way a mounted chart registers (export/contract.ts): the figure and its root.
  register(Object.freeze({ table: null, figure: fig as never, plot: fig.querySelector('.axylo-plot') as never }), fig as never);
  return { root, fig, body };
}

const textsOf = (svg: string) => [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"([^>]*)>([^<]*)<\/text>/g)]
  .map(m => ({ x: Number(m[1]), y: Number(m[2]), attrs: m[3]!, text: m[4]! }));

let previousRect: unknown;
beforeAll(() => {
  previousRect = (globalThis as { DOMRect?: unknown }).DOMRect;
  (globalThis as { DOMRect?: unknown }).DOMRect = class { constructor(x: number, y: number, w: number, h: number) { return rect({ x, y, w, h }); } };
});
afterAll(() => { (globalThis as { DOMRect?: unknown }).DOMRect = previousRect; });

describe('N7b exportSvg composes the whole visible figure', () => {
  it('places caption, plot surface, labels, legend and note in one translated group, and leaves out hidden and transient parts', () => {
    const doc = new FakeDocument();
    const { root } = figure(doc);
    const svg = exportSvg(root as unknown as HTMLElement);
    // The union of the boxes: the figure (100,50 600×400) and the note's second line reaching y = 462.
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" role="img" width="600" height="412" viewBox="0 0 600 412">/);
    expect(svg).toContain('<title>Revenue &#38; &#34;cost&#34;</title><desc>Line chart of revenue.</desc>');
    expect(svg).toContain('<g transform="translate(-100 -50)">');
    expect(svg).toContain('<rect width="100%" height="100%" fill="#ffffff"/>');
    const texts = textsOf(svg);
    expect(texts.map(t => t.text)).toEqual([
      'Revenue &#38; &#34;cost&#34;', 'In USD', 'January', 'Q1', '2026', 'Revenue', 'Cost', 'Values not shown: 1.', 'See the table.',
    ]);
    // Centres of the text boxes, in page coordinates inside the translated group.
    expect(texts[0]).toMatchObject({ x: 180, y: 62 });
    expect(texts[0]!.attrs).toContain('font-weight="600"');
    expect(texts[0]!.attrs).toContain('font-size="18px"');
    expect(texts[0]!.attrs).toContain('font-family="&#34;Fake Sans&#34;, sans-serif"');
    expect(texts[0]!.attrs).toContain('letter-spacing="normal" word-spacing="0px"');
    expect(texts[1]!.attrs).toContain('fill="rgb(90, 90, 90)"');
    // The -45° label keeps its angle about its centre; the two-line label is two texts.
    expect(texts[2]).toMatchObject({ x: 140, y: 370 });
    expect(texts[2]!.attrs).toContain('transform="rotate(-45 140 370)"');
    expect(texts[3]).toMatchObject({ x: 330, y: 377.5 });
    expect(texts[4]).toMatchObject({ x: 330, y: 392.5 });
    expect(texts[6]!.attrs).toContain('text-decoration="line-through"');
    // The wrapped note: one text per line, each centred on its own line box.
    expect(texts[7]).toMatchObject({ x: 194, y: 438 });
    expect(texts[8]).toMatchObject({ x: 166, y: 454 });
    for (const hidden of ['Hidden label', 'Loading chart.', 'Readout', 'Tooltip', 'View as table', 'crosshair', 'gone', 'axylo-proxy']) {
      expect(svg, hidden).not.toContain(hidden);
    }
  });

  it('nests the mark surface and the swatches as SVGs at their boxes, with resolved paint and the scene viewBox and clip', () => {
    const doc = new FakeDocument();
    const { root } = figure(doc);
    const svg = exportSvg(root as unknown as HTMLElement);
    const nested = [...svg.matchAll(/<svg (?!xmlns="http:\/\/www.w3.org\/2000\/svg" role)([^>]*)>/g)].map(m => m[1]!);
    expect(nested).toHaveLength(3);
    expect(nested[0]).toContain('viewBox="0 0 600 300"');
    for (const attr of ['x="100"', 'y="94"', 'width="600"', 'height="300"']) expect(nested[0]).toContain(attr);
    for (const swatch of nested.slice(1)) expect(swatch).toContain('viewBox="0 0 20 12"');
    for (const attr of ['x="104"', 'y="402"', 'width="20"', 'height="12"']) expect(nested[1]).toContain(attr);
    expect(svg).not.toMatch(/class="axylo-svg"|aria-hidden/);
    // Inline styles are replaced by resolved presentation attributes (a strict style CSP would drop them).
    expect(svg).not.toMatch(/\sstyle=/);
    expect(svg).toContain('clip-path="url(#clip-1)"');
    expect(svg).toContain('<clipPath id="clip-1"');
    expect(svg).toMatch(/<path d="M0 0L10 10" clip-path="url\(#clip-1\)" color="rgb\(17, 17, 17\)" fill="none" stroke="rgb\(0, 90, 200\)" stroke-width="2px"/);
    expect(svg).toMatch(/<path d="M5 1H15V11H5Z" fill="rgb\(0, 90, 200\)"/);
    expect(svg).not.toContain('var(--');
  });

  it('plotOnly keeps the plot and its labels only', () => {
    const doc = new FakeDocument();
    const { root } = figure(doc);
    const svg = exportSvg(root as unknown as HTMLElement, { plotOnly: true });
    // The plot's box, grown to the two-line label that reaches below it (y = 400).
    expect(svg).toMatch(/width="600" height="306" viewBox="0 0 600 306"/);
    expect(svg).toContain('<g transform="translate(-100 -94)">');
    expect(textsOf(svg).map(t => t.text)).toEqual(['January', 'Q1', '2026']);
    expect(svg).toContain('<title>');
  });

  it('takes the first opaque background behind the figure (dark), honours an explicit or transparent one, and the output size', () => {
    const doc = new FakeDocument();
    const { root } = figure(doc, { backgroundColor: 'rgb(18, 18, 18)' });
    expect(exportSvg(root as unknown as HTMLElement)).toContain('<rect width="100%" height="100%" fill="rgb(18, 18, 18)"/>');
    expect(exportSvg(root as unknown as HTMLElement, { background: '#123456' })).toContain('fill="#123456"/>');
    expect(exportSvg(root as unknown as HTMLElement, { background: 'transparent' })).not.toContain('<rect width="100%"');
    const sized = exportSvg(root as unknown as HTMLElement, { width: 300, height: 206, includeMetadata: false });
    expect(sized).toMatch(/width="300" height="206" viewBox="0 0 600 412"/);
    expect(sized).not.toContain('<title>');
  });

  it('finds the figure from inside it, and reports a target without a chart surface', () => {
    const doc = new FakeDocument();
    const { fig, body } = figure(doc);
    const inner = fig.querySelector('.axylo-plot')!;
    expect(exportSvg(inner as unknown as HTMLElement)).toBe(exportSvg(fig as unknown as HTMLElement));
    const empty = el(doc, 'div', {}, {}, { x: 0, y: 0, w: 10, h: 10 });
    body.append(empty);
    expect(() => exportSvg(empty as unknown as HTMLElement)).toThrow(/no rendered <svg> chart surface/);
  });
});

/**
 * A registered figure of a Wave 4-style family at (0, 0), 400 × 300, whose plot is not `.axylo-svg`: a
 * caption, the plot (clipped, `overflow: hidden`) holding a surface with a background layer, a local pattern
 * fill, a foreign reference and active content, and labels inside, across and outside its edge; a colour bar
 * marked `data-axylo-export`; a legend rail that clips its last entry; a part of the figure that is not chrome.
 */
function family(doc: FakeDocument, options: { noteChars?: Box[] } = {}) {
  const t = (s: string, b: Box, chars?: Box[]) => new FakeText(s, [b], chars);
  const local = 'url("https://example.test/page?q=1#hatch")', foreign = 'url("https://other.test/x.svg#a")';
  const plot = el(doc, 'div', { class: 'heat-plot' }, { overflow: 'hidden' }, { x: 0, y: 40, w: 400, h: 200 },
    el(doc, 'svg', { class: 'heat-surface', viewBox: '0 0 400 200' }, {}, { x: 0, y: 40, w: 400, h: 200 },
      el(doc, 'rect', { class: 'axylo-background', width: '400', height: '200' }, { fill: 'rgb(24, 32, 48)' }, { x: 0, y: 40, w: 400, h: 200 }),
      el(doc, 'defs', {}, { display: 'none' }, { x: 0, y: 0, w: 0, h: 0 }, el(doc, 'pattern', { id: 'hatch' }, { display: 'none' }, { x: 0, y: 0, w: 0, h: 0 })),
      el(doc, 'rect', { class: 'cell', width: '10', height: '10' }, { fill: local, stroke: foreign, transform: 'matrix(1, 0, 0, 1, 5, 6)' }, { x: 5, y: 46, w: 10, h: 10 }),
      el(doc, 'use', { href: 'https://other.test/a.svg#x', onclick: 'alert(1)' }, {}, { x: 0, y: 40, w: 1, h: 1 }),
      el(doc, 'use', { href: '#hatch' }, {}, { x: 0, y: 40, w: 1, h: 1 }),
      el(doc, 'script', {}, { display: 'inline' }, { x: 0, y: 0, w: 0, h: 0 }, t('alert(2)', { x: 0, y: 0, w: 1, h: 1 })),
      el(doc, 'foreignObject', {}, {}, { x: 0, y: 40, w: 10, h: 10 }, t('embedded', { x: 0, y: 40, w: 10, h: 10 }))),
    el(doc, 'div', { class: 'axylo-label' }, {}, { x: 10, y: 60, w: 40, h: 16 }, t('Inside', { x: 10, y: 60, w: 40, h: 16 })),
    el(doc, 'div', { class: 'axylo-label' }, {}, { x: 380, y: 100, w: 60, h: 16 }, t('Across', { x: 380, y: 100, w: 60, h: 16 })),
    el(doc, 'div', { class: 'axylo-label' }, {}, { x: 500, y: 100, w: 60, h: 16 }, t('Outside', { x: 500, y: 100, w: 60, h: 16 })));
  const noteText = 'Some labels hidden. See the table.';
  const fig = el(doc, 'figure', { class: 'axylo axylo-figure', 'aria-label': 'Heat' }, {}, { x: 0, y: 0, w: 400, h: 300 },
    el(doc, 'div', { class: 'axylo-caption' }, {}, { x: 0, y: 0, w: 400, h: 40 },
      el(doc, 'div', { class: 'axylo-title axylo-visually-hidden' }, {}, { x: 0, y: 0, w: 1, h: 1 }, t('Hidden title', { x: 0, y: 0, w: 1, h: 1 })),
      el(doc, 'p', { class: 'axylo-subtitle' }, { letterSpacing: '0.5px' }, { x: 0, y: 10, w: 400, h: 18 }, t('Per hour', { x: 0, y: 10, w: 60, h: 18 }))),
    plot,
    el(doc, 'div', { 'data-axylo-export': '' }, {}, { x: 0, y: 244, w: 200, h: 20 },
      el(doc, 'svg', { class: 'colour-bar', viewBox: '0 0 200 8' }, {}, { x: 0, y: 244, w: 200, h: 8 }, el(doc, 'rect', { width: '200', height: '8' }, { fill: 'rgb(200, 0, 0)' }, { x: 0, y: 244, w: 200, h: 8 })),
      el(doc, 'span', {}, {}, { x: 0, y: 252, w: 20, h: 12 }, t('0', { x: 0, y: 252, w: 8, h: 12 }))),
    el(doc, 'div', { class: 'axylo-controls-side' }, { overflow: 'auto' }, { x: 300, y: 244, w: 100, h: 20 },
      el(doc, 'button', { class: 'axylo-control axylo-legend-entry' }, {}, { x: 300, y: 244, w: 60, h: 20 }, t('Low', { x: 304, y: 246, w: 30, h: 16 })),
      el(doc, 'button', { class: 'axylo-control axylo-legend-entry' }, {}, { x: 300, y: 270, w: 60, h: 20 }, t('High', { x: 304, y: 272, w: 30, h: 16 }))),
    el(doc, 'div', { class: 'not-chrome' }, {}, { x: 0, y: 0, w: 10, h: 10 }, t('Not chrome', { x: 0, y: 0, w: 10, h: 10 })),
    el(doc, 'p', { class: 'axylo-note' }, {}, { x: 0, y: 266, w: 200, h: 30 },
      new FakeText(noteText, [{ x: 0, y: 266, w: 160, h: 16 }, { x: 0, y: 278, w: 112, h: 16 }],
        options.noteChars ?? [...noteText].map((_, i) => (i < 20 ? { x: 8 * i, y: 266, w: 8, h: 16 } : { x: 8 * (i - 20), y: 278, w: 8, h: 16 })))));
  const root = el(doc, 'div', { class: 'axylo' }, {}, { x: 0, y: 0, w: 400, h: 300 }, fig);
  el(doc, 'body', {}, {}, { x: 0, y: 0, w: 900, h: 700 }, root);
  register(Object.freeze({ table: null, figure: fig as never, plot: plot as never }), fig as never);
  return { root, fig, plot };
}

describe('N7b exportSvg on a registered figure: scope, clipping, references and background', () => {
  it('composes only the registered plot and the chrome, without .axylo-svg, and leaves out hidden and non-chrome parts', () => {
    const doc = new FakeDocument();
    const { root } = family(doc);
    const svg = exportSvg(root as unknown as HTMLElement);
    const texts = textsOf(svg).map(t => t.text);
    expect(texts).toEqual(['Per hour', 'Inside', 'Across', '0', 'Low', 'Some labels hidden.', 'See the table.']);
    for (const absent of ['Hidden title', 'Not chrome', 'Outside', 'High', 'alert', 'embedded', 'script', 'foreignObject', 'onclick']) expect(svg, absent).not.toContain(absent);
    // The colour bar (a family's own chrome) is composed as an SVG at its box.
    expect(svg).toMatch(/<svg viewBox="0 0 200 8"[^>]*x="0" y="244" width="200" height="8"/);
    // The accessible name stays as metadata although the title is not shown.
    expect(svg).toContain('<title>Heat</title>');
    // Letter spacing is kept on the label it belongs to.
    expect(textsOf(svg)[0]!.attrs).toContain('letter-spacing="0.5px"');
  });

  it('clips what the page clips: a label across the plot edge gets a clip path, one outside is left out, and the box does not grow', () => {
    const doc = new FakeDocument();
    const svg = exportSvg(family(doc).root as unknown as HTMLElement);
    // The figure's own box: nothing clipped grows it (Outside at x 500, High at y 270..290 in a rail ending at 264).
    expect(svg).toMatch(/width="400" height="300" viewBox="0 0 400 300"/);
    const across = /<clipPath id="([^"]+)"><rect x="380" y="100" width="20" height="16"\/><\/clipPath><g clip-path="url\(#\1\)"><text[^>]*>Across<\/text><\/g>/;
    expect(svg).toMatch(across);
    // The surface fits its plot: no clip path of its own.
    expect(svg).not.toMatch(/<g clip-path="url\(#[^"]+\)"><svg viewBox="0 0 400 200"/);
  });

  it('makes same-document references local, drops foreign ones and external links, and keeps transforms', () => {
    const doc = new FakeDocument();
    const svg = exportSvg(family(doc).root as unknown as HTMLElement);
    const cell = /<rect class="cell"[^>]*>/.exec(svg)![0];
    expect(cell).toContain('fill="url(#hatch)"');
    expect(cell).not.toContain('stroke=');
    expect(cell).toContain('transform="matrix(1, 0, 0, 1, 5, 6)"');
    expect(svg).not.toContain('other.test');
    expect(svg).toContain('<use href="#hatch"');
    expect(svg).toContain('<pattern id="hatch"');
  });

  it('keeps the renderer background by default and lets an explicit or transparent background replace it in the plot too', () => {
    const doc = new FakeDocument();
    const { root } = family(doc);
    expect(exportSvg(root as unknown as HTMLElement)).toContain('class="axylo-background"');
    for (const background of ['#123456', 'transparent']) {
      const svg = exportSvg(root as unknown as HTMLElement, { background });
      expect(svg, background).not.toContain('axylo-background');
      expect(svg.includes('<rect width="100%" height="100%" fill="#123456"/>'), background).toBe(background === '#123456');
    }
  });

  it('plotOnly omits the caption, the legend, the colour bar and the note', () => {
    const doc = new FakeDocument();
    const svg = exportSvg(family(doc).root as unknown as HTMLElement, { plotOnly: true });
    expect(textsOf(svg).map(t => t.text)).toEqual(['Inside', 'Across']);
    expect(svg).not.toContain('viewBox="0 0 200 8"');
    expect(svg).toMatch(/width="400" height="200" viewBox="0 0 400 200"/);
  });

  it('splits wrapped text by line even when the line boxes overlap (tight line height)', () => {
    const doc = new FakeDocument();
    const text = 'Some labels hidden. See the table.';
    // Second line starts 12px lower, inside the first line's 16px box.
    const chars = [...text].map((_, i) => (i < 20 ? { x: 8 * i, y: 266, w: 8, h: 16 } : { x: 8 * (i - 20), y: 278, w: 8, h: 16 }));
    const svg = exportSvg(family(doc, { noteChars: chars }).root as unknown as HTMLElement);
    const lines = textsOf(svg).filter(t => t.y > 266);
    expect(lines.map(t => t.text)).toEqual(['Some labels hidden.', 'See the table.']);
    expect(lines.map(t => t.y)).toEqual([274, 286]);
  });
});
