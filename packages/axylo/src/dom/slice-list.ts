/**
 * The donut's legend: one button per slice with its value and share (spec A5, I3). Only donut imports it.
 */
import { sliceText } from '../lookup/text';
import { clamp } from '../scene/geometry';
import { activeElementOf, focusContainer, focusQuiet, isFocusable, keepFocusOnPress, make, placeChildren, setLanguageText, setText } from './attributes';
import { Listeners } from './mapping';
import { createSwatch } from './swatch';
import { focusNeighbor, rovingIndex } from './toolbar';
import { showsSlices } from './interaction-controls';
import type { SliceList } from './interaction-types';

type SliceEntry = { li: HTMLLIElement; c: HTMLButtonElement; n: HTMLElement; v: HTMLElement; s: string };
let sliceLists: WeakMap<HTMLUListElement, { e: Map<string, SliceEntry>; l: Listeners }> | undefined;
const CHOICE = '.axylo-legend-choice';
const sliceButtons = (ul: Element) => [...ul.querySelectorAll<HTMLButtonElement>(CHOICE)];
const setTab = (bs: HTMLButtonElement[], idx: number) => bs.forEach((b, i) => { const t = i === idx ? 0 : -1; if (b.tabIndex !== t) b.tabIndex = t; });

export const donutSliceList: SliceList = (doc, d, actions, list) => {
  if (!d || !showsSlices(d)) {
    if (list) {
      sliceLists?.get(list)?.l.clear();
      sliceLists?.delete(list);
      list.remove();
    }
    return null;
  }
  const { view } = d, lists = sliceLists ??= new WeakMap();
  if (!list) {
    const own = list = doc.createElement('ul'), l = new Listeners();
    lists.set(own, { e: new Map(), l });
    const choice = (ev: Event) => (ev.target as Element | null)?.closest?.(CHOICE);
    l.on(own, 'mousedown', ev => { if (choice(ev)) keepFocusOnPress(ev); });
    l.on(own, 'click', ev => { const k = choice(ev)?.parentElement?.dataset.key; if (k !== undefined) actions.select({ kind: 'slice', sliceKey: k }); });
    l.on(own, 'keydown', ev => {
      if (own.dataset.roving !== 'true') return;
      const bs = sliceButtons(own), to = rovingIndex(ev, Math.max(0, bs.indexOf(activeElementOf(doc, own) as HTMLButtonElement)), bs.length);
      if (to === null) return;
      ev.preventDefault();
      setTab(bs, to);
      bs[to]!.focus();
    });
    l.on(own, 'focusin', ev => {
      if (own.dataset.roving !== 'true') return;
      const bs = sliceButtons(own);
      setTab(bs, bs.indexOf(ev.target as HTMLButtonElement));
    });
  }
  if (list.className !== 'axylo-legend-list') list.className = 'axylo-legend-list';
  let st = lists.get(list);
  if (!st) lists.set(list, st = { e: new Map(), l: new Listeners() });
  const kept = st.e, noDataLang = d.english('noData'), wanted: HTMLLIElement[] = [], buttons: HTMLButtonElement[] = [], live = new Set<string>();
  for (const sl of view.slices) {
    live.add(sl.key);
    let en = kept.get(sl.key);
    if (!en) {
      const li = doc.createElement('li'), c = make(doc, 'button', 'axylo-legend-choice');
      li.dataset.key = sl.key; c.type = 'button'; c.tabIndex = -1; li.append(c);
      kept.set(sl.key, en = { li, c, n: make(doc, 'span', 'axylo-legend-name'), v: make(doc, 'span', 'axylo-legend-value'), s: '' });
    }
    const datum = sliceText(view, sl, d.formatters), sig = `${sl.colorIndex}:${sl.angles === null}`;
    if (sig !== en.s) {
      en.c.replaceChildren(createSwatch(doc, { color: sl.colorIndex, cue: null, line: false, hollow: sl.angles === null }), en.n, en.v);
      en.s = sig;
    }
    setText(en.n, sl.label);
    const { percent, value } = datum;
    setLanguageText(en.v, percent && percent !== value ? `${value} (${percent})` : value, value === d.messages.noData ? noDataLang : null);
    wanted.push(en.li);
    buttons.push(en.c);
  }
  for (const k of kept.keys()) if (!live.has(k)) kept.delete(k);
  const had = activeElementOf(doc, list);
  const prev = isFocusable(had) && list.contains(had) ? sliceButtons(list) : null;
  const hadAt = prev ? prev.indexOf(had as HTMLButtonElement) : -1;
  placeChildren(list, wanted);
  if (prev) {
    if (had!.isConnected) { if (activeElementOf(doc, list) !== had) focusQuiet(had as HTMLElement); }
    else if (buttons.length) {
      focusQuiet(focusNeighbor(prev, hadAt, button => button.isConnected) ?? buttons[clamp(hadAt, 0, buttons.length - 1)]!);
    } else focusContainer(list.closest('.axylo-figure'));
  }
  const roving = !d.ready;
  if (list.dataset.roving !== String(roving)) list.dataset.roving = String(roving);
  let at = buttons.indexOf(activeElementOf(doc, list) as HTMLButtonElement);
  if (at < 0) at = buttons.findIndex(b => b.tabIndex === 0);
  setTab(buttons, roving ? Math.max(0, at) : -1);
  return list;
};
