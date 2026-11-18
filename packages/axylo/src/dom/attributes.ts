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
