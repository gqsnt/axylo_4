/**
 * Notices the page changes that can change a chart's theme (spec L4): the three media features, and the
 * `class`, `style` or `data-theme` attribute of the chart or any of its ancestors (a class-toggled dark
 * theme may sit on `<html>`, `<body>` or a card in between). Bursts are folded into one call.
 *
 * One ref-counted MutationObserver per root (`documentElement` and each active `ShadowRoot`) watches its
 * subtree, and a record counts only when its target is the chart or one of its ancestors at that moment,
 * so the watch keeps working when the chart is moved to another parent or `<body>` is replaced.
 */

import { dispatch, drainUndo, listen, register, release, subscribeTreeMutations, teardownHub, type SharedTreeSubscriber } from '../core/environment';

const QUERIES = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-contrast: more)'];
const MUTATION_OPTIONS: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'], attributeOldValue: true, subtree: true };

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
  /** The live lists of QUERIES, in order (dark, forced colors, more contrast). */
  readonly lists: readonly MediaQueryList[];
}

/** What the media features say now, as theme resolution reads them. */
export interface ThemeMediaState {
  readonly prefersDark: boolean;
  readonly forcedColors: boolean;
  readonly moreContrast: boolean;
}

const mediaHubs = new WeakMap<Window, ThemeMediaHub>();

const notify = (entry: MediaRegistration): void => entry.fn();

function subscribeMedia(win: Window, onChange: () => void): () => void {
  let hub = mediaHubs.get(win);
  if (!hub) {
    let active = true;
    const subscribers = new Set<MediaRegistration>();
    const undo: (() => void)[] = [];
    const teardown = (): void => {
      active = false;
      drainUndo(undo);
    };
    const onMedia = (): void => {
      if (active) dispatch(subscribers, notify);
    };
    const lists: MediaQueryList[] = [];
    try {
      for (const query of QUERIES) {
        const list = win.matchMedia(query);
        lists.push(list);
        listen(undo, list, 'change', onMedia);
      }
    } catch (error) {
      teardown();
      throw error;
    }
    hub = { subscribers, teardown, lists };
    mediaHubs.set(win, hub);
  }
  return register(mediaHubs, win, hub, { fn: onChange }, teardownHub);
}

/**
 * The media features from the lists the window's theme watchers already hold (their `matches` is live), so a
 * frame that resolves themes asks no new query; null when no chart of the window watches its theme.
 */
export function themeMedia(win: Window): ThemeMediaState | null {
  const lists = mediaHubs.get(win)?.lists;
  if (!lists || lists.length !== QUERIES.length) return null;
  return { prefersDark: lists[0]!.matches, forcedColors: lists[1]!.matches, moreContrast: lists[2]!.matches };
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
  let stopMedia = subscribeMedia(win, onChange);
  let stopTree: () => void;
  try {
    stopTree = subscribeTreeMutations('theme', element, MUTATION_OPTIONS, {
      element,
      onChange,
      styleChanged: ownStyleChanged,
    });
  } catch (error) {
    release(stopMedia);
    throw error;
  }
  return () => {
    const tree = stopTree;
    const media = stopMedia;
    stopTree = stopMedia = noop;
    release(tree);
    release(media);
  };
}
