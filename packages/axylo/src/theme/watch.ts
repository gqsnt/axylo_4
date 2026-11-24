/**
 * Notices the page changes that can change a chart's theme (spec L4): the three media features, and the
 * `class`, `style` or `data-theme` attribute of the chart or any of its ancestors (a class-toggled dark
 * theme may sit on `<html>`, `<body>` or a card in between). Bursts are folded into one call.
 *
 * One ref-counted MutationObserver per root (`documentElement` and each active `ShadowRoot`) watches its
 * subtree, and a record counts only when its target is the chart or one of its ancestors at that moment,
 * so the watch keeps working when the chart is moved to another parent or `<body>` is replaced.
 */

import { subscribeTreeMutations } from '../core/environment';

const QUERIES = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-contrast: more)'];
const ATTRIBUTES = ['class', 'style', 'data-theme'];
const MUTATION_OPTIONS: MutationObserverInit = { attributes: true, attributeFilter: ATTRIBUTES, attributeOldValue: true, subtree: true };

/** Declarations resolveTheme itself writes on the chart root; changes to them alone are not theme changes. */
const OWN = /--axylo-(?:series-color-\d+|backdrop)\s*:[^;]*;?\s*/g;

interface ThemeMediaHub {
  readonly subscribers: Set<() => void>;
  readonly teardown: () => void;
}

const mediaHubs = new WeakMap<Window, ThemeMediaHub>();

function subscribeMedia(win: Window, onChange: () => void): () => void {
  let hub = mediaHubs.get(win);
  if (!hub) {
    let active = true;
    const subscribers = new Set<() => void>();
    const undo: (() => void)[] = [];
    const teardown = (): void => {
      active = false;
      for (let fn = undo.pop(); fn; fn = undo.pop()) {
        try { fn(); } catch { /* keep releasing */ }
      }
    };
    const dispatch = (): void => {
      if (!active) return;
      for (const fn of [...subscribers]) {
        if (subscribers.has(fn)) fn();
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
  hub.subscribers.add(onChange);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    hub!.subscribers.delete(onChange);
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
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (win === null) return () => {};
  let stopped = false;

  // At once: the observer already delivers a burst as one batch, and the caller only marks itself dirty and
  // schedules its frame, so the repaint is in the very next animation frame.
  const schedule = (): void => {
    if (!stopped) onChange();
  };

  // Every subscription's release is kept as it is made, so a failure part-way (an observe() that throws)
  // leaves nothing registered (final review, finding 14).
  const undo: (() => void)[] = [];
  const release = (): void => {
    stopped = true;
    for (let fn = undo.pop(); fn; fn = undo.pop()) {
      try { fn(); } catch { /* keep releasing */ }
    }
  };
  try {
    undo.push(subscribeMedia(win, schedule));
    undo.push(subscribeTreeMutations('theme', element, MUTATION_OPTIONS, {
      element,
      onChange: schedule,
      styleChanged(records) {
        const after = (element.getAttribute('style') ?? '').replace(OWN, '').trim();
        for (let i = 0; i < records.length; i++) {
          const before = (records[i]!.oldValue ?? '').replace(OWN, '').trim();
          if (before !== after) return true;
        }
        return false;
      },
    }));
  } catch (error) {
    release();
    throw error;
  }

  return () => {
    if (stopped) return;
    release();
  };
}
