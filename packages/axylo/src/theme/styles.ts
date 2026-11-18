/**
 * Applies the default stylesheet (plan 2.4) to the root a chart lives in: its document, or the shadow root
 * that contains it (a document's sheets do not reach into a shadow tree).
 *
 * - Normally a constructable stylesheet is adopted (`adoptedStyleSheets`); no `<style>` element is created.
 * - A root that already has the standalone dist/axylo.css active gets nothing. "Active" is checked by its
 *   effect (a probe element picks up the sheet's own rules), not by trusting a sentinel property, and is
 *   checked again on later calls, so a sheet that was removed or disabled is replaced.
 * - Only where constructable or adopted stylesheets are missing is one `<style>` element inserted instead.
 *   This is the only case in which the library creates a style element.
 */
import { AXYLO_CSS } from './css';

type StyleRoot = Document | ShadowRoot;

type Installed =
  | { readonly kind: 'adopted'; readonly sheet: CSSStyleSheet }
  | { readonly kind: 'element'; readonly element: HTMLStyleElement }
  | { readonly kind: 'standalone'; readonly sheet: CSSStyleSheet | null };

const installed = new WeakMap<StyleRoot, Installed>();
/** One constructed sheet per document, shared by its document and shadow roots. */
const constructed = new WeakMap<Document, CSSStyleSheet>();

/**
 * Makes the default styles apply to `root` (a Document or a ShadowRoot). Safe to call any number of times;
 * after the first call it costs a few property reads unless the sheet it relied on has gone away.
 */
export function ensureStyles(root: StyleRoot): void {
  const state = installed.get(root);
  if (state !== undefined && stillActive(root, state)) return;
  const doc = 'ownerDocument' in root && root.ownerDocument !== null ? root.ownerDocument : (root as Document);
  const win = doc.defaultView;
  if (win === null) return;

  const standalone = findStandalone(root, doc, win);
  if (standalone !== undefined) { installed.set(root, { kind: 'standalone', sheet: standalone }); return; }

  if (canAdopt(root, win)) {
    let sheet = constructed.get(doc);
    if (sheet === undefined) {
      // The constructor must come from the document's own window, or adopting the sheet throws.
      sheet = new win.CSSStyleSheet();
      sheet.replaceSync(AXYLO_CSS);
      constructed.set(doc, sheet);
    }
    const list = (root as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets;
    if (!list.includes(sheet)) (root as { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets = [...list, sheet];
    installed.set(root, { kind: 'adopted', sheet });
    return;
  }

  const element = doc.createElement('style');
  element.setAttribute('data-axylo-styles', '');
  element.textContent = AXYLO_CSS;
  if (root === doc) (doc.head ?? doc.documentElement).appendChild(element);
  else root.insertBefore(element, root.firstChild);
  installed.set(root, { kind: 'element', element });
}

function stillActive(root: StyleRoot, state: Installed): boolean {
  switch (state.kind) {
    case 'adopted': return (root as { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets?.includes(state.sheet) ?? false;
    case 'element': return state.element.isConnected && state.element.sheet !== null && !state.element.sheet.disabled;
    case 'standalone': {
      if (state.sheet === null) return false; // not identifiable: verify by effect again
      const owner = state.sheet.ownerNode;
      return !state.sheet.disabled && owner !== null && owner.isConnected && Array.prototype.includes.call(root.styleSheets, state.sheet);
    }
  }
}

function canAdopt(root: StyleRoot, win: Window): boolean {
  if (!('adoptedStyleSheets' in root)) return false;
  const Sheet = (win as unknown as { CSSStyleSheet?: { new(): CSSStyleSheet; prototype: Partial<CSSStyleSheet> } }).CSSStyleSheet;
  if (typeof Sheet !== 'function' || typeof Sheet.prototype.replaceSync !== 'function') return false;
  try { new Sheet(); } catch { return false; }
  return true;
}

/**
 * The standalone sheet if it is in effect in `root`: undefined if not, null if in effect but not
 * identifiable (a cross-origin sheet whose rules cannot be read). In effect means a probe chart root picks
 * up a private token and a mark rule that only this stylesheet defines; custom properties alone could be
 * inherited from outside a shadow root, so a non-inherited property is checked as well.
 */
function findStandalone(root: StyleRoot, doc: Document, win: Window): CSSStyleSheet | null | undefined {
  const probe = doc.createElement('div');
  probe.className = 'axylo';
  probe.style.setProperty('display', 'none');
  const mark = doc.createElement('div');
  mark.className = 'axylo-svg';
  probe.appendChild(mark);
  (root === doc ? doc.documentElement : root).appendChild(probe);
  const token = win.getComputedStyle(probe).getPropertyValue('--axylo-default-background').trim();
  const rule = win.getComputedStyle(mark).position;
  probe.remove();
  if (token === '' || rule !== 'absolute') return undefined;
  for (const sheet of Array.from(root.styleSheets)) {
    try {
      for (const r of Array.from(sheet.cssRules)) if (r.cssText.includes('--axylo-stylesheet')) return sheet;
    } catch {
      // Cross-origin: its rules cannot be read.
    }
  }
  return null;
}
