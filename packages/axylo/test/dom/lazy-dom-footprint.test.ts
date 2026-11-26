/**
 * Unit tests for Stage 3 lazy DOM footprint, ResizeObserver count, and compact-chart closure reductions
 * across dom/figure.ts, dom/interaction.ts, and core/chart.ts.
 */
import { describe, expect, it } from 'vitest';
import { createFigure, type FigureModel } from '../../src/dom/figure';
import { createInteraction, type Actions, type Committed, type InteractionParts } from '../../src/dom/interaction';
import { lineSwatch } from '../../src/dom/swatch';
import { alignedTargetMarks } from '../../src/core/focus';
import { createChart } from '../../src/core/chart';
import { LINE } from '../../src/kinds/line';
import { DONUT } from '../../src/kinds/donut';
import type { MarkRenderer, PaintBindings, ResolvedTheme } from '../../src/core/contracts';
import { defaultMessages } from '../../src/messages';
import { record } from '../core/host';

// ── Minimal self-contained DOM + Window mock for Node unit tests ─────────────────────────────────────────

interface Listener {
  type: string;
  fn: EventListener;
  capture: boolean;
}

class TestEventTarget {
  readonly _listeners: Listener[] = [];
  addEventListener(type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const signal = typeof opts === 'object' ? opts?.signal : undefined;
    if (signal?.aborted) return;
    const handler: EventListener = typeof fn === 'function' ? fn : e => fn.handleEvent(e);
    const entry: Listener = { type, fn: handler, capture };
    this._listeners.push(entry);
    signal?.addEventListener('abort', () => {
      const i = this._listeners.indexOf(entry);
      if (i >= 0) this._listeners.splice(i, 1);
    }, { once: true });
  }
  removeEventListener(type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const i = this._listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this._listeners.splice(i, 1);
  }
}

class TestEvent {
  readonly type: string;
  readonly bubbles: boolean;
  target: unknown = null;
  currentTarget: unknown = null;
  defaultPrevented = false;
  _stopped = false;
  _immediateStopped = false;
  readonly key: string;
  readonly altKey = false;
  readonly ctrlKey = false;
  readonly metaKey = false;
  readonly shiftKey = false;
  readonly button: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly timeStamp: number;

  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.key = String(init.key ?? '');
    this.button = Number(init.button ?? 0);
    this.pointerId = Number(init.pointerId ?? 1);
    this.pointerType = String(init.pointerType ?? 'mouse');
    this.clientX = Number(init.clientX ?? 0);
    this.clientY = Number(init.clientY ?? 0);
    this.timeStamp = Number(init.timeStamp ?? 100);
  }
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this._stopped = true; }
  stopImmediatePropagation(): void { this._immediateStopped = true; this._stopped = true; }
  composedPath(): unknown[] { return [this.target]; }
}

class TestClassList {
  private readonly set = new Set<string>();
  constructor(private readonly sync: (v: string) => void) {}
  setFrom(v: string): void { this.set.clear(); for (const s of v.split(/\s+/)) if (s) this.set.add(s); }
  get length(): number { return this.set.size; }
  contains(t: string): boolean { return this.set.has(t); }
  add(...tokens: string[]): void { for (const t of tokens) for (const p of t.split(/\s+/)) if (p) this.set.add(p); this.flush(); }
  remove(...tokens: string[]): void { for (const t of tokens) this.set.delete(t); this.flush(); }
  toggle(t: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(t);
    if (on) this.set.add(t); else this.set.delete(t);
    this.flush();
    return on;
  }
  private flush(): void { this.sync([...this.set].join(' ')); }
}

interface TestNode {
  readonly nodeType: number;
  readonly ownerDocument: TestDocument;
  parentNode: TestElement | null;
  textContent: string;
  readonly nextSibling: TestNode | null;
  readonly isConnected: boolean;
  remove(): void;
  getRootNode(): TestNode | TestDocument;
}

class TestText implements TestNode {
  readonly nodeType = 3;
  parentNode: TestElement | null = null;
  constructor(readonly ownerDocument: TestDocument, public textContent: string) {}
  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? this.parentNode.childNodes[i + 1] ?? null : null;
  }
  get isConnected(): boolean { return this.parentNode?.isConnected ?? false; }
  remove(): void {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }
  getRootNode(): TestNode | TestDocument { return this.parentNode ? this.parentNode.getRootNode() : this; }
}

