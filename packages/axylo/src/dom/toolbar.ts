/**
 * The chart's one toolbar (spec A2, I2, I3, I4, I6): legend toggles, zoom, pause and the table control, as
 * ordinary buttons with roving focus, so the whole toolbar is a single tab stop. Arrow keys move between
 * controls, Home and End jump to the ends.
 *
 * Buttons are kept by key and updated in place, so a control the reader is on keeps focus across commits.
 * When the control that has focus goes away (Reset after resetting, Pause before any append), focus moves to
 * its neighbour instead of falling back to the page.
 */
import { createSwatch, type SwatchSpec } from './swatch';

export interface ToolbarItem {
  readonly key: string;
  readonly label: string;
  /** Toggle buttons (legend entries): aria-pressed. */
  readonly pressed?: boolean;
  /** Disclosure buttons (the table control): aria-expanded and, while expanded, aria-controls. */
  readonly expanded?: boolean;
  readonly controls?: string | null;
  readonly swatch?: SwatchSpec;
  /** A hidden series: struck-through name, outline swatch (never dimmed text, spec L2). */
  readonly struck?: boolean;
  /** `lang` of the button ('en' for built-in text on a page in another language), or null. */
  readonly lang: string | null;
  readonly className: string;
  activate(): void;
}

export interface Toolbar {
  readonly element: HTMLElement;
  render(items: readonly ToolbarItem[], label: string, lang: string | null): void;
  destroy(): void;
}

function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function createToolbar(doc: Document): Toolbar {
  const element = doc.createElement('div');
  element.className = 'axylo-toolbar';
  element.setAttribute('role', 'toolbar');
  const buttons = new Map<string, { button: HTMLButtonElement; item: ToolbarItem; signature: string }>();
  let current: string | null = null;
  let order: string[] = [];

  function setCurrent(key: string | null): void {
    current = key;
    for (const [k, { button }] of buttons) button.tabIndex = k === current ? 0 : -1;
  }

  function move(to: number): void {
    if (!order.length) return;
    const key = order[(to + order.length) % order.length]!;
    setCurrent(key);
    buttons.get(key)!.button.focus();
  }

  element.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const at = current === null ? -1 : order.indexOf(current);
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': move(at + 1); break;
      case 'ArrowLeft': case 'ArrowUp': move(at - 1); break;
      case 'Home': move(0); break;
      case 'End': move(order.length - 1); break;
      default: return;
    }
    event.preventDefault();
  });
  element.addEventListener('focusin', (event: FocusEvent) => {
    for (const [key, { button }] of buttons) if (button === event.target) setCurrent(key);
  });

  function fill(button: HTMLButtonElement, item: ToolbarItem): void {
    const children: Node[] = [];
    if (item.swatch) children.push(createSwatch(doc, item.swatch));
    const text = doc.createElement('span');
    text.className = 'axylo-control-label';
    text.textContent = item.label;
    children.push(text);
    button.replaceChildren(...children);
  }

  return {
    element,
    render(items, label, lang) {
      setAttr(element, 'aria-label', label);
      setAttr(element, 'lang', lang);
      const focused = doc.activeElement;
      let focusedKey: string | null = null;
      for (const [key, { button }] of buttons) if (button === focused) focusedKey = key;
      const keys = items.map(i => i.key);
      // Where a focused control that is going away hands focus: the control now at its place, or the last.
      let heir: string | null = null;
      if (focusedKey !== null && !keys.includes(focusedKey)) {
        const was = order.indexOf(focusedKey);
        const after = order.slice(was + 1).find(k => keys.includes(k));
        const before = order.slice(0, was).reverse().find(k => keys.includes(k));
        heir = after ?? before ?? keys[0] ?? null;
      }
      for (const [key, entry] of buttons) {
        if (!keys.includes(key)) {
          entry.button.remove();
          buttons.delete(key);
        }
      }
      let previous: HTMLButtonElement | null = null;
      for (const item of items) {
        let entry = buttons.get(item.key);
        if (!entry) {
          const button = doc.createElement('button');
          button.type = 'button';
          button.addEventListener('click', () => buttons.get(item.key)?.item.activate());
          entry = { button, item, signature: '' };
          buttons.set(item.key, entry);
        }
        entry.item = item;
        const { button } = entry;
        const signature = JSON.stringify([item.label, item.swatch, item.struck]);
        if (signature !== entry.signature) {
          fill(button, item);
          entry.signature = signature;
        }
        if (button.className !== item.className) button.className = item.className;
        button.classList.toggle('axylo-struck', item.struck === true);
        setAttr(button, 'aria-pressed', item.pressed === undefined ? null : String(item.pressed));
        setAttr(button, 'aria-expanded', item.expanded === undefined ? null : String(item.expanded));
        setAttr(button, 'aria-controls', item.expanded ? item.controls ?? null : null);
        setAttr(button, 'lang', item.lang);
        const place: ChildNode | null = previous ? previous.nextSibling : element.firstChild;
        if (place !== button) element.insertBefore(button, place);
        previous = button;
      }
      order = keys;
      const keep = heir ?? (current !== null && keys.includes(current) ? current : keys[0] ?? null);
      setCurrent(keep);
      if (heir !== null) buttons.get(heir)!.button.focus();
    },
    destroy() {
      element.remove();
      buttons.clear();
    },
  };
}
