import fc from 'fast-check';
import { expect, it } from 'vitest';
import type { Mark, PaintBindings, PlacedText, RectMark, ResolvedTheme, RuleMark } from '../../src/core/contracts';
import { createSvgRenderer } from '../../src/render/svg';
import { createTextLayer } from '../../src/render/text';
import { TOKEN_BINDINGS } from '../../src/theme';

class TestDocument {
  writes = 0;
  created = 0;
  readonly document = this as unknown as Document;

  createElement(tag: string): TestElement {
    this.created++;
    return new TestElement(this, tag);
  }

  createElementNS(_namespace: string, tag: string): TestElement { return this.createElement(tag); }
  createDocumentFragment(): TestElement { return this.createElement('#fragment'); }
}

class TestElement {
  readonly children: TestElement[] = [];
  readonly attributes = new Map<string, string>();
  parent: TestElement | null = null;
  className = '';
  private text = '';
  private readonly declarations = new Map<string, string>();
  readonly style = {
    setProperty: (name: string, value: string) => { this.doc.writes++; this.declarations.set(name, value); },
    removeProperty: (name: string) => { this.doc.writes++; this.declarations.delete(name); },
    getPropertyValue: (name: string) => this.declarations.get(name) ?? '',
    set textAlign(value: string) { this.setProperty('text-align', value); },
    set transform(value: string) { this.setProperty('transform', value); },
  };

  constructor(private readonly doc: TestDocument, readonly tag: string) {}

  get textContent(): string { return this.text; }
  set textContent(value: string) { this.doc.writes++; this.text = value; }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.doc.writes++; this.attributes.set(name, value); }
  removeAttribute(name: string): void { this.doc.writes++; this.attributes.delete(name); }

  appendChild(child: TestElement): void {
    if (child.tag === '#fragment') {
      while (child.children.length > 0) this.appendChild(child.children[0]!);
      return;
    }
    child.remove();
    child.parent = this;
    this.children.push(child);
    this.doc.writes++;
  }

  append(...children: TestElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  replaceChild(child: TestElement, old: TestElement): void {
    this.children[this.children.indexOf(old)] = child;
    old.parent = null;
    child.parent = this;
    this.doc.writes++;
  }

  remove(): void {
    if (this.parent === null) return;
    const siblings = this.parent.children;
    siblings.splice(siblings.indexOf(this), 1);
    this.parent = null;
    this.doc.writes++;
  }
}

const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series: ['var(--axylo-series-color-1)'] };
const theme: ResolvedTheme = { scheme: 'light', forcedColors: false, moreContrast: false, paints: bindings };
const clip = { x: 10, y: 10, width: 80, height: 80 };

function svgFixture() {
  const dom = new TestDocument();
  const renderer = createSvgRenderer(dom.document);
  const root = renderer.element as unknown as TestElement;
  const group = root.children.find(child => child.getAttribute('class') === 'axylo-scene')!;
  const draw = (marks: readonly Mark[], dpr = 1.25) =>
    renderer.draw({ width: 100, height: 100, clip, marks }, bindings, theme, dpr);
  return { dom, draw, group, root };
}

const horizontal: RuleMark = {
  type: 'rule', role: 'grid', stroke: { kind: 'token', name: 'grid' }, strokeWidth: 1,
  x1: 10.2, y1: 11.7, x2: 40.3, y2: 11.7, dash: [4, 3],
};
const vertical: RuleMark = { ...horizontal, x1: 5.4, y1: 2.3, x2: 5.4, y2: 19.7, dash: [4, 3] };
const asAxis = (mark: RuleMark): RuleMark => ({ ...mark, role: 'axis', stroke: { kind: 'token', name: 'axis' } });
const asTick = (mark: RuleMark): RuleMark => ({ ...asAxis(mark), role: 'tick', dash: null });

