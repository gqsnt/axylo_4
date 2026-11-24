/**
 * Regression tests for Milestone M1C:
 * 1. lastShowing WeakMap scoping per Document, release on hide/clear/detach/destroy (no leak), and proxy-blur recency
 * 2. Cross-realm iframe safety (no instanceof HTMLButtonElement / Element / HTMLElement failures)
 * 3. Stale press state in dom/tooltip.ts (outside release, outside cancel, non-row pointerdown, hide/destroy cleanup)
 * 4. Shadow DOM scroll/focus/outside-click (open & closed), focus restoration (closeTable, donutSliceList, renderControls),
 *    and jumpTarget (whitespace-only categories & formatted numeric printed-value lookup)
 */
import { describe, expect, it, vi } from 'vitest';
import { activeElementOf, isElement, isFocusable, shadowRootOf } from '../../src/dom/attributes';
import { createFigure } from '../../src/dom/figure';
import { createTooltip, type TooltipContent } from '../../src/dom/tooltip';
import {
  createInteraction, donutSliceList, lineSwatch, type Actions, type Committed, type ControlsState, type InteractionParts,
} from '../../src/dom/interaction';
import { alignedTargetMarks } from '../../src/core/focus';
import type {
  DatumRef, DatumText, MarkRenderer, Overlay, PaintBindings, ResolvedTheme, TooltipModel,
} from '../../src/core/contracts';
import { defaultMessages } from '../../src/messages';
import { record } from '../core/host';

// ── Lightweight cross-realm DOM mock (distinct classes per "realm" to verify zero instanceof reliance) ────

interface ListenerEntry {
  type: string;
  fn: EventListener;
  capture: boolean;
  signal?: AbortSignal;
}

class MockEventTarget {
  readonly _listeners: ListenerEntry[] = [];

  addEventListener(type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions): void {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const signal = typeof opts === 'object' ? opts?.signal : undefined;
    if (signal?.aborted) return;
    const handler: EventListener = typeof fn === 'function' ? fn : e => fn.handleEvent(e);
    const entry: ListenerEntry = { type, fn: handler, capture, signal };
    this._listeners.push(entry);
    signal?.addEventListener('abort', () => {
      const i = this._listeners.indexOf(entry);
      if (i >= 0) this._listeners.splice(i, 1);
    }, { once: true });
  }

  removeEventListener(type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | EventListenerOptions): void {
    const capture = typeof opts === 'boolean' ? opts : Boolean(opts?.capture);
    const i = this._listeners.findIndex(l => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this._listeners.splice(i, 1);
  }

  listenerCount(type?: string): number {
    return type ? this._listeners.filter(l => l.type === type).length : this._listeners.length;
  }

  _invoke(event: MockEvent, capture: boolean): void {
    event.currentTarget = this;
    for (const l of [...this._listeners]) {
      if (l.type === event.type && l.capture === capture) {
        l.fn(event as unknown as Event);
        if (event._immediateStopped) break;
      }
    }
  }
}

class MockEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly composed: boolean;
  target: unknown = null;
  currentTarget: unknown = null;
  defaultPrevented = false;
  _stopped = false;
  _immediateStopped = false;
  private _path: unknown[] = [];
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
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly detail: number;
  readonly timeStamp: number;

  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    this.bubbles = init.bubbles !== false;
    this.composed = init.composed !== undefined ? Boolean(init.composed) : type !== 'scroll';
    this.key = String(init.key ?? '');
    this.button = Number(init.button ?? 0);
    this.pointerId = Number(init.pointerId ?? 1);
    this.pointerType = String(init.pointerType ?? 'mouse');
    this.clientX = Number(init.clientX ?? 0);
    this.clientY = Number(init.clientY ?? 0);
    this.deltaY = Number(init.deltaY ?? 0);
    this.deltaMode = Number(init.deltaMode ?? 0);
    this.detail = Number(init.detail ?? 1);
    this.timeStamp = Number(init.timeStamp ?? 100);
  }

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this._stopped = true; }
  stopImmediatePropagation(): void { this._immediateStopped = true; this._stopped = true; }
  _setPath(path: unknown[]): void { this._path = path; }
  composedPath(): unknown[] {
    // Emulate closed shadow root boundary: when currentTarget is outside a closed shadow root,
    // composedPath omits nodes inside that closed shadow tree (per DOM spec).
    const cur = this.currentTarget;
    const idx = this._path.indexOf(cur);
    if (idx < 0) return [...this._path];
    const out: unknown[] = [];
    let hidden = false;
    for (let i = 0; i < this._path.length; i++) {
      const node = this._path[i];
      if (i > idx) { out.push(node); continue; }
      if (node instanceof MockShadowRoot && node.mode === 'closed' && i < idx) {
        // Everything before (inside) this closed shadow root is hidden from outer listeners.
        out.length = 0;
        hidden = false;
        continue;
      }
      if (!hidden) out.push(node);
    }
    return out;
  }
}

class MockClassList {
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

interface MockNode {
  readonly nodeType: number;
  readonly ownerDocument: MockDocument;
  parentNode: MockContainer | null;
  textContent: string;
  readonly nextSibling: MockNode | null;
  readonly isConnected: boolean;
  remove(): void;
  getRootNode(): MockNode | MockDocument | MockShadowRoot;
}

class MockText implements MockNode {
  readonly nodeType = 3;
  parentNode: MockContainer | null = null;
  constructor(readonly ownerDocument: MockDocument, public textContent: string) {}
  get nextSibling(): MockNode | null {
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
  getRootNode(): MockNode | MockDocument | MockShadowRoot {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }
}

abstract class MockContainer extends MockEventTarget {
  readonly childNodes: MockNode[] = [];
  abstract readonly ownerDocument: MockDocument;
  abstract readonly isConnected: boolean;
  abstract getRootNode(): MockNode | MockDocument | MockShadowRoot;

  get firstChild(): MockNode | null { return this.childNodes[0] ?? null; }
  get firstElementChild(): MockElement | null { return (this.childNodes.find(n => n.nodeType === 1) as MockElement | undefined) ?? null; }
  get lastChild(): MockNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get lastElementChild(): MockElement | null {
    for (let i = this.childNodes.length - 1; i >= 0; i--) if (this.childNodes[i]!.nodeType === 1) return this.childNodes[i] as MockElement;
    return null;
  }
  get children(): MockElement[] { return this.childNodes.filter(n => n.nodeType === 1) as MockElement[]; }

  contains(node: unknown): boolean {
    if (node === this) return true;
    let cur = (node as MockNode | null)?.parentNode ?? null;
    while (cur) {
      if (cur === this) return true;
      cur = cur instanceof MockElement ? cur.parentNode : null;
    }
    return false;
  }

  insertBefore<T extends MockNode>(node: T, ref: MockNode | null): T {
    // Moving a focused element blurs it in browsers (drop focus if focused node is moved).
    const doc = this.ownerDocument;
    const active = activeElementOf(doc as unknown as Document, node as unknown as Node) as unknown as MockElement | null;
    const movingFocus = active !== null && node instanceof MockElement && node.contains(active) && node.parentNode !== null;
    if (node.parentNode) {
      const old = node.parentNode.childNodes.indexOf(node);
      if (old >= 0) node.parentNode.childNodes.splice(old, 1);
    }
    node.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at >= 0) this.childNodes.splice(at, 0, node);
    else this.childNodes.push(node);
    if (movingFocus) doc._dropFocus(active);
    return node;
  }

