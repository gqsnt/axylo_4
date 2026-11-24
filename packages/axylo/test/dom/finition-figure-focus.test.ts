/**
 * Regression tests for Milestone M1C:
 * - dom/figure.ts: noteSegments deep equality in same(), and announce() re-announcement without dropping identical text
 * - core/focus.ts: datumReading includes messages.position template (not live ordinal/count)
 */
import { describe, expect, it } from 'vitest';
import { createFigure, type FigureModel } from '../../src/dom/figure';
import { datumReading, valueText } from '../../src/core/focus';
import type { DatumRef } from '../../src/core/contracts';
import { defaultMessages } from '../../src/messages';
import { record } from '../core/host';

interface FakeNode {
  readonly nodeType: number;
  readonly ownerDocument: FakeDoc;
  parentNode: FakeElement | null;
  textContent: string;
}

class FakeText implements FakeNode {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;
  constructor(readonly ownerDocument: FakeDoc, public textContent: string) {}
}

class FakeClassList {
  private readonly set = new Set<string>();
  constructor(private readonly sync: (value: string) => void) {}
  setFromString(value: string): void {
    this.set.clear();
    for (const part of value.split(/\s+/)) if (part) this.set.add(part);
  }
  get length(): number { return this.set.size; }
  contains(token: string): boolean { return this.set.has(token); }
  add(...tokens: string[]): void { for (const t of tokens) for (const p of t.split(/\s+/)) if (p) this.set.add(p); this.flush(); }
  remove(...tokens: string[]): void { for (const t of tokens) this.set.delete(t); this.flush(); }
  toggle(token: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(token);
    if (on) this.set.add(token); else this.set.delete(token);
    this.flush();
    return on;
  }
  private flush(): void { this.sync([...this.set].join(' ')); }
}

class FakeElement implements FakeNode {
  readonly nodeType = 1;
  readonly tagName: string;
  parentNode: FakeElement | null = null;
  readonly childNodes: FakeNode[] = [];
  readonly attrs = new Map<string, string>();
  hidden = false;
  replaceChildrenCount = 0;
  readonly classList: FakeClassList;

  constructor(readonly ownerDocument: FakeDoc, tag: string) {
    this.tagName = tag.toUpperCase();
    this.classList = new FakeClassList(v => {
      if (v) this.attrs.set('class', v);
      else this.attrs.delete('class');
    });
  }

  get id(): string { return this.attrs.get('id') ?? ''; }
  set id(v: string) { this.attrs.set('id', v); }
  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); this.classList.setFromString(v); }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get firstElementChild(): FakeElement | null { return (this.childNodes.find(n => n.nodeType === 1) as FakeElement | undefined) ?? null; }
  get children(): FakeElement[] { return this.childNodes.filter(n => n.nodeType === 1) as FakeElement[]; }

  get textContent(): string {
    return this.childNodes.map(n => n.textContent).join('');
  }
  set textContent(v: string) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    if (v !== '') this.appendChild(new FakeText(this.ownerDocument, v));
  }

  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
    if (name === 'class') this.classList.setFromString(String(value));
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'class') this.classList.setFromString('');
  }

  appendChild<T extends FakeNode>(node: T): T {
    if (node.parentNode) {
      const i = node.parentNode.childNodes.indexOf(node);
      if (i >= 0) node.parentNode.childNodes.splice(i, 1);
    }
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  append(...nodes: (FakeNode | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new FakeText(this.ownerDocument, n) : n);
  }

  replaceChildren(...nodes: (FakeNode | string)[]): void {
    this.replaceChildrenCount++;
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }

  findByClass(cls: string): FakeElement | null {
    if (this.classList.contains(cls)) return this;
    for (const c of this.children) {
      const hit = c.findByClass(cls);
      if (hit) return hit;
    }
    return null;
  }
}

class FakeDoc {
  createElement(tag: string): FakeElement { return new FakeElement(this, tag); }
  createTextNode(text: string): FakeText { return new FakeText(this, text); }
}

function baseModel(overrides: Partial<FigureModel> = {}): FigureModel {
  return {
    compact: false,
    title: { text: 'Revenue', level: 2, visible: true },
    labelledBy: null,
    name: 'Revenue',
    subtitle: null,
    summary: 'Line chart of revenue.',
    summaryVisible: false,
    note: '2 values omitted.',
    noteLang: null,
    noteSegments: [{ text: '2 values omitted.', lang: 'en' }],
    message: null,
    messageLang: null,
    summaryLang: null,
    ...overrides,
  };
}

