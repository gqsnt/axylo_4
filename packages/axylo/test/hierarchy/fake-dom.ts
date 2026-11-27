/**
 * The smallest DOM the hierarchy host uses, for Node tests of the public handles: elements with attributes,
 * children, text, CSSOM style, listeners and focus. Plot elements report a fixed size so layouts are drawn.
 */
export class FakeStyle {
  readonly props = new Map<string, string>();
  setProperty(name: string, value: string): void { this.props.set(name, value); }
  removeProperty(name: string): void { this.props.delete(name); }
  getPropertyValue(name: string): string { return this.props.get(name) ?? ''; }
}

type Handler = (e: unknown) => void;

export class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly style = new FakeStyle();
  parentNode: FakeElement | null = null;
  private text = '';
  private readonly handlers = new Map<string, Set<Handler>>();
  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string, readonly namespaceURI: string | null = null) {}

  get id(): string { return this.attributes.get('id') ?? ''; }
  get hidden(): boolean { return this.attributes.has('hidden'); }
  set hidden(v: boolean) { if (v) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get firstChild(): FakeElement | null { return this.children[0] ?? null; }
  get isConnected(): boolean {
    let e: FakeElement | null = this;
    while (e) { if (e === this.ownerDocument.documentElement) return true; e = e.parentNode; }
    return false;
  }
  get clientWidth(): number { return this.attributes.get('class')?.includes('axylo-h-plot') ? this.ownerDocument.plotSize.width : 0; }
  get clientHeight(): number { return this.attributes.get('class')?.includes('axylo-h-plot') ? this.ownerDocument.plotSize.height : 0; }
  get offsetWidth(): number { return 0; }
  get offsetHeight(): number { return 0; }
  get textContent(): string { return this.children.length ? this.children.map(c => c.textContent).join('') : this.text; }
  set textContent(v: string) { for (const c of this.children) c.parentNode = null; this.children.length = 0; this.text = v; }

  setAttribute(name: string, value: string): void { this.attributes.set(name, String(value)); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string): void { this.attributes.delete(name); }
  hasAttribute(name: string): boolean { return this.attributes.has(name); }

  appendChild(child: FakeElement): FakeElement { return this.insertBefore(child, null); }
  append(...nodes: FakeElement[]): void { for (const n of nodes) this.appendChild(n); }
  insertBefore(child: FakeElement, before: FakeElement | null): FakeElement {
    child.remove();
    const at = before ? this.children.indexOf(before) : -1;
    if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
    child.parentNode = this;
    return child;
  }
  replaceChildren(...nodes: FakeElement[]): void {
    for (const c of this.children) c.parentNode = null;
    this.children.length = 0;
    this.text = '';
    for (const n of nodes) this.appendChild(n);
  }
  replaceWith(other: FakeElement): void {
    const p = this.parentNode;
    if (!p) return;
    p.insertBefore(other, this);
    this.remove();
  }
  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    p.children.splice(p.children.indexOf(this), 1);
    this.parentNode = null;
  }
  contains(other: FakeElement | null): boolean {
    for (let e = other; e; e = e.parentNode) if (e === this) return true;
    return false;
  }
  getRootNode(): FakeDocument { return this.ownerDocument; }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight };
  }
  focus(): void { this.ownerDocument.activeElement = this; this.dispatch('focus', {}); }
  blur(): void { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; this.dispatch('blur', {}); }
  addEventListener(type: string, h: Handler): void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, set = new Set());
    set.add(h);
  }
  removeEventListener(type: string, h: Handler): void { this.handlers.get(type)?.delete(h); }
  listenerCount(): number { let n = 0; for (const s of this.handlers.values()) n += s.size; return n; }
  dispatch(type: string, event: Record<string, unknown>): { defaultPrevented: boolean } {
    const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...event };
    for (const h of [...this.handlers.get(type) ?? []]) h(e);
    return e;
  }

  /** Every descendant (depth first) that satisfies `test`. */
  all(test: (e: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (e: FakeElement) => { for (const c of e.children) { if (test(c)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  find(test: (e: FakeElement) => boolean): FakeElement | null { return this.all(test)[0] ?? null; }
}

export class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly defaultView = null;
  plotSize = { width: 600, height: 400 };
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  constructor() {
    this.documentElement = new FakeElement(this, 'HTML');
    this.documentElement.setAttribute('lang', 'en-US');
    this.body = new FakeElement(this, 'BODY');
    this.documentElement.appendChild(this.body);
  }
  createElement(name: string): FakeElement { return new FakeElement(this, name.toUpperCase()); }
  createElementNS(ns: string, name: string): FakeElement { return new FakeElement(this, name, ns); }
}

/** A target element in a fresh fake document, typed as the DOM the host expects. */
export function fakeTarget(size = { width: 600, height: 400 }): { doc: FakeDocument; target: HTMLElement; host: FakeElement } {
  const doc = new FakeDocument();
  doc.plotSize = size;
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  return { doc, target: host as unknown as HTMLElement, host };
}
