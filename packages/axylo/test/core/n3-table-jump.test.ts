/**
 * Cycle N3, F-A11Y-4 remainder (spec A4, A7): the table's polite announcement. A valid jump the reader submits
 * is confirmed once per submission, also when it lands on the page already shown (the words repeat); paging
 * past either end and a passive refresh (data arriving) say nothing. Driven in Node on a minimal DOM.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createTableView, type TableTexts } from '../../src/dom/table';
import type { TableModel, XValue } from '../../src/core/contracts';

// ── A DOM just large enough for dom/table.ts ─────────────────────────────────────────────────────────

class FakeText {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;
  constructor(public textContent: string) {}
  get nextSibling(): FakeNode | null { return siblingOf(this); }
}

type FakeNode = FakeElement | FakeText;

function siblingOf(n: FakeNode): FakeNode | null {
  const list = n.parentNode?.childNodes;
  if (!list) return null;
  return list[list.indexOf(n) + 1] ?? null;
}

class FakeElement {
  readonly nodeType = 1;
  readonly childNodes: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, ((e: unknown) => void)[]>();
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  parentNode: FakeElement | null = null;
  className = '';
  hidden = false;
  tabIndex = -1;
  type = '';
  value = '';
  htmlFor = '';
  autocomplete = '';
  scope = '';
  scrollTop = 0;
  lang = '';
  /** Every write that replaces this element's own children: what a live region speaks on. */
  writes = 0;
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get id(): string { return this.attributes.get('id') ?? ''; }
  set id(v: string) { this.attributes.set('id', v); }
  get children(): FakeElement[] { return this.childNodes.filter((n): n is FakeElement => n.nodeType === 1); }
  get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
  get firstElementChild(): FakeElement | null { return this.children[0] ?? null; }
  get lastElementChild(): FakeElement | null { return this.children.at(-1) ?? null; }
  get nextSibling(): FakeNode | null { return siblingOf(this); }
  get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v: string) { this.clearChildren(); if (v !== '') this.adoptChild(new FakeText(v)); this.writes++; }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, v: string): void { this.attributes.set(name, String(v)); }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }
  getRootNode(): FakeDocument { return this.ownerDocument; }
  append(...nodes: (FakeNode | string)[]): void { for (const n of nodes) this.adoptChild(typeof n === 'string' ? new FakeText(n) : n); }
  appendChild<T extends FakeNode>(n: T): T { this.adoptChild(n); return n; }
  insertBefore<T extends FakeNode>(n: T, ref: FakeNode | null): T {
    n.parentNode?.detachChild(n);
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at < 0) this.childNodes.push(n); else this.childNodes.splice(at, 0, n);
    n.parentNode = this;
    return n;
  }
  replaceChildren(...nodes: FakeNode[]): void { this.clearChildren(); for (const n of nodes) this.adoptChild(n); this.writes++; }
  remove(): void { this.parentNode?.detachChild(this); }
  contains(n: unknown): boolean {
    for (let a = n as FakeNode | null; a; a = a.parentNode) if (a === this) return true;
    return false;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: (e: unknown) => void): void { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)); }
  dispatch(type: string): void { for (const fn of this.listeners.get(type) ?? []) fn({ type, preventDefault() {} }); }
  focus(): void { this.ownerDocument.activeElement = this; }
  adoptChild(n: FakeNode): void { n.parentNode?.detachChild(n); this.childNodes.push(n); n.parentNode = this; }
  detachChild(n: FakeNode): void { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; }
  clearChildren(): void { for (const n of this.childNodes) n.parentNode = null; this.childNodes.length = 0; }
}

class FakeDocument {
  activeElement: FakeElement | null = null;
  createElement(tag: string): FakeElement { return new FakeElement(tag.toUpperCase(), this); }
  createTextNode(text: string): FakeText { return new FakeText(text); }
}

// ── The table under test ─────────────────────────────────────────────────────────────────────────────

const texts: TableTexts = {
  previousPage: 'Previous page', nextPage: 'Next page', jump: 'Jump to x',
  pageOf: (page, count) => `Page ${page} of ${count}`,
  notFound: text => `No row at ${text}`, lang: () => null,
};

/** `rows` rows with x = 0, 1, …, 100 per page (spec A4). */
function model(rows: number): TableModel {
  return {
    caption: 'Rows', headers: ['x', 'y'], rowCount: rows, pageSize: 100,
    row: i => (i >= 0 && i < rows ? [String(i), String(i * 10)] : null),
    pageForX: x => (typeof x === 'number' && x >= 0 && x < rows ? Math.floor(x / 100) : null),
  };
}

