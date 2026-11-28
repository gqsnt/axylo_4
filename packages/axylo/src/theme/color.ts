/**
 * Color arithmetic for contrast checks (spec L2, A5). Pure: runs in Node. Input is what the browser hands
 * back from getComputedStyle (`rgb()`, `rgba()`, `color(srgb …)`) plus hex, which the default palette is
 * written in. Anything else returns null rather than a guess.
 */
import type { ResolvedTheme } from "../core/contracts";

/** sRGB channels and alpha, each 0–1. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const ch = (token: string, scale: number): number =>
  token === "none" ? 0 : clamp01(parseFloat(token) / (token.endsWith("%") ? 100 : scale));

export const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1 };
const parsedColors = new Map<string, Rgba | null>();

/** Parses a computed color string. Returns null for anything that is not a plain sRGB color. */
export function parseColor(input: string): Rgba | null {
  if (input.length > 128) return parseUncached(input);
  const cached = parsedColors.get(input);
  if (cached !== undefined) return cached;
  const color = parseUncached(input);
  if (parsedColors.size === 128) parsedColors.clear();
  parsedColors.set(input, color && Object.freeze(color));
  return color;
}

function parseUncached(input: string): Rgba | null {
  if (input.endsWith(")")) {
    const rgb = input.startsWith("rgb(");
    if (rgb || input.startsWith("rgba(")) {
      const color = commaRgb(input, rgb ? 4 : 5, !rgb);
      if (color) return color;
    }
  }
  const s = input.trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith("#")) return parseHex(s);
  const open = s.indexOf("(");
  if (open < 0 || !s.endsWith(")")) return null;
  const name = s.slice(0, open).trim();
  const parts = s
    .slice(open + 1, -1)
    .replace(/,/g, " ")
    .replace("/", " / ")
    .split(/\s+/)
    .filter(Boolean);
  const slash = parts.indexOf("/");
  const count = slash < 0 ? parts.length : slash;
  let alpha = slash < 0 ? undefined : parts[slash + 1];
  const srgb = name === "color";
  if (srgb ? parts[0] !== "srgb" || count < 4 : (name !== "rgb" && name !== "rgba") || count < 3)
    return null;
  if (!srgb && count === 4) alpha = parts[3];
  const offset = srgb ? 1 : 0,
    scale = srgb ? 1 : 255;
  const r = ch(parts[offset]!, scale),
    g = ch(parts[offset + 1]!, scale),
    b = ch(parts[offset + 2]!, scale);
  const a = alpha === undefined ? 1 : ch(alpha, 1);
  // Every parsed channel has already been clamped to [0, 1]. Only a failed parse can make the sum non-finite.
  return Number.isFinite(r + g + b + a) ? { r, g, b, a } : null;
}

function unpack(packed: number, shift: number, mask: number, a: number): Rgba {
  return {
    r: (packed >>> (2 * shift)) / mask,
    g: ((packed >>> shift) & mask) / mask,
    b: (packed & mask) / mask,
    a,
  };
}

// CSSOM normally serializes sRGB as comma-separated byte channels with an optional decimal alpha.
function commaRgb(s: string, index: number, hasAlpha: boolean): Rgba | null {
  const end = s.length - 1;
  let packed = 0;
  for (let i = 0; i < 3; i++) {
    const start = index;
    let value = 0;
    let digit = s.charCodeAt(index) - 48;
    while (digit >= 0 && digit <= 9) {
      value = value * 10 + digit;
      if (value > 255) return null;
      digit = s.charCodeAt(++index) - 48;
    }
    if (index === start) return null;
    packed = (packed << 8) | value;
    if (i === 2 && !hasAlpha) break;
    if (s.charCodeAt(index++) !== 44) return null;
    if (s.charCodeAt(index) === 32) index++;
  }
  let a = 1;
  if (hasAlpha) {
    const start = index;
    const digit = s.charCodeAt(index++);
    if (digit !== 48 && digit !== 49) return null;
    if (s.charCodeAt(index) === 46) {
      while (++index < end) {
        const decimal = s.charCodeAt(index) - 48;
        if (decimal < 0 || decimal > 9) return null;
      }
    }
    a = Math.min(1, Number(s.slice(start, index)));
  }
  if (index !== end) return null;
  return unpack(packed, 8, 255, a);
}

function parseHex(s: string): Rgba | null {
  const length = s.length - 1;
  const short = length === 3 || length === 4;
  if (!short && length !== 6 && length !== 8) return null;
  let packed = 0;
  for (let i = 1; i <= length; i++) {
    const code = s.charCodeAt(i);
    const digit = code >= 48 && code <= 57 ? code - 48 : code >= 97 && code <= 102 ? code - 87 : -1;
    if (digit < 0) return null;
    packed = (packed << 4) | digit;
  }
  const shift = short ? 4 : 8;
  const mask = short ? 15 : 255;
  return length === 3 || length === 6
    ? unpack(packed, shift, mask, 1)
    : unpack(packed >>> shift, shift, mask, (packed & mask) / mask);
}

/** A translucent color as it appears over an opaque background. */
export function composite(top: Rgba, under: Rgba): Rgba {
  const a = top.a,
    b = 1 - a;
  return {
    r: top.r * a + under.r * b,
    g: top.g * a + under.g * b,
    b: top.b * a + under.b * b,
    a: 1,
  };
}

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** WCAG 2 relative luminance of an opaque color. */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
}

/** WCAG 2 contrast ratio, 1–21. A translucent foreground is first composited over the background. */
export function contrastRatio(foreground: Rgba, background: Rgba): number {
  const l1 = relativeLuminance(foreground.a < 1 ? composite(foreground, background) : foreground);
  const l2 = relativeLuminance(background);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** True when a color reads as light: it contrasts more with black than with white. */
export function isLightColor(c: Rgba): boolean {
  return relativeLuminance(c) > Math.sqrt(1.05 * 0.05) - 0.05;
}

/** Indexes of series paints below 3:1 against the background (the caller raises AX141). */
export function lowContrastSeries(theme: ResolvedTheme, backdrop?: string): number[] {
  const bg = parseColor(theme.paints.tokens.background),
    low: number[] = [];
  if (!bg) return low;
  let under = (backdrop !== undefined && parseColor(backdrop)) || WHITE;
  if (under.a < 1) under = composite(under, WHITE);
  const opaque = bg.a < 1 ? composite(bg, under) : bg;
  theme.paints.series.forEach((paint, i) => {
    const c = parseColor(paint);
    if (c && contrastRatio(c, opaque) < 3) low.push(i);
  });
  return low;
}
