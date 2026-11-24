/**
 * Notices the page changes that can change a chart's theme (spec L4): the three media features, and the
 * `class`, `style` or `data-theme` attribute of the chart or any of its ancestors (a class-toggled dark
 * theme may sit on `<html>`, `<body>` or a card in between). Bursts are folded into one call.
 *
 * One ref-counted MutationObserver per root (`documentElement` and each active `ShadowRoot`) watches its
 * subtree, and a record counts only when its target is the chart or one of its ancestors at that moment,
 * so the watch keeps working when the chart is moved to another parent or `<body>` is replaced.
 */

import { subscribeTreeMutations, type SharedTreeSubscriber } from '../core/environment';

const QUERIES = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-contrast: more)'];
const ATTRIBUTES = ['class', 'style', 'data-theme'];
const MUTATION_OPTIONS: MutationObserverInit = { attributes: true, attributeFilter: ATTRIBUTES, attributeOldValue: true, subtree: true };

/** Declarations resolveTheme itself writes on the chart root; changes to them alone are not theme changes. */
const OWN = /--axylo-(?:series-color-\d+|backdrop)\s*:[^;]*;?\s*/g;
const noop = (): void => {};

function ownStyleChanged(this: SharedTreeSubscriber, records: readonly MutationRecord[]): boolean {
  const after = (this.element.getAttribute('style') ?? '').replace(OWN, '').trim();
  for (let i = 0; i < records.length; i++) {
    const before = (records[i]!.oldValue ?? '').replace(OWN, '').trim();
    if (before !== after) return true;
  }
  return false;
}

interface MediaRegistration {
  readonly fn: () => void;
}

interface ThemeMediaHub {
  readonly subscribers: Set<MediaRegistration>;
  readonly teardown: () => void;
}

const mediaHubs = new WeakMap<Window, ThemeMediaHub>();

function subscribeMedia(win: Window, onChange: () => void): () => void {
  let hub = mediaHubs.get(win);
  if (!hub) {
    let active = true;
    const subscribers = new Set<MediaRegistration>();
    const undo: (() => void)[] = [];
    const teardown = (): void => {
      active = false;
      for (let fn = undo.pop(); fn; fn = undo.pop()) {
        try { fn(); } catch { /* keep releasing */ }
      }
    };
    const dispatch = (): void => {
      if (!active) return;
      for (const entry of [...subscribers]) {
        if (subscribers.has(entry)) entry.fn();
      }
    };
    try {
      for (const q of QUERIES) {
        const list = win.matchMedia(q);
        list.addEventListener('change', dispatch);
        undo.push(() => list.removeEventListener('change', dispatch));
      }
    } catch (error) {
      teardown();
      throw error;
    }
    hub = { subscribers, teardown };
    mediaHubs.set(win, hub);
  }
  const entry: MediaRegistration = { fn: onChange };
  hub.subscribers.add(entry);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    hub!.subscribers.delete(entry);
    if (hub!.subscribers.size === 0) {
      if (mediaHubs.get(win) === hub) mediaHubs.delete(win);
      hub!.teardown();
    }
  };
}

/**
 * Calls `onChange` for a burst of relevant changes (once per observer batch), so the caller can feed it to its own
 * frame scheduler: the repaint lands in the next animation frame with any other pending work, drawn once
 * (review 3, finding 19). Returns `stop`.
 */
export function watchTheme(element: Element, onChange: () => void): () => void {
  const win = element.ownerDocument.defaultView;
  if (win === null) return noop;
  // Every subscription's release is kept as it is made, so a failure part-way (an observe() that throws)
  // leaves nothing registered (final review, finding 14).
  let stopMedia: (() => void) | null = null;
  let stopTree: (() => void) | null = null;
  try {
    stopMedia = subscribeMedia(win, onChange);
    stopTree = subscribeTreeMutations('theme', element, MUTATION_OPTIONS, {
      element,
      onChange,
      styleChanged: ownStyleChanged,
    });
  } catch (error) {
    if (stopTree) { try { stopTree(); } catch { /* keep releasing */ } }
    if (stopMedia) { try { stopMedia(); } catch { /* keep releasing */ } }
    throw error;
  }

  return () => {
    const tree = stopTree;
    const media = stopMedia;
    stopTree = null;
    stopMedia = null;
    if (tree) { try { tree(); } catch { /* keep releasing */ } }
    if (media) { try { media(); } catch { /* keep releasing */ } }
  };
}
