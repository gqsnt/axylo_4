/** Writes an attribute only when it changes; null removes it. Shared by the figure and its controls. */
export function setAttr(el: Element, name: string, value: string | null, fresh = false): void {
  if ((fresh ? null : el.getAttribute(name)) === value) return;
  if (value === null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

/** Cross-realm safe check for an Element node (works across iframes). */
export function isElement(node: unknown): node is Element {
  return node !== null && typeof node === 'object' && (node as Node).nodeType === 1;
}

/** Cross-realm safe check for a focusable Element (HTMLElement / SVGElement across iframes). */
export function isFocusable(node: unknown): node is HTMLElement {
  return isElement(node) && typeof (node as HTMLElement).focus === 'function';
}

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
  return root !== undefined && root !== null && root.nodeType === 11 && 'host' in root ? (root as ShadowRoot) : null;
}

/** All enclosing ShadowRoots from innermost to outermost (cross-realm safe). */
export function shadowRootsOf(node: Node): ShadowRoot[] {
  const roots: ShadowRoot[] = [];
  let cur: Node | null = node;
  while (cur) {
    const root = shadowRootOf(cur);
    if (!root) break;
    roots.push(root);
    cur = root.host;
  }
  return roots;
}

/**
 * Calls `onOutside` for `type` events on `doc` (and enclosing shadow roots) that did not hit any element in
 * `inside`, including events targeting a closed shadow host directly (which never enter its shadow root).
 */
export function listenOutside(
  doc: Document,
  roots: readonly ShadowRoot[],
  type: string,
  inside: readonly Element[],
  onOutside: (event: Event) => void,
  signal: AbortSignal,
): void {
  const seen = new WeakSet<Event>();
  const check = (event: Event) => {
    if (seen.has(event)) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const target = event.target as Node | null;
    if (inside.some(el => path.includes(el) || (target !== null && el.contains(target)))) {
      seen.add(event);
      return;
    }
    // Inside a closed shadow root, an outer capture listener's composedPath stops at its host; wait for that root.
    if (roots.some(r => r !== event.currentTarget && !path.includes(r) && path.includes(r.host))) return;
    seen.add(event);
    onOutside(event);
  };
  const onHost = (event: Event) => {
    if (seen.has(event)) return;
    seen.add(event);
    onOutside(event);
  };
  doc.addEventListener(type, check, { capture: true, signal });
  for (const root of roots) {
    root.addEventListener(type, check, { capture: true, signal });
    // If the event targeted the closed host itself (e.g. host padding), root capture never ran; catch it here.
    root.host.addEventListener(type, onHost, { signal });
  }
}

/**
 * The element that has focus, through open shadow roots and (when `from` is given) its own closed shadow
 * root (`document.activeElement` stops at a closed host): where focus is, for Escape's owner, for handing
 * focus on, and for teardown (review R2).
 */
export function activeElementOf(doc: Document, from?: Node | null): Element | null {
  const root = from ? shadowRootOf(from) : null;
  let at: Element | null = root ? root.activeElement : doc.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  if (at === null && root) {
    at = doc.activeElement;
    while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  }
  return at;
}

/** Writes text only when it changes. */
export function setText(node: Node, text: string): void {
  if (text !== '' && node.nodeType === 1) {
    const child = node.firstChild;
    if (child?.nodeType === 3 && child.nextSibling === null) {
      // Reuse the text node when readouts or summaries change on each frame.
      if (child.textContent !== text) child.textContent = text;
      return;
    }
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
  while (at) {
    const next: ChildNode | null = at.nextSibling;
    at.remove();
    at = next;
  }
}

/** A new element of `tag` with `className`. */
export function make<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  el.className = className;
  return el;
}

/** A press that must not take focus (it keeps the plot's keyboard reading). */
export const keepFocusOnPress = (event: Event): void => event.preventDefault();

/** Hides an element from assistive technology. */
export const hideFromAT = (el: Element): void => el.setAttribute('aria-hidden', 'true');

/** Initial attributes for a new SVG node. Updates to reused marks have their own cache. */
export function svgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document, tag: K, attrs?: Readonly<Record<string, string>>,
): SVGElementTagNameMap[K] {
  const el = doc.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (const key in attrs) if (Object.hasOwn(attrs, key)) el.setAttribute(key, attrs[key]!);
  }
  return el;
}
