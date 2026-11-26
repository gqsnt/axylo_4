/**
 * The chart's one toolbar (spec A2, I2, I3, I4, I6): roving-tabindex buttons kept by key.
 */
import { Listeners } from './mapping';
import { createSwatch, type SwatchSpec } from './swatch';
import { activeElementOf, placeChildren, setAttr, make, svgElement } from './attributes';

export function rovingIndex(e: KeyboardEvent, at: number, n: number): number | null {
  if (!n || e.altKey || e.ctrlKey || e.metaKey) return null;
  const k = e.key;
  return k === 'ArrowRight' || k === 'ArrowDown' ? (at + 1) % n
    : k === 'ArrowLeft' || k === 'ArrowUp' ? (at - 1 + n) % n
    : k === 'Home' ? 0 : k === 'End' ? n - 1 : null;
}

export interface ToolbarItem {
  readonly key: string;
  readonly label: string;
  readonly pressed?: boolean;
  readonly expanded?: boolean;
  readonly controls?: string | null;
  readonly swatch?: SwatchSpec;
  readonly struck?: boolean;
  readonly lang: string | null;
  readonly className: string;
  readonly symbol?: 'range';
  readonly disabled?: boolean;
  activate(): void;
}

export interface Toolbar {
  readonly element: HTMLElement;
  render(items: readonly ToolbarItem[], label: string, lang: string | null): void;
  focus(key: string): boolean;
  destroy(): void;
}

function itemSignature(item: ToolbarItem): string {
  const swatch = item.swatch;
  const key = `${item.label.length}:${item.label}:${item.struck === true}:${item.symbol ?? ''}`;
  if (!swatch) return key;
  const { color, cue, line, hollow, fill, marker, pattern } = swatch;
  return `${key}:${color}:${line}:${hollow}:${fill === true}:${marker === true}:${cue?.marker ?? ''}:${cue?.dash.normal ?? ''}:${cue?.dash.contrast ?? ''}:${pattern?.kind ?? ''}:${pattern?.d ?? ''}`;
}

function rangeSymbol(doc: Document): SVGSVGElement {
  const svg = svgElement(doc, 'svg', { viewBox: '0 0 16 16', width: '16', height: '16', 'aria-hidden': 'true', class: 'axylo-symbol' });
  svg.append(svgElement(doc, 'path', { d: 'M2 2v12M14 2v12M4.5 8h7M4.5 8l2.5-2.5M4.5 8l2.5 2.5M11.5 8l-2.5-2.5M11.5 8l-2.5 2.5' }));
  return svg;
}

interface ButtonEntry {
  readonly b: HTMLButtonElement;
  i: ToolbarItem;
  s: string;
}

export function createToolbar(doc: Document): Toolbar {
  const element = make(doc, 'div', 'axylo-toolbar');
  setAttr(element, 'role', 'toolbar');
  const listening = new Listeners();
  const buttons = new Map<string, ButtonEntry>();
  let current: string | null = null, order: string[] = [];
  const active = () => activeElementOf(doc, element);
  const setCurrent = (key: string | null) => { current = key; for (const [k, { b }] of buttons) b.tabIndex = k === current ? 0 : -1; };

  listening.on(element, 'keydown', e => {
    const next = rovingIndex(e, current === null ? -1 : order.indexOf(current), order.length);
    if (next === null) return;
    const key = order[next]!;
    setCurrent(key);
    buttons.get(key)!.b.focus();
    e.preventDefault();
  });
  listening.on(element, 'focusin', (e: FocusEvent) => {
    for (const [k, { b }] of buttons) if (b === e.target) setCurrent(k);
  });
  listening.on(element, 'click', e => {
    for (const { b, i } of buttons.values()) if (b.contains(e.target as Node) && !i.disabled) { i.activate(); return; }
  });

  return {
    element,
    render(items, label, lang) {
      setAttr(element, 'aria-label', label);
      setAttr(element, 'lang', lang);
      const focused = buttons.size ? active() : null;
      let focusedKey: string | null = null;
      for (const [k, { b }] of buttons) if (b === focused) focusedKey = k;
      const keys = items.map(i => i.key);
      let heir: string | null = null;
      if (focusedKey !== null && !keys.includes(focusedKey)) {
        const was = order.indexOf(focusedKey);
        for (let i = was + 1; i < order.length && !heir; i++) if (keys.includes(order[i]!)) heir = order[i]!;
        for (let i = was - 1; i >= 0 && !heir; i--) if (keys.includes(order[i]!)) heir = order[i]!;
        heir ??= keys[0] ?? null;
      }
      for (const k of buttons.keys()) if (!keys.includes(k)) buttons.delete(k);
      const nodes: HTMLButtonElement[] = [];
      for (const item of items) {
        let e = buttons.get(item.key);
        const previous = e?.i;
        if (!e) {
          const b = doc.createElement('button');
          b.type = 'button';
          buttons.set(item.key, e = { b, i: item, s: '' });
        }
        e.i = item;
        const { b } = e, sig = itemSignature(item);
        if (sig !== e.s) {
          const ch: Node[] = [];
          if (item.swatch) ch.push(createSwatch(doc, item.swatch));
          if (item.symbol) ch.push(rangeSymbol(doc));
          const t = make(doc, 'span', item.symbol ? 'axylo-control-label axylo-visually-hidden' : 'axylo-control-label');
          t.textContent = item.label;
          ch.push(t);
          b.replaceChildren(...ch);
          setAttr(b, 'title', item.symbol ? item.label : null);
          e.s = sig;
        }
        if (previous?.className !== item.className || !!previous.struck !== !!item.struck) {
          b.className = item.struck ? `${item.className} axylo-struck` : item.className;
        }
        if (previous?.pressed !== item.pressed) setAttr(b, 'aria-pressed', item.pressed === undefined ? null : String(item.pressed));
        if (previous?.expanded !== item.expanded) setAttr(b, 'aria-expanded', item.expanded === undefined ? null : String(item.expanded));
        const controls = item.expanded ? item.controls ?? null : null;
        if ((previous?.expanded ? previous.controls ?? null : null) !== controls) setAttr(b, 'aria-controls', controls);
        if ((previous?.lang ?? null) !== item.lang) setAttr(b, 'lang', item.lang);
        if (!!previous?.disabled !== !!item.disabled) {
          setAttr(b, 'aria-disabled', item.disabled ? 'true' : null);
        }
        nodes.push(b);
      }
      placeChildren(element, nodes);
      order = keys;
      setCurrent(heir ?? (current !== null && keys.includes(current) ? current : keys[0] ?? null));
      const target = heir ?? focusedKey, btn = target !== null ? buttons.get(target)?.b : undefined;
      if (btn && (heir !== null || active() !== btn)) btn.focus();
    },
    focus(key) { const b = buttons.get(key)?.b; if (!b) return false; b.focus(); return active() === b; },
    destroy() { listening.clear(); element.remove(); buttons.clear(); },
  };
}