function open(rows: number) {
  const doc = new FakeDocument();
  const toValue = (text: string): XValue | null => (text.trim() === '' || !Number.isFinite(Number(text)) ? null : Number(text));
  const view = createTableView(doc as unknown as Document, 'c1', toValue);
  view.update(model(rows), texts, 300);
  const el = view.element as unknown as FakeElement;
  const find = (pred: (e: FakeElement) => boolean): FakeElement => {
    const stack = [el];
    while (stack.length) { const e = stack.pop()!; if (pred(e)) return e; stack.push(...e.children); }
    throw new Error('not found');
  };
  const live = find(e => e.getAttribute('aria-live') === 'polite');
  const status = find(e => e.className === 'axylo-page');
  const field = find(e => e.className === 'axylo-jump-field');
  const form = find(e => e.className === 'axylo-jump');
  const [previous, next] = find(e => e.className === 'axylo-pager').children.filter(e => e.tagName === 'BUTTON');
  const spoken: string[] = [];
  let seen = live.writes;
  const heard = () => { if (live.writes !== seen) { seen = live.writes; spoken.push(live.textContent); } return [...spoken]; };
  const jump = (text: string) => { field.value = text; form.dispatch('submit'); return heard(); };
  const click = (b: FakeElement) => { b.dispatch('click'); return heard(); };
  return { view, live, status, field, previous: previous!, next: next!, jump, click, heard, refresh: (n: number) => { view.update(model(n), texts, 300); return heard(); } };
}

describe('F-A11Y-4: the page announcement of View as table (spec A4, A7)', () => {
  it('a valid jump to the page already shown is confirmed once per submission, even with the same words', () => {
    const t = open(250);
    expect(t.status.textContent).toBe('Page 1 of 3');
    expect(t.jump('5')).toEqual(['Page 1 of 3']);
    expect(t.jump('99')).toEqual(['Page 1 of 3', 'Page 1 of 3']);
    expect(t.jump('150')).toEqual(['Page 1 of 3', 'Page 1 of 3', 'Page 2 of 3']);
    expect(t.jump('199')).toEqual(['Page 1 of 3', 'Page 1 of 3', 'Page 2 of 3', 'Page 2 of 3']);
    expect(t.status.textContent).toBe('Page 2 of 3');
    expect(t.field.getAttribute('aria-invalid')).toBeNull();
  });

  it('an x with no row is an error, not an announcement', () => {
    const t = open(250);
    expect(t.jump('9999')).toEqual([]);
    expect(t.jump('')).toEqual([]);
    expect(t.field.getAttribute('aria-invalid')).toBe('true');
  });

  it('paging past either end says nothing; paging within speaks the new page once', () => {
    const t = open(250);
    expect(t.click(t.previous)).toEqual([]);
    expect(t.click(t.next)).toEqual(['Page 2 of 3']);
    expect(t.click(t.next)).toEqual(['Page 2 of 3', 'Page 3 of 3']);
    expect(t.click(t.next)).toEqual(['Page 2 of 3', 'Page 3 of 3']);
    expect(t.next.getAttribute('aria-disabled')).toBe('true');
  });

  it('a passive refresh never speaks, also when the page count it shows changes', () => {
    const t = open(250);
    t.jump('150');
    const before = t.heard();
    expect(t.refresh(260)).toEqual(before);
    expect(t.refresh(320)).toEqual(before);
    expect(t.status.textContent).toBe('Page 2 of 4');
    expect(t.refresh(90)).toEqual(before);
    expect(t.status.textContent).toBe('Page 1 of 1');
  });

  it('for any table and any sequence of jumps and refreshes: one announcement per valid jump, of the page it lands on, and none otherwise', () => {
    const action = fc.oneof(
      fc.record({ kind: fc.constant('jump' as const), x: fc.integer({ min: -50, max: 1200 }) }),
      fc.record({ kind: fc.constant('refresh' as const), rows: fc.integer({ min: 1, max: 1000 }) }),
    );
    fc.assert(fc.property(fc.integer({ min: 1, max: 1000 }), fc.array(action, { maxLength: 20 }), (rows0, actions) => {
      const t = open(rows0);
      let rows = rows0, expected = 0;
      for (const a of actions) {
        if (a.kind === 'refresh') { rows = a.rows; t.refresh(rows); continue; }
        const heard = t.jump(String(a.x));
        if (a.x >= 0 && a.x < rows) {
          expected++;
          const page = Math.floor(a.x / 100) + 1, count = Math.max(1, Math.ceil(rows / 100));
          expect(heard.at(-1)).toBe(`Page ${page} of ${count}`);
        }
        expect(heard).toHaveLength(expected);
      }
    }), { numRuns: 200 });
  });
});
