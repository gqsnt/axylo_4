/**
 * Applies the default stylesheet to a document without injecting a `<style>` element (plan 2.4): a
 * constructable stylesheet in `adoptedStyleSheets`. Pages that load dist/axylo.css themselves are detected
 * through the `--axylo-stylesheet` property that sheet sets on `:root`, and get nothing added.
 */
import { AXYLO_CSS } from './css';

const adopted = new WeakMap<Document, CSSStyleSheet>();
// Remembered so later calls do not force a style recalculation just to find the page's own sheet again.
const standalone = new WeakSet<Document>();

/** Makes the default styles apply to `doc`. Safe to call any number of times. */
export function ensureStyles(doc: Document): void {
  if (standalone.has(doc)) return;
  const existing = adopted.get(doc);
  if (existing !== undefined) {
    // Re-adopt if something replaced the document's list since.
    if (!doc.adoptedStyleSheets.includes(existing)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, existing];
    return;
  }
  const win = doc.defaultView;
  if (win === null) return;
  if (win.getComputedStyle(doc.documentElement).getPropertyValue('--axylo-stylesheet').trim() !== '') {
    standalone.add(doc);
    return;
  }
  // The constructor must come from the document's own window, or adopting the sheet throws.
  const sheet = new win.CSSStyleSheet();
  sheet.replaceSync(AXYLO_CSS);
  adopted.set(doc, sheet);
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
}