describe('dom/figure.ts: noteSegments equality and live announcements', () => {
  it('updates the note DOM when noteSegments lang or runs change without changing note text', () => {
    const doc = new FakeDoc();
    const root = doc.createElement('div');
    const fig = createFigure(root as unknown as HTMLElement, 'c1', {
      marks: doc.createElement('svg') as unknown as Element,
      text: doc.createElement('div') as unknown as Element,
    });
    const noteEl = (fig.figure as unknown as FakeElement).findByClass('axylo-note')!;

    fig.update(baseModel({
      note: 'A: 2 omitted.',
      noteSegments: [{ text: 'A: ', lang: null }, { text: '2 omitted.', lang: 'en' }],
    }));
    expect(noteEl.children).toHaveLength(2);
    expect(noteEl.children[0]!.getAttribute('lang')).toBeNull();
    expect(noteEl.children[1]!.getAttribute('lang')).toBe('en');

    // Change only segment lang while keeping note string identical.
    fig.update(baseModel({
      note: 'A: 2 omitted.',
      noteSegments: [{ text: 'A: ', lang: 'de' }, { text: '2 omitted.', lang: 'fr' }],
    }));
    expect(noteEl.children).toHaveLength(2);
    expect(noteEl.children[0]!.getAttribute('lang')).toBe('de');
    expect(noteEl.children[1]!.getAttribute('lang')).toBe('fr');

    // Change from multi-run to single-run with same note text.
    fig.update(baseModel({
      note: 'A: 2 omitted.',
      noteSegments: [{ text: 'A: 2 omitted.', lang: 'en' }],
    }));
    expect(noteEl.children).toHaveLength(0);
    expect(noteEl.textContent).toBe('A: 2 omitted.');
    expect(noteEl.getAttribute('lang')).toBe('en');

    // Change single-run lang from 'en' to null with same note text.
    fig.update(baseModel({
      note: 'A: 2 omitted.',
      noteSegments: [{ text: 'A: 2 omitted.', lang: null }],
    }));
    expect(noteEl.getAttribute('lang')).toBeNull();

    // Deep-equal noteSegments does not re-render.
    const before = noteEl.replaceChildrenCount;
    expect(fig.update(baseModel({
      note: 'A: 2 omitted.',
      noteSegments: [{ text: 'A: 2 omitted.', lang: null }],
    }))).toBe(false);
    expect(noteEl.replaceChildrenCount).toBe(before);

    fig.destroy();
  });

  it('announce() replaces the text node on identical re-announcement without toggling aria-live', () => {
    const doc = new FakeDoc();
    const root = doc.createElement('div');
    const fig = createFigure(root as unknown as HTMLElement, 'c2', {
      marks: doc.createElement('svg') as unknown as Element,
      text: doc.createElement('div') as unknown as Element,
    });
    const live = (fig.figure as unknown as FakeElement).findByClass('axylo-live')!;
    expect(live.getAttribute('aria-live')).toBe('polite');

    fig.announce('Loading chart.', 'en');
    const firstNode = live.firstChild;
    expect(firstNode).not.toBeNull();
    expect(live.textContent).toBe('Loading chart.');
    expect(live.getAttribute('lang')).toBe('en');
    expect(live.getAttribute('aria-live')).toBe('polite');

    // Identical text re-announced must replace the child text node so AT observes it.
    fig.announce('Loading chart.', 'en');
    const secondNode = live.firstChild;
    expect(secondNode).not.toBe(firstNode);
    expect(live.textContent).toBe('Loading chart.');
    expect(live.getAttribute('aria-live')).toBe('polite');

    // Empty string re-announced while already empty is a no-op.
    fig.announce('');
    const countBeforeEmpty = live.replaceChildrenCount;
    fig.announce('');
    expect(live.replaceChildrenCount).toBe(countBeforeEmpty);
    expect(live.textContent).toBe('');

    fig.destroy();
  });
});

describe('core/focus.ts: datumReading includes messages.position template', () => {
  it('updates reading key when messages.position template changes, while staying quiet on streaming appends', () => {
    const r = record('line', {
      title: 'Sessions',
      data: [{ x: 0, y: 10 }, { x: 1, y: 20 }],
      x: 'x',
      y: 'y',
    });
    r.frames();
    const first = r.committed!;
    const seriesKey = first.view.kind === 'line' ? first.view.frame.series[0]!.key : '';
    const ref: DatumRef = { kind: 'aligned', seriesKey, x: 0 };

    const enReadingAll = datumReading(first.view, first.lookup, ref, 'all', first.formatters, defaultMessages);
    const enReadingSingle = datumReading(first.view, first.lookup, ref, 'single', first.formatters, defaultMessages);

    // Changing messages.position template invalidates the reading key immediately.
    const deMessages = { ...defaultMessages, position: 'Punkt {index} von {count}' };
    const deReadingAll = datumReading(first.view, first.lookup, ref, 'all', first.formatters, deMessages);
    const deReadingSingle = datumReading(first.view, first.lookup, ref, 'single', first.formatters, deMessages);
    expect(deReadingAll).not.toBe(enReadingAll);
    expect(deReadingSingle).not.toBe(enReadingSingle);
    expect(valueText(first.view, first.lookup, ref, 'all', first.formatters, deMessages)).toContain('Punkt 1 von 2');

    // Streaming append changes the live count (2 -> 3) without changing messages.position: reading stays identical.
    r.controller.handle.append([{ x: 2, y: 30 }]);
    r.frames();
    const after = r.committed!;
    expect(datumReading(after.view, after.lookup, ref, 'all', after.formatters, deMessages)).toBe(deReadingAll);
    expect(datumReading(after.view, after.lookup, ref, 'single', after.formatters, deMessages)).toBe(deReadingSingle);
  });
});
