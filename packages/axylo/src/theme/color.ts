/**
 * Color arithmetic for contrast checks (spec L2, A5). Pure: runs in Node. Input is what the browser hands
 * back from getComputedStyle (`rgb()`, `rgba()`, `color(srgb …)`) plus hex, which the default palette is
 * written in. Anything else returns null rather than a guess.
 */
import type { ResolvedTheme } from '../core/contracts';

/** sRGB channels and alpha, each 0–1. */
export interface Rgba { readonly r: number; readonly g: number; readonly b: number; readonly a: number }

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function channel(token: string, scale: number): number {
  if (token.endsWith('%')) return clamp01(parseFloat(token) / 100);
  if (token === 'none') return 0;
  return clamp01(parseFloat(token) / scale);
}

function alpha(token: string | undefined): number {
  if (token === undefined) return 1;
  return channel(token, 1);
}

/** Parses a computed color string. Returns null for anything that is not a plain sRGB color. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) return parseHex(s.slice(1));
  const open = s.indexOf('(');
  if (open < 0 || !s.endsWith(')')) return null;
  const name = s.slice(0, open).trim();
  // Both the legacy comma form and the space form with "/ alpha".
  const body = s.slice(open + 1, -1).replace(/,/g, ' ').replace('/', ' / ');
  const parts = body.split(/\s+/).filter(p => p.length > 0);
  const slash = parts.indexOf('/');
  const main = slash >= 0 ? parts.slice(0, slash) : parts;
  const alphaToken = slash >= 0 ? parts[slash + 1] : undefined;
  let r: number, g: number, b: number, a: number;
  if (name === 'rgb' || name === 'rgba') {
    if (main.length < 3) return null;
    const legacyAlpha = main.length === 4 ? main[3] : alphaToken;
    r = channel(main[0]!, 255); g = channel(main[1]!, 255); b = channel(main[2]!, 255); a = alpha(legacyAlpha);
  } else if (name === 'color') {
    if (main[0] !== 'srgb' || main.length < 4) return null;
    r = channel(main[1]!, 1); g = channel(main[2]!, 1); b = channel(main[3]!, 1); a = alpha(alphaToken);
  } else {
    return null;
  }
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(a)) return null;
  return { r, g, b, a };
}

function parseHex(h: string): Rgba | null {
  if (!/^[0-9a-f]+$/.test(h)) return null;
  const full = h.length === 3 || h.length === 4 ? h.split('').map(c => c + c).join('') : h;
  if (full.length !== 6 && full.length !== 8) return null;
  const at = (i: number): number => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) : 1 };
}

/** A translucent color as it appears over an opaque background. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** WCAG 2 relative luminance of an opaque color. */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** WCAG 2 contrast ratio, 1–21. A translucent foreground is first composited over the background. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const fg = foreground.a < 1 ? composite(foreground, background) : foreground;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * True when a color reads as light: it contrasts more with black than with white. Used for the scheme
 * decision (spec L4): light text means a dark background, a light background means a light scheme.
 */
export function isLightColor(c: Rgba): boolean {
  return relativeLuminance(c) > Math.sqrt(1.05 * 0.05) - 0.05;
}

/** Indexes of series paints below 3:1 against the resolved background (the caller raises AX141). */
export function lowContrastSeries(theme: ResolvedTheme): number[] {
  const background = parseColor(theme.paints.tokens.background);
  const low: number[] = [];
  if (background === null || background.a === 0) return low;
  const opaque = background.a < 1 ? composite(background, { r: 1, g: 1, b: 1, a: 1 }) : background;
  theme.paints.series.forEach((paint, i) => {
    const c = parseColor(paint);
    if (c !== null && contrastRatio(c, opaque) < 3) low.push(i);
  });
  return low;
}
