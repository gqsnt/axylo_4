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

const installed = new WeakMap<StyleRoot, () => boolean>();
const constructed = new WeakMap<Document, CSSStyleSheet>();

export function ensureStyles(root: StyleRoot): void {
  if (installed.get(root)?.()) return;
  const doc = root.ownerDocument ?? root as Document;
  const win = doc.defaultView;
  if (!win) return;

  // Imported and cross-origin rules may supply the stylesheet without exposing its marker here.
  let candidate = false;
  let standalone: CSSStyleSheet | undefined;
  for (const sheet of [...Array.from(root.styleSheets), ...(root.adoptedStyleSheets ?? [])]) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule.cssText.includes('--axylo-stylesheet')) {
          standalone = sheet;
          break;
        }
        if (rule.type === 3) candidate = true; // CSSImportRule
      }
    } catch { candidate = true; }
    if (standalone) break;
  }

  const parent = root === doc ? doc.documentElement : root;
  if ((standalone || candidate) && standaloneActive(doc, parent, win)) {
    if (standalone?.ownerNode) {
      const sheet = standalone;
      installed.set(root, () => !sheet.disabled && !!sheet.ownerNode?.isConnected &&
        Array.prototype.includes.call(root.styleSheets, sheet) &&
        (!sheet.media.mediaText || win.matchMedia(sheet.media.mediaText).matches));
    }
    return;
  }

  if (root.adoptedStyleSheets && typeof win.CSSStyleSheet?.prototype.replaceSync === 'function') {
    let sheet = constructed.get(doc);
    if (!sheet) {
      // Some engines expose the interface without supporting construction.
      try { sheet = new win.CSSStyleSheet(); } catch { /* use a style element below */ }
      if (sheet) {
        sheet.replaceSync(AXYLO_CSS);
        constructed.set(doc, sheet);
      }
    }
    if (sheet) {
      if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      installed.set(root, () => root.adoptedStyleSheets?.includes(sheet));
      return;
    }
  }

  const element = doc.createElement('style');
  element.setAttribute('data-axylo-styles', '');
  element.textContent = AXYLO_CSS;
  if (root === doc) (doc.head ?? parent).appendChild(element);
  else root.insertBefore(element, root.firstChild);
  installed.set(root, () => element.isConnected && !!element.sheet && !element.sheet.disabled);
}

function standaloneActive(doc: Document, parent: Node, win: Window): boolean {
  const probe = doc.createElement('div');
  probe.className = 'axylo';
  probe.style.display = 'none';
  const mark = probe.appendChild(doc.createElement('div'));
  mark.className = 'axylo-svg';
  parent.appendChild(probe);
  try {
    return !!win.getComputedStyle(probe).getPropertyValue('--axylo-default-background').trim() &&
      win.getComputedStyle(mark).position === 'absolute';
  } finally { probe.remove(); }
}
