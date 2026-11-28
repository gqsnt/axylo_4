/**
 * What the plot says to assistive technology (spec A2–A4): the instructions under the proxy, and the
 * document-wide registries that decide which chart a keyboard or Escape outside every chart belongs to.
 */
import { defaultMessages, messageLanguage } from '../messages';
import { activeElementOf, isElement, setAttr, setLanguageText, setText, shadowRootOf } from './attributes';
import { offersZoom } from './interaction-controls';
import { plotReady, readable } from './interaction-nav';
import type { Committed, InstructionKey } from './interaction-types';

export function instructionSeries(d: Committed, hasData = plotReady(d) && readable(d)): number {
  if (!d.interactive || !hasData || d.lookup.count === 0) return 0;
  const { view } = d;
  if (view.kind === 'donut' || view.visible.length <= 1) return 1;
  let count = 0;
  for (let i = 0; i < view.visible.length; i++) {
    if (view.visible[i] && (view.kind !== 'scatter' || view.visiblePoints[i]!.end > view.visiblePoints[i]!.start) && ++count === 2) return 2;
  }
  return 1;
}

export const plotDescription = (d: Committed) => descriptionFor(d, instructionSeries(d));

export function descriptionFor(d: Committed, count: number): { text: string; lang: string | null }[] {
  if (!d.interactive || !plotReady(d)) return [];
  const { messages, view } = d, legacy = messageLanguage(messages, 'plotInstructions') === null;
  const out: { text: string; lang: string | null }[] = [];
  const add = (key: InstructionKey, fb?: 'plotInstructions') => {
    if (legacy && messageLanguage(messages, key) !== null) { if (!fb) return; key = fb; }
    const text = messages[key] ?? defaultMessages[key];
    if (text) out.push({ text, lang: d.english(key) });
  };
  if (count > 0) {
    if (view.kind === 'donut') add('donutInstructions', 'plotInstructions');
    else { add('plotInstructions'); if (count > 1) add('seriesInstructions'); }
  }
  if (offersZoom(d)) add('zoomInstructions');
  return out;
}

export const readingLangFor = (d: Committed, hasData: boolean, single: boolean): string | null =>
  d.english(!hasData ? 'empty' : d.view.kind === 'donut' || (!single && d.view.kind !== 'scatter') ? 'pointAll' : 'pointOf');

export function renderInstructions(doc: Document, el: HTMLElement, list: readonly { text: string; lang: string | null }[], proxyLang: string | null, pageLang: string | null): void {
  if (!list.length) { if (el.firstElementChild || el.textContent) el.textContent = ''; setAttr(el, 'lang', null); return; }
  const fallback = proxyLang ? pageLang : null, first = list[0]!.lang ?? fallback;
  if (list.every(p => (p.lang ?? fallback) === first)) {
    const text = list.length === 1 ? list[0]!.text : list.map(p => p.text).join(' ');
    if (el.firstElementChild) el.textContent = text; else setText(el, text);
    setAttr(el, 'lang', first);
    return;
  }
  setAttr(el, 'lang', null);
  if (!el.firstElementChild && el.firstChild) el.textContent = '';
  list.forEach(({ text, lang }, i) => {
    setLanguageText(el.children[i] ?? el.appendChild(doc.createElement('span')), i ? ` ${text}` : text, lang ?? fallback);
  });
  while (el.children.length > list.length) el.lastElementChild!.remove();
}

let lastShowing: WeakMap<Document, HTMLElement[]> | undefined;
let liveFigures: WeakMap<Document, Set<HTMLElement>> | undefined;

export function registerFigure(doc: Document, root: HTMLElement): void {
  const m = liveFigures ??= new WeakMap();
  (m.get(doc) ?? m.set(doc, new Set()).get(doc)!).add(root);
}

export function unregisterFigure(doc: Document, root: HTMLElement): void {
  const s = liveFigures?.get(doc);
  if (s?.delete(root) && !s.size) liveFigures!.delete(doc);
}

export function focusedFigure(doc: Document, own: HTMLElement): Element | null {
  const act = activeElementOf(doc, own), inOwn = isElement(act) ? act.closest('.axylo-figure') : null;
  if (inOwn) return inOwn;
  for (const fig of liveFigures?.get(doc) ?? []) {
    if (fig === own) continue;
    const inner = shadowRootOf(fig)?.activeElement ?? null;
    if (isElement(inner) && fig.contains(inner)) return fig;
  }
  return null;
}

export function noteShowing(doc: Document, root: HTMLElement, promote: boolean): void {
  const m = lastShowing ??= new WeakMap();
  const list = m.get(doc) ?? m.set(doc, []).get(doc)!;
  if (list.at(-1) === root) return;
  const i = list.indexOf(root);
  if (promote) { if (i >= 0) list.splice(i, 1); list.push(root); } else if (i < 0) list.unshift(root);
}

export function releaseShowing(doc: Document, root: HTMLElement): void {
  const list = lastShowing?.get(doc), i = list ? list.indexOf(root) : -1;
  if (i >= 0) { list!.splice(i, 1); if (!list!.length) lastShowing!.delete(doc); }
}

export const isLastShowing = (doc: Document, root: HTMLElement): boolean => lastShowing?.get(doc)?.at(-1) === root;
