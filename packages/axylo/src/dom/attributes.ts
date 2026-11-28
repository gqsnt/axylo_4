/** Writes an attribute only when it changes; null removes it. Shared by the figure and its controls. */
export function setAttr(el: Element, name: string, value: string | null, fresh = false): void {
  if ((fresh ? null : el.getAttribute(name)) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** Cross-realm safe check for an Element node (works across iframes). */
export const isElement = (node: unknown): node is Element => node !== null && typeof node === 'object' && (node as Node).nodeType === 1;

/** Cross-realm safe check for a focusable Element (HTMLElement / SVGElement across iframes). */
export const isFocusable = (node: unknown): node is HTMLElement => isElement(node) && typeof (node as HTMLElement).focus === 'function';

export const focusQuiet = (el: HTMLElement): void => el.focus({ preventScroll: true });

/** Gives focus a resting place when an active chart control is removed. */
export function focusContainer(el: Element | null): void {
  if (!isFocusable(el)) return;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  focusQuiet(el);
}

/** Cross-realm safe ShadowRoot lookup for a node, or null when not in a shadow tree. */
export function shadowRootOf(node: Node): ShadowRoot | null {
  const root = node.getRootNode?.();
  return root && root.nodeType === 11 && 'host' in root ? root as ShadowRoot : null;
}

/** All enclosing ShadowRoots from innermost to outermost (cross-realm safe). */
export function shadowRootsOf(node: Node): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  for (let cur: Node | null = node, r: ShadowRoot | null; cur && (r = shadowRootOf(cur)); cur = r.host) roots.push(r);
  return roots;
}

/**
 * Calls `onOutside` for `type` events on `doc` (and enclosing shadow roots) that did not hit any element in
 * `inside`, including events targeting a closed shadow host directly (which never enter its shadow root).
 */
export function listenOutside(
  doc: Document, roots: readonly ShadowRoot[], type: string, inside: readonly Element[],
  onOutside: (event: Event) => void, signal: AbortSignal,
): void {
  const seen = new WeakSet<Event>();
  const fire = (e: Event) => { if (!seen.has(e)) { seen.add(e); onOutside(e); } };
  const check = (e: Event) => {
    if (seen.has(e)) return;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [], target = e.target as Node | null;
    if (inside.some(el => path.includes(el) || (target !== null && el.contains(target)))) { seen.add(e); return; }
    if (roots.some(r => r !== e.currentTarget && !path.includes(r) && path.includes(r.host))) return;
    fire(e);
  };
  doc.addEventListener(type, check, { capture: true, signal });
  for (const r of roots) { r.addEventListener(type, check, { capture: true, signal }); r.host.addEventListener(type, fire, { signal }); }
}

/** The element that has focus, through open shadow roots and (when `from` is given) its own closed shadow root. */
export function activeElementOf(doc: Document, from?: Node | null): Element | null {
  const root = from ? shadowRootOf(from) : null;
  let at: Element | null = root?.activeElement ?? doc.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

/** Writes text only when it changes. */
export function setText(node: Node, text: string): void {
  if (text && node.nodeType === 1) {
    const child = node.firstChild;
    if (child?.nodeType === 3 && !child.nextSibling) { if (child.textContent !== text) child.textContent = text; return; }
  }
  if (node.textContent !== text) node.textContent = text;
}

export function setLanguageText(el: Element, text: string, lang: string | null): void {
  setAttr(el, 'lang', lang);
  setText(el, text);
}

/** Shared by text changes that intentionally speak, even when the words repeat. */
export function announceText(el: HTMLElement, text: string, lang: string | null): void {
  setAttr(el, 'lang', lang);
  if (el.textContent !== text) el.textContent = text;
  else if (text) el.replaceChildren(el.ownerDocument.createTextNode(text));
}

/** Puts exactly `wanted`, in order, into `host`, moving a node only when it is out of place. */
export function placeChildren(host: Node, wanted: readonly Node[]): void {
  let at: ChildNode | null = host.firstChild;
  for (let i = 0; i < wanted.length; i++) {
    const node = wanted[i]!;
    if (at === node) at = at.nextSibling;
    else host.insertBefore(node, at);
  }
  while (at) { const next: ChildNode | null = at.nextSibling; at.remove(); at = next; }
}

/** A new element of `tag` with `className`. */
export function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  el.className = className;
  return el;
}

export const keepFocusOnPress = (event: Event): void => event.preventDefault();
export const hideFromAT = (el: Element): void => el.setAttribute('aria-hidden', 'true');

/** Initial attributes for a new SVG node. Updates to reused marks have their own cache. */
export function svgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document, tag: K, attrs?: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const k in attrs) if (Object.hasOwn(attrs, k)) el.setAttribute(k, attrs[k]!);
  return el;
}