it('batches clipped grid and unclipped tick runs around individual axis baselines', () => {
  const { dom, draw, group, root } = svgFixture();
  const marks = [horizontal, vertical, asAxis(horizontal), asAxis(vertical), asTick(horizontal), asTick(vertical)];
  draw(marks);

  expect(group.children.map(child => child.tag)).toEqual(['path', 'line', 'line', 'path']);
  const [grid, xAxis, yAxis, ticks] = group.children;
  const clipId = root.children[0]!.children[0]!.getAttribute('id');
  expect(grid!.getAttribute('clip-path')).toBe(`url(#${clipId})`);
  expect(grid!.getAttribute('stroke-width')).toBe('0.8');
  expect(grid!.getAttribute('stroke-linecap')).toBe('butt');
  expect(grid!.getAttribute('stroke-dasharray')).toBe('4 3');
  expect(grid!.style.getPropertyValue('color')).toBe(bindings.tokens.grid);
  expect(grid!.style.getPropertyValue('fill')).toBe('none');
  expect(grid!.style.getPropertyValue('stroke')).toBe('currentColor');
  expect(xAxis!.getAttribute('x1')).toBe('10.4');
  expect(yAxis!.getAttribute('x1')).toBe('5.2');
  for (const edge of [xAxis!, yAxis!, ticks!]) {
    expect(edge.getAttribute('clip-path')).toBeNull();
    expect(edge.style.getPropertyValue('color')).toBe(bindings.tokens.axis);
  }
  expect(ticks!.getAttribute('stroke-dasharray')).toBeNull();
  // At 1.25 DPR a stroke one device pixel wide is centered on a half-device-pixel.
  for (const path of [grid!, ticks!]) expect(path.getAttribute('d')).toBe('M10.4 11.6H40M5.2 2.4V20');

  dom.writes = dom.created = 0;
  draw(marks.map(mark => ({ ...mark, dash: mark.dash?.slice() ?? null })));
  expect(group.children[0]).toBe(grid);
  expect(group.children[3]).toBe(ticks);
  expect(dom.writes).toBe(0);
  expect(dom.created).toBe(0);
});

it.each([
  ['paint', { ...vertical, stroke: { kind: 'token', name: 'axis' } }],
  ['width', { ...vertical, strokeWidth: 2 }],
  ['dash', { ...vertical, dash: [4, 2] }],
  ['role', asTick(vertical)],
  ['mark kind', { type: 'band', box: clip, fill: { kind: 'none' }, opacity: 0 }],
] satisfies [string, Mark][])('ends a grid run at a different %s and keeps isolated rules as lines', (_, separator) => {
  const { draw, group } = svgFixture();
  draw([horizontal, vertical, separator, horizontal]);
  expect(group.children.map(child => child.tag)).toEqual(['path', separator.type === 'band' ? 'rect' : 'line', 'line']);
  draw([horizontal]);
  expect(group.children.map(child => child.tag)).toEqual(['line']);
  draw([horizontal, vertical]);
  expect(group.children.map(child => child.tag)).toEqual(['path']);
});

it('uses L for diagonal segments and keeps device-snapped widths distinct', () => {
  const { draw, group } = svgFixture();
  const diagonal = { ...horizontal, x1: 0, y1: 0, x2: 6.5, y2: 7 };
  const diagonal2 = { ...diagonal, x1: 2 };
  draw([diagonal, vertical], 1);
  expect(group.children[0]!.getAttribute('d')).toBe('M0 0L6.5 7M5.5 2V20');

  draw([diagonal, diagonal2, vertical]);
  expect(group.children.map(child => child.tag)).toEqual(['path', 'line']);
  const d = group.children[0]!.getAttribute('d')!;
  expect(d).toMatch(/^M0 0L6\.5 7M2 0L6\.5 7/);
  // The benchmark excludes paths containing commands outside its M/L grammar.
  expect(d).toMatch(/[^ML0-9.,\s+\-e]/);
  expect(group.children[0]!.getAttribute('stroke-width')).toBe('1');
  expect(group.children[1]!.getAttribute('stroke-width')).toBe('0.8');
});

it('preserves the order and endpoints of consecutive horizontal rules', () => {
  const { draw, group } = svgFixture();
  fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 2, maxLength: 20 }), rows => {
    draw(rows.map(y => ({ ...horizontal, x1: 0, x2: 80, y1: y, y2: y })), 2);
    expect(group.children).toHaveLength(1);
    expect(group.children[0]!.getAttribute('d')).toBe(rows.map(y => `M0 ${y}H80`).join(''));
  }));
});

