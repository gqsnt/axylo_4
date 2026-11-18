/** Writes an attribute only when it changes; null removes it. Shared by the figure and its controls. */
export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

/**
 * The element that has focus, through open shadow roots (`document.activeElement` is only the outermost
 * host): where focus is, for Escape's owner, for handing focus on, and for teardown (review R2).
 */
export function activeElementOf(doc: Document): Element | null {
  let at: Element | null = doc.activeElement;
  while (at?.shadowRoot?.activeElement) at = at.shadowRoot.activeElement;
  return at;
}

/** Writes text only when it changes. */
export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Puts exactly `wanted`, in order, into `host`, moving a node only when it is out of place. */
export function placeChildren(host: Node, wanted: readonly Node[]): void {
  let at: ChildNode | null = host.firstChild;
  for (const node of wanted) {
    if (at !== node) host.insertBefore(node, at);
    at = (node as ChildNode).nextSibling;
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
