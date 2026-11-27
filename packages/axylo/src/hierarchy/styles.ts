/**
 * The hierarchy charts' own stylesheet: theme tokens (light, dark through `prefers-color-scheme`, forced colors)
 * and structure. It is built and adopted only when a chart is created, as a constructable stylesheet, so it
 * works under a strict Content-Security-Policy and costs a bare `import 'axylo/hierarchy'` nothing. The shared
 * stylesheet (theme/css.ts) is not imported: building it runs code at module level.
 *
 * Every token reads the public custom property first (`--axylo-background`, `--axylo-series-3`, …), so an
 * author's theme applies here as on the other charts.
 */
import { DARK, LIGHT, type SchemeColors } from '../theme/palette';

const LIGHT_TEXT = '#1d2026';
const DARK_TEXT = '#e6e8ec';

function tokens(c: SchemeColors, text: string): string {
  return [
    `--axylo-h-bg: ${c.background};`, `--axylo-h-text: ${text};`, `--axylo-h-muted: ${c.muted};`,
    `--axylo-h-axis: ${c.axis};`, `--axylo-h-grid: ${c.grid};`, `--axylo-h-focus: ${c.focus};`,
    ...c.series.map((color, i) => `--axylo-h-series-${i + 1}: ${color};`),
  ].join(' ');
}

const BG = 'var(--axylo-background, var(--axylo-h-bg))';
const TEXT = 'var(--axylo-text, var(--axylo-h-text))';
const FOCUS = 'var(--axylo-focus, var(--axylo-h-focus))';
const AXIS = 'var(--axylo-axis, var(--axylo-h-axis))';
const GRID = 'var(--axylo-grid, var(--axylo-h-grid))';

export function hierarchyCss(): string {
  return `@layer axylo {
.axylo-hierarchy { ${tokens(LIGHT, LIGHT_TEXT)} }
@media (prefers-color-scheme: dark) { .axylo-hierarchy { ${tokens(DARK, DARK_TEXT)} } }
@media (forced-colors: active) { .axylo-hierarchy { --axylo-forced-series: CanvasText; --axylo-h-bg: Canvas; --axylo-h-text: CanvasText; --axylo-h-muted: GrayText; --axylo-h-axis: CanvasText; --axylo-h-grid: GrayText; --axylo-h-focus: Highlight; } }
.axylo-hierarchy { position: relative; display: flex; flex-direction: column; box-sizing: border-box; height: 100%; min-width: 0; margin: 0; padding: 4px;
  color: ${TEXT}; background: ${BG}; font-family: var(--axylo-font-family, inherit); }
.axylo-hierarchy [hidden] { display: none !important; }
.axylo-h-sr { position: absolute !important; width: 1px !important; height: 1px !important; margin: -1px !important; padding: 0 !important;
  border: 0 !important; overflow: hidden !important; clip-path: inset(50%) !important; white-space: nowrap !important; }
.axylo-h-header { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; margin: 0 0 4px; }
.axylo-h-title { margin: 0; font-size: max(12px, 1.125em); font-weight: 600; }
.axylo-h-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; margin: 0; padding: 0; list-style: none; font-size: max(12px, 0.875em); }
.axylo-h-crumbs > li { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.axylo-h-current { font-weight: 600; min-height: 24px; display: inline-flex; align-items: center; overflow-wrap: anywhere; }
.axylo-h-button { box-sizing: border-box; min-width: 24px; min-height: 24px; margin: 0; padding: 2px 6px; font: inherit; cursor: pointer;
  color: ${TEXT}; background: ${BG}; border: 1px solid ${AXIS}; border-radius: 4px; }
.axylo-h-button:focus-visible, .axylo-h-region:focus-visible { outline: 2px solid ${FOCUS}; outline-offset: 1px; }
.axylo-h-plot { position: relative; flex: 1 1 auto; min-height: 160px; outline: none; overflow: hidden; touch-action: manipulation; user-select: none; -webkit-user-select: none; }
.axylo-h-plot:focus-visible { box-shadow: inset 0 0 0 2px ${FOCUS}; }
.axylo-h-svg { position: absolute; left: 0; top: 0; overflow: hidden; pointer-events: none; }
.axylo-h-empty { position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center; text-align: center; }
.axylo-h-tip { position: absolute; left: 0; top: 0; z-index: 2; box-sizing: border-box; pointer-events: none; max-width: min(300px, 100%);
  padding: 4px 8px; border: 1px solid ${AXIS}; border-radius: 4px; color: ${TEXT}; background: ${BG}; font-size: max(12px, 0.875em); line-height: 1.4; overflow-wrap: anywhere; }
.axylo-h-tip-title { font-weight: 600; }
.axylo-h-tip dl { display: grid; grid-template-columns: auto auto; gap: 0 12px; margin: 2px 0 0; }
.axylo-h-tip dd { margin: 0; text-align: end; font-variant-numeric: tabular-nums; }
.axylo-h-note { flex: none; margin: 4px 0 0; font-size: max(12px, 0.875em); }
.axylo-h-controls { flex: none; display: flex; gap: 8px; margin: 4px 0 0; }
.axylo-h-region { flex: none; max-height: 50%; overflow: auto; margin: 4px 0 0; border: 1px solid ${GRID}; }
.axylo-h-region table { border-collapse: collapse; width: max-content; min-width: 100%; font-size: max(12px, 0.875em); font-variant-numeric: tabular-nums; }
.axylo-h-region caption { padding: 4px 8px; text-align: start; font-weight: 600; }
.axylo-h-region th, .axylo-h-region td { padding: 2px 8px; text-align: end; white-space: nowrap; border-bottom: 1px solid ${GRID}; }
.axylo-h-region th[scope="row"], .axylo-h-region thead th:first-child { text-align: start; }
}
`;
}

let installed: WeakSet<object> | null = null;

/** Adopts the stylesheet into the document or shadow root that holds a chart, once per root. */
export function installHierarchyStyles(root: Document | ShadowRoot): void {
  installed ??= new WeakSet();
  if (installed.has(root)) return;
  const doc = (root as ShadowRoot).ownerDocument ?? root as Document;
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win) return;
  installed.add(root);
  const css = hierarchyCss();
  if ('adoptedStyleSheets' in root && typeof win.CSSStyleSheet === 'function') {
    try {
      const sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return;
    } catch { /* fall back below */ }
  }
  // Only where constructable stylesheets are missing: one <style> element.
  const style = doc.createElement('style');
  style.textContent = css;
  (root === doc ? doc.head ?? doc.documentElement : root).appendChild(style);
}