  appendChild<T extends MockNode>(node: T): T { return this.insertBefore(node, null); }
  append(...nodes: (MockNode | string)[]): void {
    for (const n of nodes) this.appendChild(typeof n === 'string' ? new MockText(this.ownerDocument, n) : n);
  }
  replaceChildren(...nodes: (MockNode | string)[]): void {
    for (const c of [...this.childNodes]) c.remove();
    this.append(...nodes);
  }

  querySelectorAll(selector: string): MockElement[] {
    const out: MockElement[] = [];
    const sels = selector.split(',').map(s => s.trim());
    const walk = (el: MockElement) => {
      if (sels.some(s => el.matches(s))) out.push(el);
      for (const c of el.children) walk(c);
    };
    for (const c of this.children) walk(c);
    return out;
  }
  querySelector(selector: string): MockElement | null { return this.querySelectorAll(selector)[0] ?? null; }
}

class MockShadowRoot extends MockContainer {
  readonly nodeType = 11;
  activeElement: MockElement | null = null;
  constructor(readonly ownerDocument: MockDocument, readonly host: MockElement, readonly mode: 'open' | 'closed') {
    super();
  }
  get isConnected(): boolean { return this.host.isConnected; }
  getRootNode(): MockShadowRoot { return this; }
}

class MockElement extends MockContainer implements MockNode {
  readonly nodeType = 1;
  readonly tagName: string;
  parentNode: MockContainer | null = null;
  readonly attrs = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> = {
    cssText: '', maxWidth: '', maxHeight: '', transform: '', left: '', top: '', width: '', height: '',
    setProperty(name: string, value: string) { (this as Record<string, unknown>)[name] = value; },
  };
  readonly classList: MockClassList;
  hidden = false;
  inert = false;
  tabIndex = -1;
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  autocomplete = '';
  htmlFor = '';
  scrollTop = 0;
  scrollWidth = 100;
  scrollHeight = 40;
  clientWidth = 400;
  clientHeight = 300;
  offsetWidth = 400;
  offsetHeight = 300;
  rect = { x: 0, y: 0, left: 0, top: 0, width: 100, height: 30, right: 100, bottom: 30 };
  _shadow: MockShadowRoot | null = null;

  constructor(readonly ownerDocument: MockDocument, tag: string) {
    super();
    this.tagName = tag.toUpperCase();
    if (this.tagName === 'BUTTON' || this.tagName === 'INPUT') this.tabIndex = 0;
    this.classList = new MockClassList(v => {
      if (v) this.attrs.set('class', v);
      else this.attrs.delete('class');
    });
  }

  get shadowRoot(): MockShadowRoot | null { return this._shadow?.mode === 'open' ? this._shadow : null; }
  attachShadow(init: { mode: 'open' | 'closed' }): MockShadowRoot {
    this._shadow = new MockShadowRoot(this.ownerDocument, this, init.mode);
    return this._shadow;
  }

  get id(): string { return this.attrs.get('id') ?? ''; }
  set id(v: string) { this.attrs.set('id', v); }
  get className(): string { return this.attrs.get('class') ?? ''; }
  set className(v: string) { this.attrs.set('class', v); this.classList.setFrom(v); }
  get parentElement(): MockElement | null { return this.parentNode instanceof MockElement ? this.parentNode : null; }
  get assignedSlot(): null { return null; }

  get nextSibling(): MockNode | null {
    if (!this.parentNode) return null;
    const i = this.parentNode.childNodes.indexOf(this);
    return i >= 0 ? this.parentNode.childNodes[i + 1] ?? null : null;
  }

  get isConnected(): boolean {
    if (this === this.ownerDocument.documentElement || this === this.ownerDocument.body) return true;
    return this.parentNode?.isConnected ?? false;
  }

  getRootNode(): MockNode | MockDocument | MockShadowRoot {
    return this.parentNode ? this.parentNode.getRootNode() : this;
  }

