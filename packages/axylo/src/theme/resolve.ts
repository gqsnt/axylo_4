/**
 * Theme resolution (spec L4, DX6, A5): decides light or dark for a chart root, and turns paints into both
 * CSS expressions (for the SVG renderer, which stays live) and concrete colors (for canvas and contrast
 * checks). Concrete colors come from the browser itself through a probe element, never from parsing CSS.
 */
import type { PaintBindings, PaintToken, ResolvedTheme } from '../core/contracts';
import { isLightColor, parseColor } from './color';
import { SERIES_COUNT } from './palette';

export interface ThemeResolution {
  readonly bindings: PaintBindings;
  readonly theme: ResolvedTheme;
}

const TOKENS: readonly PaintToken[] = ['axis', 'grid', 'reference', 'muted', 'focus', 'background', 'text'];

/** CSS expressions for the token paints. The stylesheet defines every name used here. */
export const TOKEN_BINDINGS: Readonly<Record<PaintToken, string>> = Object.freeze({
  axis: 'var(--axylo-axis)',
  grid: 'var(--axylo-grid)',
  reference: 'var(--axylo-reference)',
  muted: 'var(--axylo-muted)',
  focus: 'var(--axylo-focus)',
  // The author's --axylo-background, if any, is both the decision input and the paint.
  background: 'var(--axylo-background, var(--axylo-default-background))',
  // The chart inherits the page's text color unless the author sets --axylo-text (spec DX6).
  text: 'var(--axylo-text, currentColor)',
});

export const seriesBinding = (index: number): string => `var(--axylo-series-${(index % SERIES_COUNT) + 1})`;

/**
 * Resolves the theme for `element` (the chart root, normally `.axylo`) and sets `data-axylo-scheme` on it.
 * `colors` maps series keys to the author's CSS colors; they are kept as written so `var(--brand-1)` stays
 * live in SVG. Under forced colors the author's colors are set aside for the system colors the stylesheet
 * maps every palette slot to; the chart re-resolves when forced colors toggles (watchTheme reports it).
 */
export function resolveTheme(
  element: HTMLElement,
  seriesKeys: readonly string[],
  colors?: Readonly<Record<string, string>> | null,
): ThemeResolution {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  if (win === null) throw new Error('Axylo: the chart element is not in a document with a window.');
  const forcedColors = win.matchMedia('(forced-colors: active)').matches;
  const moreContrast = win.matchMedia('(prefers-contrast: more)').matches;

  const series = seriesKeys.map((key, i) => {
    const own = colors != null && Object.prototype.hasOwnProperty.call(colors, key) ? colors[key] : undefined;
    return own !== undefined && own.trim() !== '' && !forcedColors ? own : seriesBinding(i);
  });
  const bindings: PaintBindings = { tokens: TOKEN_BINDINGS, series };

  const scheme = decideScheme(element, win);
  if (element.getAttribute('data-axylo-scheme') !== scheme) element.setAttribute('data-axylo-scheme', scheme);

  const expressions = [...TOKENS.map(t => TOKEN_BINDINGS[t]), ...series];
  const computed = probeColors(element, expressions);
  const tokens = {} as Record<PaintToken, string>;
  TOKENS.forEach((t, i) => { tokens[t] = computed[i]!; });
  const paints: PaintBindings = { tokens, series: computed.slice(TOKENS.length) };

  return { bindings, theme: { scheme, forcedColors, moreContrast, paints } };
}

/**
 * Spec L4: `--axylo-background` on the element decides if present; else a computed `color-scheme` that
 * names exactly one of light and dark; else the inherited text color (light text means a dark scheme).
 */
function decideScheme(element: HTMLElement, win: Window): 'light' | 'dark' {
  const style = win.getComputedStyle(element);
  if (style.getPropertyValue('--axylo-background').trim() !== '') {
    const [background] = probeColors(element, ['var(--axylo-background)']);
    const c = parseColor(background!);
    if (c !== null && c.a > 0) return isLightColor(c) ? 'light' : 'dark';
  }
  const words = style.colorScheme.split(/\s+/);
  const light = words.includes('light');
  const dark = words.includes('dark');
  if (light !== dark) return light ? 'light' : 'dark';
  const text = parseColor(normalizeColor(style.color, element.ownerDocument));
  return text !== null && isLightColor(text) ? 'dark' : 'light';
}

/**
 * Lets the browser resolve CSS color expressions in the element's context: one hidden child per expression,
 * all written before any is read so the style is computed once.
 */
function probeColors(element: HTMLElement, expressions: readonly string[]): string[] {
  const doc = element.ownerDocument;
  const win = doc.defaultView!;
  const box = doc.createElement('div');
  box.style.setProperty('display', 'none');
  const probes = expressions.map(expression => {
    const probe = doc.createElement('span');
    // Without this, forced colors would replace every probed value with CanvasText.
    probe.style.setProperty('forced-color-adjust', 'none');
    probe.style.setProperty('color', expression);
    box.appendChild(probe);
    return probe;
  });
  box.style.setProperty('forced-color-adjust', 'none');
  element.appendChild(box);
  const values = probes.map(p => win.getComputedStyle(p).color);
  box.remove();
  return values.map(v => normalizeColor(v, doc));
}

/**
 * Computed colors are rgb()/rgba() for most inputs but keep other spaces (oklch(), lab()) as written.
 * Those are converted by painting one pixel, so canvas and the contrast check always get sRGB.
 */
function normalizeColor(value: string, doc: Document): string {
  if (parseColor(value) !== null) return value;
  const canvas = doc.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx === null) return value;
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(((a ?? 255) / 255) * 1000) / 1000})`;
}
