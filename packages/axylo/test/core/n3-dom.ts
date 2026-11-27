/**
 * A copy of the minimal DOM of test/dom/lazy-dom-footprint.test.ts (that file registers tests, so it cannot be
 * imported), exported for the N3 interaction tests in Node. Kept verbatim apart from the exports.
 */

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

export class TestEvent {
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

export class TestElement extends TestEventTarget implements TestNode {
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

export class TestDocument extends TestEventTarget {
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

