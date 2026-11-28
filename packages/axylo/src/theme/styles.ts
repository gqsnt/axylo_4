/**
 * Applies the default stylesheet (plan 2.4) to the root a chart lives in: its document, or the shadow root
 * that contains it.
 */
import { AXYLO_CSS } from './css';

type StyleRoot = Document | ShadowRoot;

const installed = new WeakMap<StyleRoot, () => boolean>();
const constructed = new WeakMap<Document, CSSStyleSheet>();

export function ensureStyles(root: StyleRoot): void {
  if (installed.get(root)?.()) return;
  const doc = root.ownerDocument ?? root as Document, win = doc.defaultView;
  if (!win) return;

  let candidate = false, standalone: CSSStyleSheet | undefined;
  const adopted = root.adoptedStyleSheets;
  search: for (const sheets of [root.styleSheets, adopted ?? []]) {
    for (let i = 0; i < sheets.length; i++) {
      const sheet = sheets[i]!;
      try {
        for (let j = 0, rules = sheet.cssRules; j < rules.length; j++) {
          const rule = rules[j]!;
          if (rule.cssText.includes('--axylo-stylesheet')) { standalone = sheet; break search; }
          if (rule.type === 3) candidate = true;
        }
      } catch { candidate = true; }
    }
  }

  const parent = root === doc ? doc.documentElement : root;
  if ((standalone || candidate) && standaloneActive(doc, parent, win)) {
    const owner = standalone?.ownerNode;
    if (standalone && owner) {
      const sheet = standalone;
      let media = '', query: MediaQueryList | undefined;
      installed.set(root, () => {
        if (sheet.disabled || !owner.isConnected ||
          ('sheet' in owner ? owner.sheet !== sheet || owner.getRootNode() !== root : !Array.prototype.includes.call(root.styleSheets, sheet))) return false;
        const cur = sheet.media.mediaText;
        if (cur !== media) query = (media = cur) ? win.matchMedia(cur) : undefined;
        return query?.matches ?? true;
      });
    }
    return;
  }

  if (adopted && typeof win.CSSStyleSheet?.prototype.replaceSync === 'function') {
    let sheet = constructed.get(doc);
    if (!sheet) {
      try { sheet = new win.CSSStyleSheet(); } catch {}
      if (sheet) { sheet.replaceSync(AXYLO_CSS); constructed.set(doc, sheet); }
    }
    if (sheet) {
      let index = adopted.indexOf(sheet);
      if (index < 0) { index = adopted.length; root.adoptedStyleSheets = [...adopted, sheet]; }
      installed.set(root, () => {
        const sheets = root.adoptedStyleSheets;
        return sheets?.[index] === sheet || (index = sheets?.indexOf(sheet) ?? -1) >= 0;
      });
      return;
    }
  }

  const el = doc.createElement('style');
  el.setAttribute('data-axylo-styles', '');
  el.textContent = AXYLO_CSS;
  if (root === doc) (doc.head ?? parent).appendChild(el);
  else root.insertBefore(el, root.firstChild);
  installed.set(root, () => el.isConnected && !!el.sheet && !el.sheet.disabled);
}

function standaloneActive(doc: Document, parent: Node, win: Window): boolean {
  const probe = doc.createElement('div'), mark = probe.appendChild(doc.createElement('div'));
  probe.className = 'axylo'; probe.style.display = 'none'; mark.className = 'axylo-svg';
  parent.appendChild(probe);
  try {
    return !!win.getComputedStyle(probe).getPropertyValue('--axylo-default-background').trim() && win.getComputedStyle(mark).position === 'absolute';
  } finally { probe.remove(); }
}
