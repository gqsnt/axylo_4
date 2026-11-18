/**
 * Notices the page changes that can change a chart's theme (spec L4): the three media features, and the
 * `class`, `style` or `data-theme` attribute of the chart or any of its ancestors (a class-toggled dark
 * theme may sit on `<html>`, `<body>` or a card in between). Bursts are folded into one call.
 *
 * One MutationObserver covers the whole document (`subtree`), and a record counts only when its target is
 * the chart or one of its ancestors at that moment, so the watch keeps working when the chart is moved to
 * another parent or `<body>` is replaced. Inside a shadow root, that root is observed as well.
 */

const QUERIES = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-contrast: more)'];
const ATTRIBUTES = ['class', 'style', 'data-theme'];

/** Declarations resolveTheme itself writes on the chart root; changes to them alone are not theme changes. */
const OWN = /--axylo-(?:series-color-\d+|backdrop)\s*:[^;]*;?\s*/g;

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

  const lists = QUERIES.map(q => win.matchMedia(q));
  for (const list of lists) list.addEventListener('change', schedule);

  const observer = new win.MutationObserver(records => {
    for (const r of records) {
      if (!holds(r.target, element)) continue;
      if (r.target === element && r.attributeName === 'style') {
        const before = (r.oldValue ?? '').replace(OWN, '').trim();
        const after = (element.getAttribute('style') ?? '').replace(OWN, '').trim();
        if (before === after) continue;
      }
      schedule();
      return;
    }
  });
  const options: MutationObserverInit = { attributes: true, attributeFilter: ATTRIBUTES, attributeOldValue: true, subtree: true };
  observer.observe(doc.documentElement, options);
  const root = element.getRootNode();
  if (root !== doc && 'host' in root) observer.observe(root, options);

  return () => {
    if (stopped) return;
    stopped = true;
    for (const list of lists) list.removeEventListener('change', schedule);
    observer.disconnect();
  };
}

/** True when `target` is `element` or one of its ancestors, crossing shadow roots to their hosts. */
function holds(target: Node, element: Node): boolean {
  for (let n: Node | null = element; n !== null; n = n.parentNode ?? ('host' in n ? (n as ShadowRoot).host : null)) {
    if (n === target) return true;
  }
  return false;
}