class TestElement extends TestEventTarget implements TestNode {
  readonly nodeType = 1;
  readonly tagName: string;
  parentNode: TestElement | null = null;
  readonly childNodes: TestNode[] = [];
  readonly attrs = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> = {
    cssText: '', visibility: '', width: '', height: '', left: '', top: '', transform: '', maxWidth: '', maxHeight: '',
    setProperty(name: string, value: string) { (this as Record<string, unknown>)[name] = value; },
    removeProperty(name: string) { delete (this as Record<string, unknown>)[name]; },
    getPropertyValue(name: string) { return String((this as Record<string, unknown>)[name] ?? ''); },
  };
  readonly classList: TestClassList;
  hidden = false;
  inert = false;
  tabIndex = -1;
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  scrollWidth = 100;
  scrollHeight = 40;
  clientWidth = 480;
  clientHeight = 300;
  rect = { x: 0, y: 0, left: 0, top: 0, width: 480, height: 300, right: 480, bottom: 300 };

  constructor(readonly ownerDocument: TestDocument, tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    if (this.tagName === 'BUTTON' || this.tagName === 'INPUT') this.tabIndex = 0;
    this.classList = new TestClassList(v => {
      if (v) this.attrs.set('class', v);
      else this.attrs.delete('class');
    });
  }