  get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v: string) {
    for (const c of [...this.childNodes]) c.remove();
    if (v !== '') this.appendChild(new MockText(this.ownerDocument, v));
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

  remove(): void {
    const doc = this.ownerDocument;
    const active = activeElementOf(doc as unknown as Document, this as unknown as Node) as unknown as MockElement | null;
    const hadFocus = active !== null && this.contains(active);
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
    if (hadFocus) doc._dropFocus(active);
  }

  focus(): void {
    if (this.hidden || !this.isConnected) return;
    this.ownerDocument._setFocus(this);
  }

  blur(): void {
    const doc = this.ownerDocument;
    if (activeElementOf(doc as unknown as Document, this as unknown as Node) === (this as unknown as Element)) {
      doc._setFocus(doc.body);
    }
  }

  getBoundingClientRect() { return { ...this.rect }; }
  getClientRects() { return this.hidden ? [] : [{ ...this.rect }]; }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean { return false; }

  matches(sel: string): boolean {
    if (sel === ':focus-visible') return false;
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    if (sel.startsWith('[') && sel.endsWith(']')) return this.hasAttribute(sel.slice(1, -1));
    if (sel.includes('>')) {
      const [parentSel, childSel] = sel.split('>').map(s => s.trim());
      return Boolean(this.parentElement?.matches(parentSel!) && this.matches(childSel!));
    }
    const dot = sel.indexOf('.');
    if (dot > 0) return this.tagName === sel.slice(0, dot).toUpperCase() && this.classList.contains(sel.slice(dot + 1));
    const br = sel.indexOf('[');
    if (br > 0) return this.tagName === sel.slice(0, br).toUpperCase() && this.hasAttribute(sel.slice(br + 1, -1));
    return this.tagName === sel.toUpperCase();
  }

  closest(sel: string): MockElement | null {
    let cur: MockElement | null = this;
    while (cur) {
      if (cur.matches(sel)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  dispatchEvent(event: MockEvent): boolean {
    event.target = this;
    const path: MockEventTarget[] = [];
    let cur: MockEventTarget | null = this;
    while (cur) {
      path.push(cur);
      if (cur instanceof MockElement) {
        cur = cur.parentNode ?? (cur === cur.ownerDocument.documentElement ? cur.ownerDocument : null);
      } else if (cur instanceof MockShadowRoot) {
        cur = event.composed ? cur.host : null;
      } else if (cur instanceof MockDocument) {
        cur = cur.defaultView;
      } else {
        cur = null;
      }
    }
    event._setPath(path);
    for (let i = path.length - 1; i >= 1; i--) {
      path[i]!._invoke(event, true);
      if (event._stopped) return !event.defaultPrevented;
    }
    this._invoke(event, true);
    if (!event._immediateStopped) this._invoke(event, false);
    if (event.bubbles && !event._stopped) {
      for (let i = 1; i < path.length; i++) {
        path[i]!._invoke(event, false);
        if (event._stopped) break;
      }
    }
    return !event.defaultPrevented;
  }
}

class MockWindow extends MockEventTarget {
  readonly performance = { now: () => 100 };
  constructor(readonly document: MockDocument) { super(); }
  getComputedStyle(el: MockElement) {
    return {
      width: `${el.rect.width}px`, height: `${el.rect.height}px`, boxSizing: 'border-box',
      paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
      borderLeftWidth: '0px', borderRightWidth: '0px', borderTopWidth: '0px', borderBottomWidth: '0px',
      overflowX: 'visible', overflowY: 'visible', outlineStyle: 'none', outlineWidth: '0px', outlineOffset: '0px',
    };
  }
  requestAnimationFrame(cb: () => void): number { cb(); return 1; }
  cancelAnimationFrame(): void {}
}

class MockDocument extends MockEventTarget {
  readonly nodeType = 9;
  readonly defaultView: MockWindow;
  readonly documentElement: MockElement;
  readonly body: MockElement;
  activeElement: MockElement | null = null;
  private _focused: MockElement | null = null;

  constructor() {
    super();
    this.defaultView = new MockWindow(this);
    this.documentElement = new MockElement(this, 'html');
    this.documentElement.clientWidth = 1024;
    this.documentElement.clientHeight = 768;
    this.body = new MockElement(this, 'body');
    this.documentElement.appendChild(this.body);
    this.activeElement = this.body;
  }

  createElement(tag: string): MockElement { return new MockElement(this, tag); }
  createElementNS(_ns: string, tag: string): MockElement { return new MockElement(this, tag); }
  createTextNode(text: string): MockText { return new MockText(this, text); }

  _clearShadowFocus(from: MockElement | null): void {
    let root = from?.getRootNode();
    while (root instanceof MockShadowRoot) {
      root.activeElement = null;
      root = root.host.getRootNode();
    }
  }

  _setFocus(el: MockElement | null): void {
    const prev = this._focused;
    if (prev === el) return;
    this._clearShadowFocus(prev);
    this._focused = el;
    if (el === null) {
      this.activeElement = this.body;
    } else {
      let cur: MockElement = el;
      let root = cur.getRootNode();
      while (root instanceof MockShadowRoot) {
        root.activeElement = cur;
        cur = root.host;
        root = cur.getRootNode();
      }
      this.activeElement = cur;
    }
    if (prev && prev !== this.body) prev.dispatchEvent(new MockEvent('blur', { bubbles: false }));
    if (el && el !== this.body) {
      el.dispatchEvent(new MockEvent('focus', { bubbles: false }));
      el.dispatchEvent(new MockEvent('focusin', { bubbles: true }));
    }
  }

  _dropFocus(el: MockElement): void {
    if (this._focused === el) {
      this._clearShadowFocus(el);
      this._focused = null;
      this.activeElement = this.body;
    }
  }

  dispatchEvent(event: MockEvent): boolean {
    event.target = this;
    const path: MockEventTarget[] = [this, this.defaultView];
    event._setPath(path);
    this.defaultView._invoke(event, true);
    if (!event._stopped) {
      this._invoke(event, true);
      if (!event._immediateStopped) this._invoke(event, false);
    }
    if (event.bubbles && !event._stopped) this.defaultView._invoke(event, false);
    return !event.defaultPrevented;
  }
}

// ── Test helpers for interaction/tooltip fixtures ─────────────────────────────────────────────────────────

function sampleContent(overrides: Partial<TooltipContent> = {}): TooltipContent {
  const rows: DatumText[] = [
    { ref: { kind: 'aligned', seriesKey: 'A', x: 1 }, seriesIndex: 0, seriesLabel: 'Alpha', x: '1', value: '10', state: 1, percent: null, row: 0 },
    { ref: { kind: 'aligned', seriesKey: 'B', x: 1 }, seriesIndex: 1, seriesLabel: 'Beta', x: '1', value: '20', state: 1, percent: null, row: 1 },
  ];
  const model: TooltipModel = { title: 'X = 1', rows, count: 5, total: '30' };
  return {
    model,
    swatch: () => null,
    moreRows: n => `+${n} more`,
    totalLabel: 'Total',
    ...overrides,
  };
}

function makePlacement() {
  return {
    box: { x: 100, y: 100, width: 10, height: 10 },
    visible: { x: 0, y: 0, width: 600, height: 400 },
    order: 'vertical' as const,
    hole: null,
    controls: [],
    rings: [],
    ringStroke: 4,
  };
}

function buildLineInteraction(doc: MockDocument, host: MockContainer, id: string, data = [{ x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }], extraOptions: Record<string, unknown> = {}) {
  const root = doc.createElement('div');
  host.appendChild(root);
  const fig = createFigure(root as unknown as HTMLElement, id, {
    marks: doc.createElement('svg') as unknown as Element,
    text: doc.createElement('div') as unknown as Element,
  });
  // Give plot and tooltip realistic layout boxes in the mock DOM.
  const plotEl = fig.plot as unknown as MockElement;
  plotEl.rect = { x: 0, y: 0, left: 0, top: 0, width: 480, height: 300, right: 480, bottom: 300 };
  const figEl = fig.figure as unknown as MockElement;
  figEl.rect = { x: 0, y: 0, left: 0, top: 0, width: 480, height: 360, right: 480, bottom: 360 };
  const tipEl = fig.tooltip as unknown as MockElement;
  tipEl.rect = { x: 0, y: 0, left: 0, top: 0, width: 120, height: 40, right: 120, bottom: 40 };
  tipEl.scrollWidth = 120; tipEl.clientWidth = 200; tipEl.scrollHeight = 40; tipEl.clientHeight = 200;

  const r = record('line', { title: id, data, x: 'x', y: 'y', ...extraOptions });
  r.frames();
  const committedFrame = r.committed!;
  const overlays: (Overlay | null)[] = [];
  const renderer: MarkRenderer = {
    kind: 'svg',
    element: doc.createElement('svg') as unknown as SVGSVGElement,
    draw() {},
    drawOverlay(o) { overlays.push(o); },
    destroy() {},
  };
  const zoomed: ([number, number] | null)[] = [];
  const selected: DatumRef[] = [];
  const actions: Actions = {
    zoom: w => zoomed.push(w ? [w[0], w[1]] : null),
    toggle: () => {},
    pause: () => {},
    select: ref => selected.push(ref),
    hover: () => {},
  };
  const parts: InteractionParts = { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null };
  const interaction = createInteraction(parts, fig, renderer, actions);
  const committed: Committed = {
    kind: 'line',
    view: committedFrame.view,
    formatters: committedFrame.formatters,
    messages: defaultMessages,
    reader: committedFrame.reader,
    tooSmall: false,
    ready: true,
    interactive: true,
    tooltip: true,
    legend: 'bottom',
    zoom: true,
    zoomed: false,
    streaming: false,
    paused: false,
    epoch: 1,
    english: () => null,
    pageLang: null,
    layout: committedFrame.layout,
    lookup: committedFrame.lookup,
    bindings: {} as PaintBindings,
    theme: {} as ResolvedTheme,
    pixelRatio: 1,
  };
  interaction.prepare(committed);
  interaction.commit(committed);
  const firstRef = committed.lookup.step(null, 'first')!;
  const firstBox = committed.lookup.anchor(firstRef)!;
  return { fig, interaction, committed, actions, zoomed, selected, overlays, firstRef, firstBox, r };
}

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('hover and streaming DOM work', () => {
  it('measures changed tooltip text once and reuses plot geometry during a hover sweep', () => {
    const doc = new MockDocument();
    const chart = buildLineInteraction(doc, doc.body, 'sweep');
    const plot = chart.fig.plot as unknown as MockElement;
    const stage = chart.fig.stage as unknown as MockElement;
    const figure = chart.fig.figure as unknown as MockElement;
    const tip = chart.fig.tooltip as unknown as MockElement;
    const move = (ref: DatumRef) => {
      const at = chart.committed.lookup.anchor(ref)!;
      stage.dispatchEvent(new MockEvent('pointermove', { clientX: at.x, clientY: at.y }));
    };
    move(chart.firstRef);
    expect(tip.hidden).toBe(false);
    const plotRect = vi.spyOn(plot, 'getBoundingClientRect');
    const figureRect = vi.spyOn(figure, 'getBoundingClientRect');
    const tipRect = vi.spyOn(tip, 'getBoundingClientRect');
    const toggle = vi.spyOn(tip.classList, 'toggle');
    const scrollHeight = vi.fn(() => 40);
    const clientHeight = vi.fn(() => 200);
    Object.defineProperties(tip, { scrollHeight: { get: scrollHeight }, clientHeight: { get: clientHeight } });
    const next = chart.committed.lookup.step(chart.firstRef, 'next')!;
    move(next);
    move(chart.committed.lookup.step(next, 'next')!);
    expect(tip.hidden).toBe(false);
    expect(tipRect).toHaveBeenCalledTimes(2);
    expect(scrollHeight).not.toHaveBeenCalled();
    expect(clientHeight).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();
    expect(plotRect).not.toHaveBeenCalled();
    expect(figureRect).not.toHaveBeenCalled();
    chart.interaction.destroy();
  });

  it('checks overflow and remeasures after wrapping a constrained tooltip', () => {
    const doc = new MockDocument();
    const fig = doc.createElement('figure');
    const tip = doc.createElement('div');
    const readout = doc.createElement('div');
    fig.append(tip, readout);
    doc.body.appendChild(fig);
    const view = createTooltip(tip as unknown as HTMLElement, readout as unknown as HTMLElement, fig as unknown as HTMLElement, () => {});
    const wrapped = () => tip.classList.contains('axylo-tooltip-wrap');
    const measure = vi.spyOn(tip, 'getBoundingClientRect').mockImplementation(() => ({
      ...tip.rect, width: wrapped() ? 280 : 320, height: wrapped() ? 50 : 35,
    }));
    const scrollHeight = vi.fn(() => wrapped() ? 45 : 60);
    Object.defineProperties(tip, { scrollHeight: { get: scrollHeight }, clientHeight: { value: 45 } });
    expect(view.show(sampleContent(), makePlacement(), false, { left: 0, top: 0, kx: 1, ky: 1 })).toBe(true);
    expect(wrapped()).toBe(true);
    expect(scrollHeight).toHaveBeenCalledTimes(2);
    expect(measure).toHaveBeenCalledTimes(2);
    expect(view.rect()).toMatchObject({ width: 280, height: 50 });
    view.destroy();
  });

  it('keeps controls and their queried nodes across equivalent streaming revisions', () => {
    const doc = new MockDocument();
    const chart = buildLineInteraction(doc, doc.body, 'stream');
    const { committed, interaction, fig, firstBox } = chart;
    const state = { ...committed, streaming: true };
    expect(interaction.prepare(state)).toBe(true);
    interaction.commit(state);
    (fig.stage as unknown as MockElement).dispatchEvent(new MockEvent('pointermove', { clientX: firstBox.x, clientY: firstBox.y }));
    const controls = fig.controls as unknown as MockElement;
    const pause = controls.querySelectorAll('button').find(button => button.textContent === defaultMessages.pause)!;
    const rendered = vi.spyOn(pause.classList, 'toggle');
    const query = vi.spyOn(fig.figure as unknown as MockElement, 'querySelectorAll');
    const next = { ...state, view: { ...state.view }, english: () => null };
    expect(interaction.prepare(next)).toBe(false);
    interaction.commit(next);
    expect(rendered).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(interaction.prepare({ ...next, paused: true })).toBe(true);
    expect(pause.textContent).toBe(defaultMessages.resume);
    interaction.destroy();
  });
});

describe('Bug 2 & 3: cross-realm tooltip buttons and stale press state', () => {
  it('cross-realm buttons work without instanceof HTMLButtonElement', () => {
    const doc = new MockDocument();
    const fig = doc.createElement('figure');
    const tip = doc.createElement('div');
    const readout = doc.createElement('div');
    fig.append(tip, readout);
    doc.body.appendChild(fig);

    const selected: DatumText[] = [];
    const moreCalls: number[] = [];
    const view = createTooltip(tip as unknown as HTMLElement, readout as unknown as HTMLElement, fig as unknown as HTMLElement, () => {});
    const shown = view.show(sampleContent({ select: r => selected.push(r), more: n => moreCalls.push(n) }), makePlacement(), true);
    expect(shown).toBe(true);

    const rowBtns = tip.querySelectorAll('button.axylo-tooltip-row');
    expect(rowBtns).toHaveLength(2);
    expect(rowBtns[0]!.type).toBe('button');
    expect(rowBtns[0]!.tabIndex).toBe(-1);
    expect(rowBtns[0]!.classList.contains('axylo-tooltip-choice')).toBe(true);

    const moreBtn = tip.querySelector('button.axylo-tooltip-more');
    expect(moreBtn).not.toBeNull();
    expect(moreBtn!.type).toBe('button');
    expect(moreBtn!.tabIndex).toBe(-1);
    expect(moreBtn!.classList.contains('axylo-tooltip-choice')).toBe(true);

    rowBtns[0]!.dispatchEvent(new MockEvent('click', { detail: 0 }));
    moreBtn!.dispatchEvent(new MockEvent('click', { detail: 0 }));
    expect(selected.map(r => r.seriesLabel)).toEqual(['Alpha']);
    expect(moreCalls).toEqual([2]);
    view.destroy();
  });

  it('clears press and document listeners on outside pointerup, outside pointercancel, non-row pointerdown, hide, and destroy', () => {
    const doc = new MockDocument();
    const fig = doc.createElement('figure');
    const tip = doc.createElement('div');
    const readout = doc.createElement('div');
    const outside = doc.createElement('div');
    fig.append(tip, readout);
    doc.body.append(fig, outside);

    const selected: DatumText[] = [];
    const moreCalls: number[] = [];
    const view = createTooltip(tip as unknown as HTMLElement, readout as unknown as HTMLElement, fig as unknown as HTMLElement, () => {});
    view.show(sampleContent({ select: r => selected.push(r), more: n => moreCalls.push(n) }), makePlacement(), true);

    const row0 = tip.querySelectorAll('button.axylo-tooltip-row')[0]!;
    const title = tip.querySelector('.axylo-tooltip-title')!;
    const moreBtn = tip.querySelector('button.axylo-tooltip-more')!;

    // 1. Press row0, drag off, release outside -> press cleared and doc listeners cleaned up.
    row0.dispatchEvent(new MockEvent('pointerdown', { pointerId: 7 }));
    expect(doc.listenerCount('pointerup')).toBe(1);
    expect(doc.listenerCount('pointercancel')).toBe(1);

    // Non-matching pointerId outside does not clear press.
    outside.dispatchEvent(new MockEvent('pointerup', { pointerId: 99 }));
    expect(doc.listenerCount('pointerup')).toBe(1);

    // Matching pointerId outside clears press and removes doc listeners.
    outside.dispatchEvent(new MockEvent('pointerup', { pointerId: 7 }));
    expect(doc.listenerCount('pointerup')).toBe(0);
    expect(doc.listenerCount('pointercancel')).toBe(0);

    // Subsequent click on +N more does NOT select stale row0.
    moreBtn.dispatchEvent(new MockEvent('pointerdown', { pointerId: 8 }));
    moreBtn.dispatchEvent(new MockEvent('pointerup', { pointerId: 8 }));
    moreBtn.dispatchEvent(new MockEvent('click', { detail: 1 }));
    expect(selected).toEqual([]);
    expect(moreCalls).toEqual([2]);

    // 2. Press row0, then pointerdown on title (outside row button) -> clears press before pointerup.
    row0.dispatchEvent(new MockEvent('pointerdown', { pointerId: 10 }));
    expect(doc.listenerCount('pointerup')).toBe(1);
    title.dispatchEvent(new MockEvent('pointerdown', { pointerId: 10 }));
    expect(doc.listenerCount('pointerup')).toBe(0);
    title.dispatchEvent(new MockEvent('pointerup', { pointerId: 10 }));
    expect(selected).toEqual([]);

    // 3. Press row0, then document pointercancel -> clears press and doc listeners.
    row0.dispatchEvent(new MockEvent('pointerdown', { pointerId: 11 }));
    outside.dispatchEvent(new MockEvent('pointercancel', { pointerId: 11 }));
    expect(doc.listenerCount('pointerup')).toBe(0);
    title.dispatchEvent(new MockEvent('pointerup', { pointerId: 11 }));
    expect(selected).toEqual([]);

    // 4. hide() clears press and removes doc listeners immediately.
    row0.dispatchEvent(new MockEvent('pointerdown', { pointerId: 12 }));
    expect(doc.listenerCount('pointerup')).toBe(1);
    view.hide();
    expect(doc.listenerCount('pointerup')).toBe(0);
    expect(doc.listenerCount('pointercancel')).toBe(0);

    // Re-showing after hide() does not resurrect the old press.
    view.show(sampleContent({ select: r => selected.push(r) }), makePlacement(), true);
    tip.dispatchEvent(new MockEvent('pointerup', { pointerId: 12 }));
    expect(selected).toEqual([]);

    // 5. Transitioning floating -> strip while pressing preserves press (R1).
    const row0Again = tip.querySelectorAll('button.axylo-tooltip-row')[0]!;
    row0Again.dispatchEvent(new MockEvent('pointerdown', { pointerId: 13 }));
    readout.rect = { x: 0, y: 0, left: 0, top: 0, width: 400, height: 60, right: 400, bottom: 60 };
    expect(view.strip(sampleContent({ select: r => selected.push(r) }), true, { x: 0, y: 0, width: 600, height: 400 })).toBe(true);
    const stripBtn = readout.querySelector('button.axylo-readout-entry')!;
    stripBtn.dispatchEvent(new MockEvent('pointerup', { pointerId: 13 }));
    expect(selected.map(r => r.seriesLabel)).toEqual(['Alpha']);
    expect(doc.listenerCount('pointerup')).toBe(0);

    // 6. destroy() cleans up any active press listeners.
    stripBtn.dispatchEvent(new MockEvent('pointerdown', { pointerId: 14 }));
    expect(doc.listenerCount('pointerup')).toBe(1);
    view.destroy();
    expect(doc.listenerCount('pointerup')).toBe(0);
    expect(doc.listenerCount('pointercancel')).toBe(0);
  });
});

describe('Bug 1: lastShowing per-document isolation, lifecycle release (no leak), and proxy-blur recency', () => {
  it('scopes Escape ownership per Document and releases figure references on detach/clear/destroy', async () => {
    const doc1 = new MockDocument();
    const doc2 = new MockDocument();
    const a = buildLineInteraction(doc1, doc1.body, 'chart-a');
    const b = buildLineInteraction(doc2, doc2.body, 'chart-b');

    // Pin chart A in doc1, then pin chart B in doc2.
    const plotA = a.fig.plot as unknown as MockElement;
    plotA.dispatchEvent(new MockEvent('pointerdown', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 1 }));
    plotA.dispatchEvent(new MockEvent('pointerup', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 1 }));
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    const plotB = b.fig.plot as unknown as MockElement;
    plotB.dispatchEvent(new MockEvent('pointerdown', { clientX: b.firstBox.x + 1, clientY: b.firstBox.y + 1, pointerId: 2 }));
    plotB.dispatchEvent(new MockEvent('pointerup', { clientX: b.firstBox.x + 1, clientY: b.firstBox.y + 1, pointerId: 2 }));
    expect((b.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    // Blur both proxies so focus is in neither chart.
    doc1._setFocus(doc1.body);
    doc2._setFocus(doc2.body);

    // Escape in doc1 closes chart A (doc2 did not clobber doc1's lastShowing!).
    const esc1 = new MockEvent('keydown', { key: 'Escape' });
    doc1.dispatchEvent(esc1);
    expect(esc1.defaultPrevented).toBe(true);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(true);
    expect((b.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    // detach() on B hides its tooltip and releases lastShowing; Escape in doc2 is not spent.
    b.interaction.detach();
    const esc2 = new MockEvent('keydown', { key: 'Escape' });
    doc2.dispatchEvent(esc2);
    expect(esc2.defaultPrevented).toBe(false);

    // Detaching the newest of two showing charts in the same document returns Escape ownership to the older chart.
    const c = buildLineInteraction(doc1, doc1.body, 'chart-c');
    const plotC = c.fig.plot as unknown as MockElement;
    plotA.dispatchEvent(new MockEvent('pointerdown', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 3 }));
    plotA.dispatchEvent(new MockEvent('pointerup', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 3 }));
    plotC.dispatchEvent(new MockEvent('pointerdown', { clientX: c.firstBox.x + 1, clientY: c.firstBox.y + 1, pointerId: 4 }));
    plotC.dispatchEvent(new MockEvent('pointerup', { clientX: c.firstBox.x + 1, clientY: c.firstBox.y + 1, pointerId: 4 }));
    doc1._setFocus(doc1.body);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);
    expect((c.fig.tooltip as unknown as MockElement).hidden).toBe(false);
    c.interaction.detach();
    const escFallback = new MockEvent('keydown', { key: 'Escape' });
    doc1.dispatchEvent(escFallback);
    expect(escFallback.defaultPrevented).toBe(true);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(true);

    a.interaction.destroy();
    b.interaction.destroy();
    c.interaction.destroy();

    // GC check: keep the Document strongly reachable to prove the destroyed figure itself is removed from WeakMap state.
    const liveDoc = new MockDocument();
    let ref: WeakRef<object> | null = null;
    (() => {
      const temp = buildLineInteraction(liveDoc, liveDoc.body, 'chart-gc');
      const plot = temp.fig.plot as unknown as MockElement;
      plot.dispatchEvent(new MockEvent('pointerdown', { clientX: temp.firstBox.x + 1, clientY: temp.firstBox.y + 1, pointerId: 1 }));
      plot.dispatchEvent(new MockEvent('pointerup', { clientX: temp.firstBox.x + 1, clientY: temp.firstBox.y + 1, pointerId: 1 }));
      ref = new WeakRef(temp.fig.figure);
      temp.interaction.destroy();
      temp.fig.destroy();
      liveDoc.body.replaceChildren();
    })();
    if (typeof globalThis.gc === 'function') {
      for (let i = 0; i < 4; i++) {
        globalThis.gc();
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(ref!.deref()).toBeUndefined();
    }
    expect(liveDoc.body.childNodes).toHaveLength(0);
  });

  it('does not let chart A proxy-blur redraw clobber chart B recency for Escape', () => {
    const doc = new MockDocument();
    const a = buildLineInteraction(doc, doc.body, 'chart-a');
    const b = buildLineInteraction(doc, doc.body, 'chart-b');

    // 1. Click chart A -> pins A and focuses A's proxy.
    const plotA = a.fig.plot as unknown as MockElement;
    plotA.dispatchEvent(new MockEvent('pointerdown', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 1 }));
    plotA.dispatchEvent(new MockEvent('pointerup', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 1 }));
    expect((a.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(true);

    // 2. Hover chart B -> B shows hovered tooltip and becomes most recently showing.
    const stageB = b.fig.stage as unknown as MockElement;
    stageB.dispatchEvent(new MockEvent('pointermove', { clientX: b.firstBox.x + 1, clientY: b.firstBox.y + 1, pointerId: 1 }));
    expect((b.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    // 3. Focus moves away from chart A's proxy to an external button -> triggers A's onProxyBlur() redraw.
    const external = doc.createElement('button');
    doc.body.appendChild(external);
    external.focus();

    // 4. Escape (with focus in neither chart) must close B (most recent), NOT A!
    const esc1 = new MockEvent('keydown', { key: 'Escape' });
    doc.dispatchEvent(esc1);
    expect(esc1.defaultPrevented).toBe(true);
    expect((b.fig.tooltip as unknown as MockElement).hidden).toBe(true);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    // 5. Second Escape closes A (now the remaining showing chart).
    const esc2 = new MockEvent('keydown', { key: 'Escape' });
    doc.dispatchEvent(esc2);
    expect(esc2.defaultPrevented).toBe(true);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(true);

    a.interaction.destroy();
    b.interaction.destroy();
  });
});

describe('Bug 4a: Shadow DOM scroll, focus (closed shadow root), wheel, and outside-click', () => {
  it('activeElementOf reads closed shadow root focus and falls back to doc.activeElement outside', () => {
    const doc = new MockDocument();
    const host = doc.createElement('div');
    const outsideBtn = doc.createElement('button');
    doc.body.append(host, outsideBtn);
    const closed = host.attachShadow({ mode: 'closed' });
    const innerBtn = doc.createElement('button');
    closed.appendChild(innerBtn);

    expect(isElement(innerBtn)).toBe(true);
    expect(isFocusable(innerBtn)).toBe(true);
    expect(shadowRootOf(innerBtn as unknown as Node)).toBe(closed);

    innerBtn.focus();
    // Without `from`, doc.activeElement stops at closed host.
    expect(activeElementOf(doc as unknown as Document)).toBe(host);
    // With `from` inside closed shadow root, activeElementOf resolves innerBtn.
    expect(activeElementOf(doc as unknown as Document, innerBtn as unknown as Node)).toBe(innerBtn);

    // When focus moves outside the closed shadow root, activeElementOf falls back to outsideBtn.
    outsideBtn.focus();
    expect(activeElementOf(doc as unknown as Document, innerBtn as unknown as Node)).toBe(outsideBtn);
  });

  it('attaches capture scroll on ShadowRoot, handles wheel zoom and pinned tooltip presses inside closed ShadowRoot', () => {
    const doc = new MockDocument();
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const closed = host.attachShadow({ mode: 'closed' });
    const sibling = doc.createElement('button');
    closed.appendChild(sibling);

    const chart = buildLineInteraction(doc, closed, 'shadow-chart');
    // ShadowRoot has capture scroll listener attached.
    expect(closed.listenerCount('scroll')).toBe(1);

    // Pin a datum inside the closed shadow root -> proxy gets focus inside closed shadow root.
    const plot = chart.fig.plot as unknown as MockElement;
    plot.dispatchEvent(new MockEvent('pointerdown', { clientX: chart.firstBox.x + 1, clientY: chart.firstBox.y + 1, pointerId: 1 }));
    plot.dispatchEvent(new MockEvent('pointerup', { clientX: chart.firstBox.x + 1, clientY: chart.firstBox.y + 1, pointerId: 1 }));
    expect((chart.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(true);

    // Wheel zoom works because onWheel reads focus from the closed shadow root.
    const wheel = new MockEvent('wheel', { deltaY: -120, clientX: chart.firstBox.x + 1, clientY: chart.firstBox.y + 1 });
    plot.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(chart.zoomed.length).toBeGreaterThan(0);

    // Pressing on a pinned tooltip row inside the closed shadow root must NOT unpin!
    const tipRow = (chart.fig.tooltip as unknown as MockElement).querySelector('button.axylo-tooltip-row')!;
    tipRow.dispatchEvent(new MockEvent('pointerdown', { pointerId: 2 }));
    expect((chart.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(true);
    tipRow.dispatchEvent(new MockEvent('pointerup', { pointerId: 2 }));

    // Scrolling an inner element inside the ShadowRoot (composed: false) triggers onScroll redraw.
    const overlaysBefore = chart.overlays.length;
    const scroller = doc.createElement('div');
    closed.appendChild(scroller);
    scroller.dispatchEvent(new MockEvent('scroll', { bubbles: false, composed: false }));
    expect(chart.overlays.length).toBeGreaterThan(overlaysBefore);

    // Pressing on a sibling outside the chart (inside the closed shadow root) DOES unpin.
    sibling.dispatchEvent(new MockEvent('pointerdown', { pointerId: 3 }));
    expect((chart.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(false);

    // Re-pin and test pointerdown & pointerup directly targeting the closed shadow host itself (host padding).
    plot.dispatchEvent(new MockEvent('pointerdown', { clientX: chart.firstBox.x + 1, clientY: chart.firstBox.y + 1, pointerId: 4 }));
    plot.dispatchEvent(new MockEvent('pointerup', { clientX: chart.firstBox.x + 1, clientY: chart.firstBox.y + 1, pointerId: 4 }));
    expect((chart.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(true);

    // Press a pinned tooltip row inside closed shadow root, then release pointerup on the host padding itself.
    const row2 = (chart.fig.tooltip as unknown as MockElement).querySelector('button.axylo-tooltip-row')!;
    const selectedBefore = chart.selected.length;
    row2.dispatchEvent(new MockEvent('pointerdown', { pointerId: 5 }));
    expect(doc.listenerCount('pointerup')).toBe(1);
    host.dispatchEvent(new MockEvent('pointerup', { pointerId: 5 }));
    expect(doc.listenerCount('pointerup')).toBe(0);
    expect(closed.listenerCount('pointerup')).toBe(0);
    expect(host.listenerCount('pointerup')).toBe(0);
    // Subsequent click on tooltip title must not trigger select on the stale row.
    const tipTitle = (chart.fig.tooltip as unknown as MockElement).querySelector('.axylo-tooltip-title')!;
    tipTitle.dispatchEvent(new MockEvent('pointerdown', { pointerId: 6 }));
    tipTitle.dispatchEvent(new MockEvent('pointerup', { pointerId: 6 }));
    expect(chart.selected.length).toBe(selectedBefore);

    // Clicking host padding directly (pointerdown on host, never entering closed shadow root) DOES unpin!
    host.dispatchEvent(new MockEvent('pointerdown', { pointerId: 7 }));
    expect((chart.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(false);

    // Toolbar inside closed shadow root: closeTable focuses the table button via toolbar.focus('table').
    const tableBtn = (chart.fig.controls as unknown as MockElement).querySelectorAll('button').find(b => b.textContent.includes('table'))!;
    tableBtn.dispatchEvent(new MockEvent('click'));
    const scroll = (chart.fig.stage as unknown as MockElement).querySelector('.axylo-table-scroll')!;
    expect(activeElementOf(doc as unknown as Document, chart.fig.figure)).toBe(scroll);
    tableBtn.dispatchEvent(new MockEvent('click'));
    expect(activeElementOf(doc as unknown as Document, chart.fig.figure)).toBe(tableBtn);

    // Detach cleans up the ShadowRoot scroll listener.
    chart.interaction.detach();
    expect(closed.listenerCount('scroll')).toBe(0);
    chart.interaction.destroy();
  });

  it('Escape respects focus inside another chart\'s closed shadow root even when light-DOM chart registered first and showed last', () => {
    const doc = new MockDocument();
    // Chart A in light DOM, registered FIRST.
    const a = buildLineInteraction(doc, doc.body, 'light-first');
    // Chart B inside a closed shadow root, registered SECOND.
    const host = doc.createElement('div');
    doc.body.appendChild(host);
    const closed = host.attachShadow({ mode: 'closed' });
    const b = buildLineInteraction(doc, closed, 'closed-second');

    // Pin Chart B -> focus is on Chart B's proxy inside the closed shadow root.
    const plotB = b.fig.plot as unknown as MockElement;
    plotB.dispatchEvent(new MockEvent('pointerdown', { clientX: b.firstBox.x + 1, clientY: b.firstBox.y + 1, pointerId: 1 }));
    plotB.dispatchEvent(new MockEvent('pointerup', { clientX: b.firstBox.x + 1, clientY: b.firstBox.y + 1, pointerId: 1 }));
    expect((b.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(true);

    // Hover Chart A -> Chart A is now the most recently showing chart in doc!
    const stageA = a.fig.stage as unknown as MockElement;
    stageA.dispatchEvent(new MockEvent('pointermove', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 1 }));
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    // Escape must belong to Chart B (which holds focus inside its closed shadow root), leaving Chart A open!
    const esc = new MockEvent('keydown', { key: 'Escape' });
    doc.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect((b.fig.tooltip as unknown as MockElement).classList.contains('axylo-tooltip-pinned')).toBe(false);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    // Switch focused Chart B inside the closed shadow root to compact mode -> focus hands off to B's figure.
    b.interaction.commit({ ...b.committed, interactive: false });
    expect(activeElementOf(doc as unknown as Document, b.fig.figure)).toBe(b.fig.figure);
    // Hover Chart A in the same document, then press Escape: Chart A must NOT steal Escape from focused compact B!
    stageA.dispatchEvent(new MockEvent('pointermove', { clientX: a.firstBox.x + 1, clientY: a.firstBox.y + 1, pointerId: 1 }));
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);
    const escCompact = new MockEvent('keydown', { key: 'Escape' });
    doc.dispatchEvent(escCompact);
    expect(escCompact.defaultPrevented).toBe(false);
    expect((a.fig.tooltip as unknown as MockElement).hidden).toBe(false);

    a.interaction.destroy();
    b.interaction.destroy();
  });
});

describe('Bug 4b: focus restoration in closeTable, donutSliceList, and renderControls', () => {
  it('closeTable falls back to focusFigure() when toolbar table button is absent and proxy is hidden', () => {
    const doc = new MockDocument();
    const chart = buildLineInteraction(doc, doc.body, 'table-fallback');
    const tableBtn = (chart.fig.controls as unknown as MockElement).querySelectorAll('button').find(b => b.textContent.includes('table'))!;
    // Open the table (focus moves into the table scroll region).
    tableBtn.dispatchEvent(new MockEvent('click'));
    const scroll = (chart.fig.stage as unknown as MockElement).querySelector('.axylo-table-scroll')!;
    expect(activeElementOf(doc as unknown as Document)).toBe(scroll);

    // Commit a non-ready, non-inspectable state: proxy becomes hidden AND table button disappears while table closes.
    const hiddenState: Committed = {
      ...chart.committed,
      ready: false,
      inspectable: false,
      tooSmall: true,
      reader: { ...chart.committed.reader, table: null },
    };
    chart.interaction.commit(hiddenState);
    expect((chart.fig.plot as unknown as MockElement).querySelector('.axylo-proxy')!.hidden).toBe(true);
    expect(activeElementOf(doc as unknown as Document)).toBe(chart.fig.figure);
    chart.interaction.destroy();
  });

  it('donutSliceList focuses next surviving slice, preceding slice at end, or figure when empty', () => {
    const doc = new MockDocument();
    const fig = doc.createElement('figure');
    fig.className = 'axylo-figure';
    doc.body.appendChild(fig);

    const makeDonutControls = (slices: { label: string; value: number }[]): ControlsState => {
      const r = record('donut', { title: 'D', data: slices, label: 'label', value: 'value' });
      r.frames();
      const c = r.committed!;
      return {
        kind: 'donut', view: c.view, formatters: c.formatters, messages: defaultMessages, reader: c.reader,
        tooSmall: false, ready: false, inspectable: true, interactive: true, tooltip: true, legend: 'right',
        zoom: false, zoomed: false, streaming: false, paused: false, epoch: 1, english: () => null, pageLang: null,
      };
    };
    const actions: Actions = { zoom: () => {}, toggle: () => {}, pause: () => {}, select: () => {}, hover: () => {} };

    let list = donutSliceList(doc as unknown as Document, makeDonutControls([
      { label: 'A', value: 0 }, { label: 'B', value: 0 }, { label: 'C', value: 0 },
    ]), actions, null) as unknown as MockElement;
    fig.appendChild(list);

    // Focus middle slice B, then remove B -> focus moves to next surviving slice C.
    const btns1 = list.querySelectorAll('.axylo-legend-choice');
    btns1[1]!.focus();
    expect(activeElementOf(doc as unknown as Document)).toBe(btns1[1]);

    list = donutSliceList(doc as unknown as Document, makeDonutControls([
      { label: 'A', value: 0 }, { label: 'C', value: 0 },
    ]), actions, list as unknown as HTMLUListElement) as unknown as MockElement;
    const btns2 = list.querySelectorAll('.axylo-legend-choice');
    expect(activeElementOf(doc as unknown as Document)).toBe(btns2[1]);
    expect(btns2[1]!.tabIndex).toBe(0);

    // Now C (at the end) is focused; remove C -> focus moves to preceding slice A.
    list = donutSliceList(doc as unknown as Document, makeDonutControls([
      { label: 'A', value: 0 },
    ]), actions, list as unknown as HTMLUListElement) as unknown as MockElement;
    const btns3 = list.querySelectorAll('.axylo-legend-choice');
    expect(activeElementOf(doc as unknown as Document)).toBe(btns3[0]);

    // Remove A (leaving 0 slices) -> focus moves to the figure.
    list = donutSliceList(doc as unknown as Document, makeDonutControls([]), actions, list as unknown as HTMLUListElement) as unknown as MockElement;
    expect(activeElementOf(doc as unknown as Document)).toBe(fig);
  });

  it('renderControls preserves heir button focus when legend moves the toolbar across slots', () => {
    const doc = new MockDocument();
    const chart = buildLineInteraction(doc, doc.body, 'heir-move', [
      { x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 }, { x: 3, y: 40 },
    ]);
    // Commit zoomed state so Reset zoom button exists in bottom controls.
    const zoomedState: Committed = { ...chart.committed, zoomed: true, legend: 'bottom' };
    chart.interaction.commit(zoomedState);
    const buttonsBefore = (chart.fig.controls as unknown as MockElement).querySelectorAll('button');
    const resetBtn = buttonsBefore.find(b => b.textContent.includes('Reset'));
    expect(resetBtn).toBeDefined();
    resetBtn!.focus();
    expect(activeElementOf(doc as unknown as Document)).toBe(resetBtn);

    // Unzoom (removing Reset zoom -> toolbar focuses heir button) AND move legend to 'right' in one update.
    chart.interaction.commit({ ...chart.committed, zoomed: false, legend: 'right' });
    const sideButtons = (chart.fig.side as unknown as MockElement).querySelectorAll('button');
    const active = activeElementOf(doc as unknown as Document) as unknown as MockElement | null;
    expect(active).not.toBeNull();
    expect(sideButtons.includes(active!)).toBe(true);
    chart.interaction.destroy();
  });
});

describe('Bug 4c: jumpTarget handles whitespace-only categories and formatted numeric lookup', () => {
  it('jumps to a valid whitespace-only category like "   "', () => {
    const doc = new MockDocument();
    const data = Array.from({ length: 120 }, (_, i) => ({ x: i === 105 ? '   ' : `Cat ${i}`, y: i }));
    const r = record('bar', { title: 'Cats', data, x: 'x', y: 'y' });
    r.frames();
    const c = r.committed!;
    const root = doc.createElement('div');
    doc.body.appendChild(root);
    const fig = createFigure(root as unknown as HTMLElement, 'cat-jump', {
      marks: doc.createElement('svg') as unknown as Element,
      text: doc.createElement('div') as unknown as Element,
    });
    const renderer: MarkRenderer = { kind: 'svg', element: doc.createElement('svg') as unknown as SVGSVGElement, draw() {}, drawOverlay() {}, destroy() {} };
    const actions: Actions = { zoom: () => {}, toggle: () => {}, pause: () => {}, select: () => {}, hover: () => {} };
    const interaction = createInteraction(
      { overlay: alignedTargetMarks, swatch: lineSwatch, stepInSeries: null, sliceList: null },
      fig, renderer, actions,
    );
    const state: Committed = {
      kind: 'bar', view: c.view, formatters: c.formatters, messages: defaultMessages, reader: c.reader,
      tooSmall: false, ready: true, interactive: true, tooltip: true, legend: 'bottom', zoom: false, zoomed: false,
      streaming: false, paused: false, epoch: 1, english: () => null, pageLang: null,
      layout: c.layout, lookup: c.lookup, bindings: {} as PaintBindings, theme: {} as ResolvedTheme, pixelRatio: 1,
    };
    interaction.prepare(state);
    interaction.commit(state);

    // Open table and submit "   " into the jump field.
    const tableBtn = (fig.controls as unknown as MockElement).querySelector('button')!;
    tableBtn.dispatchEvent(new MockEvent('click'));
    const field = (fig.stage as unknown as MockElement).querySelector('.axylo-jump-field')!;
    const form = (fig.stage as unknown as MockElement).querySelector('.axylo-jump')!;
    field.value = '   ';
    form.dispatchEvent(new MockEvent('submit'));
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect((fig.stage as unknown as MockElement).querySelector('.axylo-page')!.textContent).toBe('Page 2 of 2');
    interaction.destroy();
  });

  it('prefers printed-value lookup when a formatted number does not round-trip to the entered text', () => {
    const doc = new MockDocument();
    // 150 fractional x values formatted as percentages: x = 1.25 -> "125%" on page 2 (row 125).
    // parseNumberAs("125%") parses raw 125, whose formatters.x(125) is "12,500%" !== "125%".
    const data = Array.from({ length: 150 }, (_, i) => ({ x: i / 100, y: i }));
    const fmt = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 });
    const chart = buildLineInteraction(doc, doc.body, 'pct-jump', data, {
      x: { field: 'x', format: (v: unknown) => fmt.format(Number(v)) },
    });
    const buttons = (chart.fig.controls as unknown as MockElement).querySelectorAll('button');
    const tableBtn = buttons.find(b => b.textContent.includes('table'))!;
    tableBtn.dispatchEvent(new MockEvent('click'));

    const field = (chart.fig.stage as unknown as MockElement).querySelector('.axylo-jump-field')!;
    const form = (chart.fig.stage as unknown as MockElement).querySelector('.axylo-jump')!;
    field.value = '125%';
    form.dispatchEvent(new MockEvent('submit'));
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect((chart.fig.stage as unknown as MockElement).querySelector('.axylo-page')!.textContent).toBe('Page 2 of 2');
    // Confirm the 125% row is on this page (and did not jump to the last row via raw 125).
    const headers = (chart.fig.stage as unknown as MockElement).querySelector('tbody')!.querySelectorAll('th').map(th => th.textContent);
    expect(headers).toContain('125%');

    // A raw number with no exact printed match still falls back to parsed raw value (e.g. 0.05 -> page 1).
    field.value = '0.05';
    form.dispatchEvent(new MockEvent('submit'));
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect((chart.fig.stage as unknown as MockElement).querySelector('.axylo-page')!.textContent).toBe('Page 1 of 2');
    chart.interaction.destroy();
  });
});
