/**
 * Notices the page changes that can change a chart's theme (spec L4): the three media features, and the
 * `class`, `style` or `data-theme` attribute of `<html>` or `<body>`, which is how class-toggled dark
 * themes switch. Bursts are folded into one call per animation frame.
 */

const QUERIES = ['(prefers-color-scheme: dark)', '(forced-colors: active)', '(prefers-contrast: more)'];
const ATTRIBUTES = ['class', 'style', 'data-theme'];

/** Calls `onChange` at most once per animation frame after a relevant change. Returns `stop`. */
export function watchTheme(element: Element, onChange: () => void): () => void {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (win === null) return () => {};
  let frame = 0;
  let stopped = false;

  const schedule = (): void => {
    if (stopped || frame !== 0) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      if (!stopped) onChange();
    });
  };

  const lists = QUERIES.map(q => win.matchMedia(q));
  for (const list of lists) list.addEventListener('change', schedule);

  const html = doc.documentElement;
  let body: HTMLElement | null = doc.body;
  const observer = new win.MutationObserver(records => {
    let relevant = false;
    for (const r of records) {
      if (r.type === 'attributes') relevant = true;
      else if (body === null && doc.body !== null) {
        // The script ran in <head>: start watching <body> once it exists.
        body = doc.body;
        observer.observe(body, { attributes: true, attributeFilter: ATTRIBUTES });
        relevant = true;
      }
    }
    if (relevant) schedule();
  });
  observer.observe(html, { attributes: true, attributeFilter: ATTRIBUTES, childList: body === null });
  if (body !== null) observer.observe(body, { attributes: true, attributeFilter: ATTRIBUTES });

  return () => {
    if (stopped) return;
    stopped = true;
    for (const list of lists) list.removeEventListener('change', schedule);
    observer.disconnect();
    if (frame !== 0) win.cancelAnimationFrame(frame);
    frame = 0;
  };
}