  get id(): string { return this.attrs.get('id') ?? ''; }
  set id(v: string) { this.attrs.set('id', v); }
  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); this.classList.setFrom(v); }
  get lang(): string { return this.attrs.get('lang') ?? ''; }
  set lang(v: string) { this.attrs.set('lang', v); }
  get parentElement(): TestElement | null { return this.parentNode; }
  get firstChild(): TestNode | null { return this.childNodes[0] ?? null; }
  get firstElementChild(): TestElement | null { return (this.childNodes.find(n => n.nodeType === 1) as TestElement | undefined) ?? null; }
  get lastElementChild(): TestElement | null {
    for (let i = this.childNodes.length - 1; i >= 0; i--) if (this.childNodes[i]!.nodeType === 1) return this.childNodes[i] as TestElement;
    return null;
  }
  get children(): TestElement[] { return this.childNodes.filter(n => n.nodeType === 1) as TestElement[]; }
  get nextSibling(): TestNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? this.parentNode.childNodes[i + 1] ?? null : null;
  }
  get isConnected(): boolean {
    if (this === this.ownerDocument.documentElement || this === this.ownerDocument.body) return true;
    return this.parentNode?.isConnected ?? false;
  }
  getRootNode(): TestNode | TestDocument {
    if (this === this.ownerDocument.documentElement) return this.ownerDocument;
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }
  get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v: string) {
    for (const c of [...this.childNodes]) c.remove();
    if (v !== '') this.appendChild(new TestText(this.ownerDocument, v));
  }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, String(value));
    if (name === 'class') this.classList.setFrom(String(value));
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
    if (name === 'class') this.classList.setFrom('');
  }
  contains(node: unknown): boolean {
    if (node === this) return true;
    let cur = (node as TestNode | null)?.parentNode ?? null;
    while (cur) {
      if (cur === this) return true;
      cur = cur.parentNode;
    }
    return false;
  }
  insertBefore<T extends TestNode>(node: T, ref: TestNode | null): T {
    if (node.parentNode) {
      const old = node.parentNode.childNodes.indexOf(node);
      if (old >= 0) node.parentNode.childNodes.splice(old, 1);
    }
    node.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at >= 0) this.childNodes.splice(at, 0, node);
    else this.childNodes.push(node);
    return node;
  }
  appendChild<T extends TestNode>(node: T): T { return this.insertBefore(node, null); }
  replaceChild<T extends TestNode>(next: TestNode, old: T): T {
    this.insertBefore(next, old);
    old.remove();
    return old;
  }
  append(...nodes: (TestNode | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new TestText(this.ownerDocument, n) : n);
  }
  replaceChildren(...nodes: (TestNode | string)[]): void {
    for (const c of [...this.childNodes]) c.remove();
    this.append(...nodes);
  }
  remove(): void {
    const active = this.ownerDocument.activeElement;
    if (active && this.contains(active)) this.ownerDocument.activeElement = this.ownerDocument.body;
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }
  focus(): void {
    if (this.hidden || !this.isConnected) return;
    this.ownerDocument.activeElement = this;
  }
  getBoundingClientRect() { return { ...this.rect }; }
  getClientRects() { return this.hidden ? [] : [{ ...this.rect }]; }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean { return false; }
  getContext(): null { return null; }
  matches(sel: string): boolean {
    if (sel === ':focus-visible') return false;
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.startsWith('[') && sel.endsWith(']')) return this.hasAttribute(sel.slice(1, -1));
    if (sel.includes('>')) {
      const [p, c] = sel.split('>').map(s => s.trim());
      return Boolean(this.parentElement?.matches(p!) && this.matches(c!));
    }
    const dot = sel.indexOf('.');
    if (dot > 0) return this.tagName === sel.slice(0, dot).toUpperCase() && this.classList.contains(sel.slice(dot + 1));
    return this.tagName === sel.toUpperCase();
  }
  closest(sel: string): TestElement | null {
    let cur: TestElement | null = this;
    while (cur) {
      if (cur.matches(sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }
  querySelectorAll(selector: string): TestElement[] {
    const out: TestElement[] = [];
    const sels = selector.split(',').map(s => s.trim());
    const walk = (el: TestElement) => {
      if (sels.some(s => el.matches(s))) out.push(el);
      for (const c of el.children) walk(c);
    };
    for (const c of this.children) walk(c);
    return out;
  }
  querySelector(selector: string): TestElement | null { return this.querySelectorAll(selector)[0] ?? null; }
  dispatchEvent(event: TestEvent): boolean {
    event.target = this;
    const path: TestEventTarget[] = [];
    let cur: TestEventTarget | null = this;
    while (cur) {
      path.push(cur);
      if (cur instanceof TestElement) cur = cur.parentNode ?? (cur === cur.ownerDocument.documentElement ? cur.ownerDocument : null);
      else if (cur instanceof TestDocument) cur = cur.defaultView;
      else cur = null;
    }
    for (let i = path.length - 1; i >= 1; i--) {
      event.currentTarget = path[i];
      for (const l of [...path[i]!._listeners]) {
        if (l.type === event.type && l.capture) {
          l.fn(event as unknown as Event);
          if (event._immediateStopped) break;
        }
      }
      if (event._stopped) return !event.defaultPrevented;
    }
    event.currentTarget = this;
    for (const l of [...this._listeners]) {
      if (l.type === event.type) {
        l.fn(event as unknown as Event);
        if (event._immediateStopped) break;
      }
    }
    if (event.bubbles && !event._stopped) {
      for (let i = 1; i < path.length; i++) {
        event.currentTarget = path[i];
        for (const l of [...path[i]!._listeners]) {
          if (l.type === event.type && !l.capture) {
            l.fn(event as unknown as Event);
            if (event._immediateStopped) break;
          }
        }
        if (event._stopped) break;
      }
    }
    return !event.defaultPrevented;
  }
}

class TestResizeObserver {
  readonly observed: Element[] = [];
  disconnected = false;
  constructor(readonly cb: ResizeObserverCallback, readonly registry: TestResizeObserver[]) {
    registry.push(this);
  }
  observe(el: Element): void { this.observed.push(el); }
  unobserve(el: Element): void {
    const i = this.observed.indexOf(el);
    if (i >= 0) this.observed.splice(i, 1);
  }
  disconnect(): void { this.disconnected = true; this.observed.length = 0; }
}

class TestMutationObserver {
  observe(): void {}
  disconnect(): void {}
}

class TestWindow extends TestEventTarget {
  readonly devicePixelRatio = 1;
  readonly performance = { now: () => 100 };
  readonly navigator = { language: 'en-US' };
  readonly console = { warn() {}, error: (...a: unknown[]) => { console.error(...a); }, info() {} };
  readonly observers: TestResizeObserver[] = [];
  readonly rafQueue: Array<(t: number) => void> = [];
  readonly ResizeObserver: new (cb: ResizeObserverCallback) => TestResizeObserver;
  readonly MutationObserver = TestMutationObserver;
  private nextRaf = 1;

  constructor(readonly document: TestDocument) {
    super();
    const observers = this.observers;
    this.ResizeObserver = class extends TestResizeObserver {
      constructor(cb: ResizeObserverCallback) { super(cb, observers); }
    };
  }
  matchMedia() {
    return {
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    };
  }
  getComputedStyle(el: TestElement) {
    return {
      width: `${el.rect.width}px`,
      height: `${el.rect.height}px`,
      fontSize: '12px',
      fontFamily: 'sans-serif',
      fontStyle: 'normal',
      fontWeight: '400',
      letterSpacing: 'normal',
      wordSpacing: 'normal',
      lineHeight: '16px',
      color: 'rgb(0, 0, 0)',
      backgroundColor: 'rgb(255, 255, 255)',
      colorScheme: 'light',
      boxSizing: 'border-box',
      paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
      borderLeftWidth: '0px', borderRightWidth: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
      overflowX: 'visible', overflowY: 'visible', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px',
      getPropertyValue(name: string) {
        if (name === '--axylo-stylesheet') return 'loaded';
        return String(el.style[name] ?? '');
      },
    };
  }
  requestAnimationFrame(cb: (t: number) => void): number {
    this.rafQueue.push(cb);
    return this.nextRaf++;
  }
  cancelAnimationFrame(): void {}
  queueMicrotask(cb: () => void): void { cb(); }
  flushFrames(max = 5): void {
    for (let i = 0; i < max && this.rafQueue.length > 0; i++) {
      const batch = this.rafQueue.splice(0);
      for (const cb of batch) cb(16 * (i + 1));
    }
  }
}

class TestDocument extends TestEventTarget {
  readonly nodeType = 9;
  readonly defaultView: TestWindow;
  readonly documentElement: TestElement;
  readonly head: TestElement;
  readonly body: TestElement;
  readonly styleSheets: unknown[] = [{ cssRules: [{ cssText: ':root { --axylo-stylesheet: loaded; }' }] }];
  readonly adoptedStyleSheets: unknown[] = [];
  readonly fonts = new TestEventTarget();
  activeElement: TestElement;

  constructor() {
    super();
    this.defaultView = new TestWindow(this);
    this.documentElement = new TestElement(this, 'html');
    this.documentElement.setAttribute('lang', 'en');
    this.documentElement.clientWidth = 1024;
    this.documentElement.clientHeight = 768;
    this.head = new TestElement(this, 'head');
    this.body = new TestElement(this, 'body');
    this.documentElement.append(this.head, this.body);
    this.activeElement = this.body;
  }
  createElement(tag: string): TestElement { return new TestElement(this, tag); }
  createElementNS(_ns: string, tag: string): TestElement { return new TestElement(this, tag); }
  createTextNode(text: string): TestText { return new TestText(this, text); }
  createDocumentFragment(): TestElement { return new TestElement(this, '#fragment'); }
  getElementById(id: string): TestElement | null {
    const walk = (el: TestElement): TestElement | null => {
      if (el.id === id) return el;
      for (const c of el.children) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this.documentElement);
  }
}

function baseModel(overrides: Partial<FigureModel> = {}): FigureModel {
  return {
    compact: false,
    title: { text: 'Sessions', level: 3, visible: true },
    labelledBy: null,
    name: 'Sessions',
    subtitle: null,
    summary: 'Line chart of sessions.',
    summaryVisible: false,
    note: null,
    noteLang: null,
    noteSegments: null,
    message: null,
    messageLang: null,
    summaryLang: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('dom/figure.ts: lazy structural DOM mounting and compact toggle', () => {
  it('omits subtitle, corner, top and side on a full figure until actually needed, and removes them when emptied/hidden', () => {
    const doc = new TestDocument();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const fig = createFigure(root as unknown as HTMLElement, 'full-1', {
      marks: doc.createElement('svg') as unknown as Element,
      text: doc.createElement('div') as unknown as Element,
    });
    const el = fig.figure as unknown as TestElement;

    // Initial full mount keeps test-invariant elements, omits lazy ones.
    expect(el.querySelector('.axylo-caption')).not.toBeNull();
    expect(el.querySelector('.axylo-title')).not.toBeNull();
    expect(el.querySelector('.axylo-description')).not.toBeNull();
    expect(el.querySelector('.axylo-summary')).not.toBeNull();
    expect(el.querySelector('.axylo-message')).not.toBeNull();
    expect(el.querySelector('.axylo-note')).not.toBeNull();
    expect(el.querySelector('.axylo-live')).not.toBeNull();
    expect(el.querySelector('.axylo-controls')).not.toBeNull();
    expect(el.querySelector('.axylo-readout')).not.toBeNull();
    expect(el.querySelector('.axylo-tooltip')).not.toBeNull();

    expect(el.querySelector('.axylo-subtitle')).toBeNull();
    expect(el.querySelector('.axylo-corner')).toBeNull();
    expect(el.querySelector('.axylo-controls-top')).toBeNull();
    expect(el.querySelector('.axylo-controls-side')).toBeNull();
    expect(fig.hasSlot('top')).toBe(false);
    expect(fig.hasSlot('side')).toBe(false);

    // Updating without subtitle still creates no subtitle or corner.
    fig.update(baseModel());
    expect(el.querySelector('.axylo-subtitle')).toBeNull();
    expect(el.querySelector('.axylo-corner')).toBeNull();

    // Setting subtitle mounts it inside caption right between title and description.
    fig.update(baseModel({ subtitle: 'Daily trend' }));
    const caption = el.querySelector('.axylo-caption')!;
    expect(caption.children.map(c => c.className)).toEqual([
      'axylo-title',
      'axylo-subtitle',
      'axylo-description axylo-visually-hidden',
      'axylo-summary axylo-visually-hidden',
    ]);
    expect(caption.children[1]!.textContent).toBe('Daily trend');

    // Clearing subtitle removes it from the DOM.
    fig.update(baseModel({ subtitle: null }));
    expect(el.querySelector('.axylo-subtitle')).toBeNull();

    // Lazy top/side slots mount in canonical positions and detach when emptied.
    const dummy = doc.createElement('div');
    fig.placeControls('top', [dummy as unknown as Element]);
    expect(fig.hasSlot('top')).toBe(true);
    expect(el.children.map(c => c.className)).toEqual([
      'axylo-caption',
      'axylo-controls-top',
      'axylo-body',
      'axylo-controls',
      'axylo-note',
      'axylo-live axylo-visually-hidden',
      'axylo-tooltip',
    ]);
    fig.placeControls('top', []);
    expect(fig.hasSlot('top')).toBe(false);
    expect(el.querySelector('.axylo-controls-top')).toBeNull();

    fig.placeControls('side', [dummy as unknown as Element]);
    expect(fig.hasSlot('side')).toBe(true);
    expect((fig.body as unknown as TestElement).children.map(c => c.className)).toEqual([
      'axylo-stage',
      'axylo-controls-side',
    ]);
    fig.clearControls();
    expect(fig.hasSlot('side')).toBe(false);
    expect(el.querySelector('.axylo-controls-side')).toBeNull();
    expect(fig.controlsSignature()).toBe('\u0000\u0000');

    fig.destroy();
  });

  it('mounts minimal DOM on compact: true, mounts corner only for dirty note, lazily mounts live on announce, and upgrades/downgrades cleanly', () => {
    const doc = new TestDocument();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const fig = createFigure(
      root as unknown as HTMLElement,
      'compact-1',
      { marks: doc.createElement('svg') as unknown as Element, text: null },
      { compact: true },
    );
    const el = fig.figure as unknown as TestElement;

    // Minimal compact DOM: description directly in figure before plot (no body/stage wrappers); message and note mounted (hidden); nothing else.
    expect(el.children.map(c => c.className)).toEqual([
      'axylo-description axylo-visually-hidden',
      'axylo-plot',
      'axylo-note',
    ]);
    expect(el.querySelector('.axylo-body')).toBeNull();
    expect(el.querySelector('.axylo-stage')).toBeNull();
    // Reading fig.stage on compact returns fig.plot without force-creating body/stage wrappers.
    expect(fig.stage).toBe(fig.plot);
    expect(el.querySelector('.axylo-body')).toBeNull();
    expect(el.querySelector('.axylo-stage')).toBeNull();
    expect((el.querySelector('.axylo-message') as TestElement).hidden).toBe(true);
    expect((el.querySelector('.axylo-note') as TestElement).hidden).toBe(true);
    expect(el.querySelector('.axylo-caption')).toBeNull();
    expect(el.querySelector('.axylo-title')).toBeNull();
    expect(el.querySelector('.axylo-summary')).toBeNull();
    expect(el.querySelector('.axylo-controls')).toBeNull();
    expect(el.querySelector('.axylo-readout')).toBeNull();
    expect(el.querySelector('.axylo-tooltip')).toBeNull();
    expect(el.querySelector('.axylo-live')).toBeNull();
    expect(el.querySelector('.axylo-corner')).toBeNull();

    // Clean compact update keeps corner, body, and stage unmounted.
    fig.update(baseModel({ compact: true, note: null }));
    expect(el.getAttribute('aria-describedby')).toBe('compact-1-s');
    expect(el.querySelector('.axylo-corner')).toBeNull();
    expect(el.querySelector('.axylo-body')).toBeNull();
    expect(el.querySelector('.axylo-stage')).toBeNull();

    // Dirty compact update mounts corner with title; clearing removes it.
    fig.update(baseModel({ compact: true, note: 'Values not shown: 3.' }));
    const corner = el.querySelector('.axylo-corner')!;
    expect(corner).not.toBeNull();
    expect(corner.hidden).toBe(false);
    expect(corner.getAttribute('title')).toBe('Values not shown: 3.');
    fig.update(baseModel({ compact: true, note: null }));
    expect(el.querySelector('.axylo-corner')).toBeNull();

    // announce() lazily mounts live region.
    fig.announce('Loading chart.', 'en');
    const live = el.querySelector('.axylo-live')!;
    expect(live).not.toBeNull();
    expect(live.textContent).toBe('Loading chart.');
    expect(live.getAttribute('lang')).toBe('en');

    // Toggle compact: true -> false mounts body, stage, and all full elements in exact canonical order.
    fig.update(baseModel({ compact: false, subtitle: 'Sub' }));
    expect(el.children.map(c => c.className)).toEqual([
      'axylo-caption',
      'axylo-body',
      'axylo-controls',
      'axylo-note',
      'axylo-live axylo-visually-hidden',
      'axylo-tooltip',
    ]);
    expect((fig.stage as unknown as TestElement).className).toBe('axylo-stage');
    expect((fig.stage as unknown as TestElement).children.map(c => c.className)).toEqual([
      'axylo-plot',
      'axylo-readout',
    ]);
    expect(el.querySelector('.axylo-caption')!.children.map(c => c.className)).toEqual([
      'axylo-title',
      'axylo-subtitle',
      'axylo-description axylo-visually-hidden',
      'axylo-summary axylo-visually-hidden',
    ]);
    const tipRef = fig.tooltip;
    const readoutRef = fig.readout;
    const bodyRef = fig.body;
    const stageRef = fig.stage;

    // Focus inside controls, then toggle compact: false -> true: focus moves to figure and full elements (including body/stage) unmount.
    const btn = doc.createElement('button');
    fig.placeControls('controls', [btn as unknown as Element]);
    btn.focus();
    expect(doc.activeElement).toBe(btn);
    fig.update(baseModel({ compact: true }));
    expect(doc.activeElement).toBe(el);
    expect(el.getAttribute('tabindex')).toBe('-1');
    expect(el.children.map(c => c.className)).toEqual([
      'axylo-description axylo-visually-hidden',
      'axylo-plot',
      'axylo-note',
    ]);
    expect(el.querySelector('.axylo-body')).toBeNull();
    expect(el.querySelector('.axylo-stage')).toBeNull();
    expect(fig.stage).toBe(fig.plot);
    expect(el.querySelector('.axylo-subtitle')).toBeNull();
    expect(el.querySelector('.axylo-tooltip')).toBeNull();
    expect(el.querySelector('.axylo-readout')).toBeNull();

    // Toggling back to compact: false re-mounts the exact same body, stage, tooltip & readout instances.
    fig.update(baseModel({ compact: false }));
    expect(fig.body).toBe(bodyRef);
    expect(fig.stage).toBe(stageRef);
    expect(fig.tooltip).toBe(tipRef);
    expect(fig.readout).toBe(readoutRef);

    fig.destroy();
  });

  it('uses a prototype-backed class with shared getters/methods (no per-instance closures) and lazily wraps plot when body is accessed on compact', () => {
    const doc = new TestDocument();
    const rootA = doc.createElement('div');
    const rootB = doc.createElement('div');
    doc.body.append(rootA, rootB);
    const figA = createFigure(
      rootA as unknown as HTMLElement,
      'proto-a',
      { marks: doc.createElement('svg') as unknown as Element, text: null },
      { compact: true },
    );
    const figB = createFigure(
      rootB as unknown as HTMLElement,
      'proto-b',
      { marks: doc.createElement('svg') as unknown as Element, text: null },
      { compact: true },
    );

    // Same prototype, shared prototype methods & getters (not own properties on instances).
    expect(Object.getPrototypeOf(figA)).toBe(Object.getPrototypeOf(figB));
    expect(Object.getPrototypeOf(figA)).not.toBe(Object.prototype);
    expect(figA.update).toBe(figB.update);
    expect(figA.announce).toBe(figB.announce);
    expect(figA.destroy).toBe(figB.destroy);
    expect(figA.placeControls).toBe(figB.placeControls);
    expect(Object.getOwnPropertyDescriptor(figA, 'top')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(figA, 'side')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(figA, 'tooltip')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(figA, 'readout')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(figA, 'controls')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(figA, 'body')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(figA, 'stage')).toBeUndefined();

    // Accessing figA.body lazily wraps plot into body > stage.
    const body = figA.body as unknown as TestElement;
    expect(body.className).toBe('axylo-body');
    expect((figA.stage as unknown as TestElement).className).toBe('axylo-stage');
    expect((figA.stage as unknown as TestElement).children).toEqual([figA.plot]);
    expect((figA.figure as unknown as TestElement).children.map(c => c.className)).toEqual([
      'axylo-description axylo-visually-hidden',
      'axylo-body',
      'axylo-note',
    ]);

    figA.destroy();
    figB.destroy();
  });
});

describe('dom/interaction.ts: collapsed instructions, lazy control slots, and lazy touch/dismissal state', () => {
  it('renders instructions as plain text with zero child spans when lang is uniform, and spans only for mixed langs', () => {
    const doc = new TestDocument();
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const fig = createFigure(root as unknown as HTMLElement, 'inst-1', {
      marks: doc.createElement('svg') as unknown as Element,
      text: doc.createElement('div') as unknown as Element,
    });
    const r = record('line', {
      title: 'Trend',
      data: [{ x: 0, s: 'A', y: 1 }, { x: 1, s: 'A', y: 2 }, { x: 0, s: 'B', y: 3 }, { x: 1, s: 'B', y: 4 }],
      x: 'x', y: 'y', series: 's',
    });
    r.frames();
    const cf = r.committed!;
    const renderer: MarkRenderer = { kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement, draw() {}, drawOverlay() {}, destroy() {} };
    const actions: Actions = { zoom() {}, toggle() {}, pause() {}, select() {}, hover() {} };
    const parts: InteractionParts = { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null };
    const interaction = createInteraction(parts, fig, renderer, actions);
    const base: Committed = {
      kind: 'line', view: cf.view, formatters: cf.formatters, messages: defaultMessages, reader: cf.reader,
      tooSmall: false, ready: true, interactive: true, tooltip: true, legend: 'bottom', zoom: true, zoomed: false,
      streaming: false, paused: false, epoch: 1, english: () => null, pageLang: null,
      layout: cf.layout, lookup: cf.lookup, bindings: {} as PaintBindings, theme: {} as ResolvedTheme, pixelRatio: 1,
    };

    // Uniform lang (null): zero child spans, combined text directly on instructions element.
    interaction.prepare(base);
    interaction.commit(base);
    const inst = (fig.plot as unknown as TestElement).querySelector('#inst-1-i') ?? (fig.plot as unknown as TestElement).children.find(c => c.id === 'inst-1-i')!;
    expect(inst.children).toHaveLength(0);
    expect(inst.getAttribute('lang')).toBeNull();
    expect(inst.textContent).toBe(`${defaultMessages.plotInstructions} ${defaultMessages.seriesInstructions} ${defaultMessages.zoomInstructions}`);
    // Legend at bottom never mounted top or side.
    expect(fig.hasSlot('top')).toBe(false);
    expect(fig.hasSlot('side')).toBe(false);

    // Move legend to top -> top mounts, side stays absent; then legend: false -> top detaches.
    interaction.commit({ ...base, legend: 'top' });
    expect(fig.hasSlot('top')).toBe(true);
    expect(fig.hasSlot('side')).toBe(false);
    interaction.commit({ ...base, legend: 'right' });
    expect(fig.hasSlot('top')).toBe(false);
    expect(fig.hasSlot('side')).toBe(true);
    interaction.commit({ ...base, legend: false });
    expect(fig.hasSlot('top')).toBe(false);
    expect(fig.hasSlot('side')).toBe(false);

    // Mixed langs on a German page: switches cleanly from plain text to 3 child spans with no stray text node.
    interaction.commit({
      ...base,
      messages: { ...defaultMessages, seriesInstructions: 'Reihe wechseln.' },
      pageLang: 'de',
      english: key => key === 'seriesInstructions' ? null : 'en',
    });
    expect(inst.getAttribute('lang')).toBeNull();
    expect(inst.children).toHaveLength(3);
    expect(inst.childNodes).toHaveLength(3);
    expect(inst.children.map(s => s.getAttribute('lang'))).toEqual(['en', 'de', 'en']);
    expect(inst.textContent).toBe(`${defaultMessages.plotInstructions} Reihe wechseln. ${defaultMessages.zoomInstructions}`);

    // Back to uniform lang ('en'): removes all child spans and puts lang="en" on instructions itself.
    interaction.commit({
      ...base,
      pageLang: 'de',
      english: () => 'en',
    });
    expect(inst.children).toHaveLength(0);
    expect(inst.getAttribute('lang')).toBe('en');
    expect(inst.textContent).toBe(`${defaultMessages.plotInstructions} ${defaultMessages.seriesInstructions} ${defaultMessages.zoomInstructions}`);

    // Touch tap & Escape dismissal work cleanly when lazily allocated from null.
    const tipEl = fig.tooltip as unknown as TestElement;
    tipEl.rect = { x: 0, y: 0, left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40 };
    tipEl.scrollWidth = 120; tipEl.clientWidth = 200; tipEl.scrollHeight = 40; tipEl.clientHeight = 200;
    const plot = fig.plot as unknown as TestElement;
    const first = cf.lookup.step(null, 'first')!;
    const box = cf.lookup.anchor(first)!;
    plot.dispatchEvent(new TestEvent('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: box.x, clientY: box.y, timeStamp: 100 }));
    plot.dispatchEvent(new TestEvent('pointerup', { pointerType: 'touch', pointerId: 1, clientX: box.x, clientY: box.y, timeStamp: 150 }));
    expect(tipEl.hidden).toBe(false);
    const esc = new TestEvent('keydown', { key: 'Escape' });
    // Dispatch Escape through the element so it reaches the capturing window listener.
    plot.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(tipEl.hidden).toBe(true);

    interaction.destroy();
    fig.destroy();
  });
});

describe('core/chart.ts: lazy interaction, fontProbe, ResizeObserver, and textLayer mounting', () => {
  it('compact line chart allocates 1 ResizeObserver, no fontProbe, no textLayer, and no interaction DOM; upgrading to compact: false mounts them', () => {
    const doc = new TestDocument();
    const root = doc.createElement('div');
    doc.body.appendChild(root);

    const handle = createChart(LINE, root as unknown as HTMLElement, {
      title: 'Spark',
      compact: true,
      data: [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 15 }],
      x: 'x',
      y: 'y',
    });
    doc.defaultView.flushFrames();

    // Only 1 ResizeObserver (plot/figure), zero body/stage wrappers, zero fontProbe, zero textLayer, zero interaction proxy/controls.
    expect(doc.defaultView.observers).toHaveLength(1);
    expect(root.querySelector('.axylo-body')).toBeNull();
    expect(root.querySelector('.axylo-stage')).toBeNull();
    expect(root.querySelector('.axylo-font-probe')).toBeNull();
    expect(root.querySelector('.axylo-text')).toBeNull();
    expect(root.querySelector('.axylo-proxy')).toBeNull();
    expect(root.querySelector('.axylo-caption')).toBeNull();
    expect(root.querySelector('.axylo-controls')).toBeNull();
    expect(root.querySelector('.axylo-live')).toBeNull();
    expect(root.querySelector('.axylo-tooltip')).toBeNull();
    expect(root.querySelector('.axylo-readout')).toBeNull();
    expect(root.querySelector('.axylo-message')).not.toBeNull();
    expect(root.querySelector('.axylo-note')).not.toBeNull();

    // Upgrading to compact: false lazily mounts body/stage, textLayer, fontProbe (+ 2nd ResizeObserver), full figure, and interaction.
    handle.update({ compact: false });
    doc.defaultView.flushFrames();
    expect(handle.diagnostics).toEqual([]);
    expect(root.querySelector('.axylo-body')).not.toBeNull();
    expect(root.querySelector('.axylo-stage')).not.toBeNull();
    expect(root.querySelector('.axylo-text')).not.toBeNull();
    expect(root.querySelector('.axylo-font-probe')).not.toBeNull();
    expect(doc.defaultView.observers.filter(o => !o.disconnected)).toHaveLength(2);
    expect(root.querySelector('.axylo-proxy')).not.toBeNull();
    expect(root.querySelector('.axylo-caption')).not.toBeNull();
    expect(root.querySelector('.axylo-controls')).not.toBeNull();

    // Downgrading back to compact: true releases body/stage, textLayer, fontProbe, and disconnects the font ResizeObserver.
    handle.update({ compact: true });
    doc.defaultView.flushFrames();
    expect(root.querySelector('.axylo-body')).toBeNull();
    expect(root.querySelector('.axylo-stage')).toBeNull();
    expect(root.querySelector('.axylo-text')).toBeNull();
    expect(root.querySelector('.axylo-font-probe')).toBeNull();
    expect(doc.defaultView.observers.filter(o => !o.disconnected)).toHaveLength(1);

    handle.destroy();
    expect(doc.defaultView.observers.every(o => o.disconnected)).toBe(true);
  });

  it('donut chart allocates 1 ResizeObserver and zero fontProbe/textLayer/top/subtitle/corner elements', () => {
    const doc = new TestDocument();
    const root = doc.createElement('div');
    doc.body.appendChild(root);

    const handle = createChart(DONUT, root as unknown as HTMLElement, {
      title: 'Share',
      data: [{ label: 'A', value: 40 }, { label: 'B', value: 60 }],
      label: 'label',
      value: 'value',
    });
    doc.defaultView.flushFrames();

    expect(doc.defaultView.observers).toHaveLength(1);
    expect(root.querySelector('.axylo-font-probe')).toBeNull();
    expect(root.querySelector('.axylo-text')).toBeNull();
    expect(root.querySelector('.axylo-subtitle')).toBeNull();
    expect(root.querySelector('.axylo-corner')).toBeNull();
    expect(root.querySelector('.axylo-controls-top')).toBeNull();
    expect(root.querySelector('.axylo-controls-side')).toBeNull();

    // Moving legend to 'right' lazily mounts side for the donut slice list; 'false' detaches it again.
    handle.update({ legend: 'right' });
    doc.defaultView.flushFrames();
    expect(root.querySelector('.axylo-controls-side')).not.toBeNull();

    handle.update({ legend: false });
    doc.defaultView.flushFrames();
    expect(root.querySelector('.axylo-controls-side')).toBeNull();

    handle.destroy();
  });

  it('full line chart eagerly mounts .axylo-text and creates fontProbe lazily when labels render', () => {
    const doc = new TestDocument();
    const root = doc.createElement('div');
    doc.body.appendChild(root);

    const handle = createChart(LINE, root as unknown as HTMLElement, {
      title: 'Full',
      data: [{ x: 0, y: 10 }, { x: 1, y: 20 }],
      x: 'x',
      y: 'y',
    });
    // .axylo-text is mounted immediately before the first frame; fontProbe waits until labels render.
    expect(root.querySelector('.axylo-text')).not.toBeNull();
    expect(root.querySelector('.axylo-font-probe')).toBeNull();
    expect(doc.defaultView.observers).toHaveLength(1);

    doc.defaultView.flushFrames();
    expect(root.querySelector('.axylo-font-probe')).not.toBeNull();
    expect(doc.defaultView.observers).toHaveLength(2);
    expect(root.querySelector('.axylo-subtitle')).toBeNull();
    expect(root.querySelector('.axylo-corner')).toBeNull();
    expect(root.querySelector('.axylo-controls-top')).toBeNull();
    expect(root.querySelector('.axylo-controls-side')).toBeNull();

    handle.destroy();
  });
});