it('reuses direct bar rects as geometry, pattern and count change', () => {
  const { dom, draw, group } = svgFixture();
  const bars: RectMark = {
    type: 'rects', series: 0, fill: { kind: 'series', index: 0 }, variant: 'bar', pattern: 'diagonal',
    xywh: Float32Array.of(30.125, 60, -5, -40, 46, NaN, 5, 12),
  };
  draw([bars]);
  const barGroup = group.children[0]!;
  const [first, second, overlay, secondOverlay] = barGroup.children;
  const attrs = (rect: TestElement) => ['x', 'y', 'width', 'height'].map(name => rect.getAttribute(name));
  expect(barGroup.tag).toBe('g');
  expect(barGroup.children.map(child => child.tag)).toEqual(['rect', 'rect', 'rect', 'rect']);
  expect(attrs(first!)).toEqual(['25.13', '20', '5', '40']);
  expect(attrs(second!)).toEqual(['0', '0', '0', '0']);
  expect(attrs(overlay!)).toEqual(attrs(first!));
  expect(attrs(secondOverlay!)).toEqual(attrs(second!));
  expect(first!.style.getPropertyValue('fill')).toBe('');
  const pattern = overlay!.style.getPropertyValue('fill');
  expect(pattern).toMatch(/^url\(#axylo-pattern-\d+\)$/);
  expect(overlay!.style.getPropertyValue('color')).toBe(bindings.series[0]);

  dom.writes = dom.created = 0;
  draw([bars]);
  draw([{ ...bars, xywh: bars.xywh.slice() }]);
  expect(dom.writes).toBe(0);
  expect(dom.created).toBe(0);

  draw([{ ...bars, pattern: 'none', xywh: Float32Array.of(15, 20, 2, 30, 25, 20, 2, 25, 35, 20, 2, 20) }]);
  expect(group.children[0]).toBe(barGroup);
  expect(barGroup.children[2]).toBe(overlay);
  expect(attrs(overlay!)).toEqual(['35', '20', '2', '20']);
  expect(overlay!.style.getPropertyValue('fill')).toBe('');
  expect(overlay!.style.getPropertyValue('color')).toBe('');
  expect(secondOverlay!.parent).toBeNull();
  draw([bars]);
  expect(barGroup.children[2]).toBe(overlay);
  expect(overlay!.style.getPropertyValue('fill')).toBe(pattern);
  expect(attrs(overlay!)).toEqual(attrs(first!));
});

it('keeps the first label div through line count changes and skips equivalent redraws', () => {
  const dom = new TestDocument();
  const layer = createTextLayer(dom.document);
  const text: PlacedText = {
    lines: ['<first>'], full: '<first>', x: 2, y: 5, anchor: 'end', baseline: 'middle', rotate: -45,
    role: 'tick-x', box: clip,
  };
  layer.render([text]);
  const root = layer.element as unknown as TestElement;
  const label = root.children[0]!;
  const first = label.children[0]!;
  expect(label.className).toBe('axylo-label');
  expect(label.getAttribute('data-role')).toBe('tick-x');
  expect(first.tag).toBe('div');
  expect(first.textContent).toBe('<first>');
  expect(first.style.getPropertyValue('min-height')).toBe('1lh');
  expect(label.style.getPropertyValue('transform')).toBe('translate(2px,5px) rotate(-45deg) translate(-100%,-50%)');

  dom.writes = dom.created = 0;
  layer.render([{ ...text, lines: ['<first>'], x: 2.001 }]);
  expect(dom.writes).toBe(0);
  expect(dom.created).toBe(0);

  const wrapped = { ...text, lines: ['new first', '', 'third'] };
  layer.render([wrapped]);
  const [, blank, third] = label.children;
  expect(label.children[0]).toBe(first);
  expect(label.children.map(line => line.textContent)).toEqual(['new first', '', 'third']);
  expect(blank!.style.getPropertyValue('min-height')).toBe('1lh');
  dom.writes = dom.created = 0;
  layer.render([{ ...wrapped, lines: ['new first', '', 'third'] }]);
  expect(dom.writes).toBe(0);
  expect(dom.created).toBe(0);

  layer.render([text]);
  expect(label.children).toHaveLength(1);
  expect(label.children[0]).toBe(first);
  expect(first.textContent).toBe('<first>');
  expect(blank!.parent).toBeNull();
  expect(third!.parent).toBeNull();
  layer.render([{ ...text, lines: [] }]);
  expect(label.children).toHaveLength(0);
  layer.render([{ ...text, lines: [''] }]);
  expect(label.children).toHaveLength(1);
  expect(label.children[0]!.textContent).toBe('');
});
