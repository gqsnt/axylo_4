/**
 * Notices the page changes that can change a chart's theme (spec L4): the three media features, and the
 * `class`, `style` or `data-theme` attribute of the chart or any of its ancestors.
 */
import { dispatch, drainUndo, listen, register, release, subscribeTreeMutations, teardownHub, type SharedTreeSubscriber } from '../core/environment';

const QUERIES = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-contrast: more)'];
const MUTATION_OPTIONS: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'], attributeOldValue: true, subtree: true };
const OWN = /--axylo-(?:series-color-\d+|backdrop)\s*:[^;]*;?\s*/g;
const noop = (): void => {};

function ownStyleChanged(this: SharedTreeSubscriber, records: readonly MutationRecord[]): boolean {
  const after = (this.element.getAttribute('style') ?? '').replace(OWN, '').trim();
  return records.some(r => (r.oldValue ?? '').replace(OWN, '').trim() !== after);
}

interface ThemeMediaHub {
  readonly subscribers: Set<{ readonly f: () => void }>;
  readonly teardown: () => void;
  readonly l: readonly MediaQueryList[];
}

export interface ThemeMediaState {
  readonly prefersDark: boolean;
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
}

const mediaHubs = new WeakMap<Window, ThemeMediaHub>();
const notify = (e: { readonly f: () => void }): void => e.f();

function subscribeMedia(win: Window, onChange: () => void): () => void {
  let hub = mediaHubs.get(win);
  if (!hub) {
    let active = true;
    const subscribers = new Set<{ readonly f: () => void }>(), undo: (() => void)[] = [], l: MediaQueryList[] = [];
    const teardown = () => { active = false; drainUndo(undo); };
    const onMedia = () => { if (active) dispatch(subscribers, notify); };
    try {
      for (const q of QUERIES) { const list = win.matchMedia(q); l.push(list); listen(undo, list, 'change', onMedia); }
    } catch (error) { teardown(); throw error; }
    mediaHubs.set(win, hub = { subscribers, teardown, l });
  }
  return register(mediaHubs, win, hub, { f: onChange }, teardownHub);
}

export function themeMedia(win: Window): ThemeMediaState | null {
  const l = mediaHubs.get(win)?.l;
  return l && l.length === 3 ? { prefersDark: l[0]!.matches, forcedColors: l[1]!.matches, moreContrast: l[2]!.matches } : null;
}

export function watchTheme(element: Element, onChange: () => void): () => void {
  const win = element.ownerDocument.defaultView;
  if (!win) return noop;
  let stopMedia = subscribeMedia(win, onChange), stopTree: () => void;
  try {
    stopTree = subscribeTreeMutations('theme', element, MUTATION_OPTIONS, { element, onChange, styleChanged: ownStyleChanged });
  } catch (error) { release(stopMedia); throw error; }
  return () => {
    const t = stopTree, m = stopMedia;
    stopTree = stopMedia = noop;
    release(t); release(m);
  };
}
