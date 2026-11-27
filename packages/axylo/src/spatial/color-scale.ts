/**
 * Quantized color scales for the spatial charts (`axylo/spatial`): a perceptually ordered sequential scale
 * (viridis anchors) and a symmetric diverging scale (blue–white–red anchors), both interpolated in OKLab.
 *
 * A value maps to one of `bins` quantized colors so the renderer can batch every cell of one color into one
 * path. The color is drawn through CSS: each bin is a `color-mix(in oklab, …)` of two anchors, and each anchor
 * is a custom property with a private default (`var(--axylo-sequential-0, #440154)`), so a page can restyle the
 * scale without a redraw and without a stylesheet of ours. In forced colors `--axylo-forced-series` (set only
 * there, by the core stylesheet) replaces every bin with the user's system text color: color then carries
 * nothing, and the chart says so (the summary points to the exact readings and the table).
 *
 * Pure: no DOM, nothing at import time beyond literals.
 */

export type ColorScheme = 'sequential' | 'diverging';

export const DEFAULT_BINS = 32;
export const MIN_BINS = 2;
export const MAX_BINS = 64;

/** Viridis at 0, 0.25, 0.5, 0.75, 1: lightness rises monotonically, readable with every common color deficiency. */
export const SEQUENTIAL_ANCHORS: readonly string[] = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'];
/** RdBu-like anchors; the two arms are matched in OKLab lightness so equal distances from the midpoint read alike. */
export const DIVERGING_ANCHORS: readonly string[] = ['#2b5c9e', '#8fb4d9', '#f2f2f2', '#e0938a', '#a8343f'];

/** A bin count the scale accepts, or null: an integer from 2 to 64. */
export function validBins(input: unknown): number | null {
  return typeof input === 'number' && Number.isInteger(input) && input >= MIN_BINS && input <= MAX_BINS ? input : null;
}

/**
 * The bin of `v` on a sequential scale over [lo, hi] (lo < hi). Values outside the domain go to the end bins.
 * Computed on halves so a domain spanning most of the double range (-1e308 to 1e308) does not overflow.
 * A degenerate domain (lo >= hi, or an end that is not finite) puts every value in the middle bin.
 */
export function sequentialBin(v: number, lo: number, hi: number, bins: number): number {
  const span = hi / 2 - lo / 2;
  if (!(span > 0) || !Number.isFinite(span)) return bins >> 1;
  const t = (v / 2 - lo / 2) / span;
  if (!(t > 0)) return 0;
  if (t >= 1) return bins - 1;
  return Math.min(bins - 1, Math.floor(t * bins));
}

/**
 * The bin of `v` on a diverging scale centred on `mid` with half-width `radius` (the larger distance of the
 * domain's ends from the midpoint). Symmetric by construction: the bin depends on the side of `mid` and on
 * |v - mid| only, so a value and its mirror image land in mirrored bins (b and bins - 1 - b). With an odd bin
 * count the middle bin holds the values closest to the midpoint on both sides.
 */
export function divergingBin(v: number, mid: number, radius: number, bins: number): number {
  const half = radius / 2;
  const centre = (bins - 1) / 2;
  if (!(half > 0) || !Number.isFinite(half)) return Math.floor(centre);
  const d = Math.abs(v / 2 - mid / 2) / half;
  const above = v >= mid;
  if (bins % 2 === 0) {
    const arm = bins / 2;
    const k = d >= 1 ? arm - 1 : Math.min(arm - 1, Math.floor(d * arm));
    return above ? arm + k : arm - 1 - k;
  }
  // Odd: the centre bin is as wide as one bin of an arm, straddling the midpoint.
  const arm = centre;
  const k = d >= 1 ? arm : Math.min(arm, Math.floor(d * (arm + 0.5) + 0.5));
  return above ? centre + k : centre - k;
}

/** Where a bin's color sits along the anchors, 0 to 1 (its centre). */
export function binPosition(bin: number, bins: number): number {
  return (bin + 0.5) / bins;
}

function anchorsOf(scheme: ColorScheme): readonly string[] {
  return scheme === 'diverging' ? DIVERGING_ANCHORS : SEQUENTIAL_ANCHORS;
}

function anchorVar(scheme: ColorScheme, index: number): string {
  return `var(--axylo-${scheme}-${index}, ${anchorsOf(scheme)[index]})`;
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}

/** The anchor segment and the weight of its first anchor at position t. */
function segmentAt(t: number, anchors: number): { readonly index: number; readonly weight: number } {
  const scaled = Math.min(Math.max(t, 0), 1) * (anchors - 1);
  const index = Math.min(anchors - 2, Math.floor(scaled));
  return { index, weight: 1 - (scaled - index) };
}

/**
 * The CSS color of a position on a scheme, as a live expression of the anchors (author-overridable custom
 * properties with private defaults). Wrapped in `--axylo-forced-series` so forced colors gives a system color.
 */
export function colorAt(scheme: ColorScheme, t: number): string {
  const { index, weight } = segmentAt(t, anchorsOf(scheme).length);
  const share = round4(weight * 100);
  const mixed = share >= 100 ? anchorVar(scheme, index)
    : share <= 0 ? anchorVar(scheme, index + 1)
    : `color-mix(in oklab, ${anchorVar(scheme, index)} ${share}%, ${anchorVar(scheme, index + 1)})`;
  return `var(--axylo-forced-series, ${mixed})`;
}

/** The CSS color of one bin. */
export function binColor(scheme: ColorScheme, bin: number, bins: number): string {
  return colorAt(scheme, binPosition(bin, bins));
}

// ───────────────────────────── OKLab (default colors, for checks and the legend's fallbacks) ─────────────────────────────

export type Oklab = readonly [number, number, number];

function channel(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** OKLab of an `#rrggbb` color (Björn Ottosson's matrices). */
export function hexToOklab(hex: string): Oklab {
  const n = parseInt(hex.slice(1), 16);
  const r = channel(((n >> 16) & 255) / 255), g = channel(((n >> 8) & 255) / 255), b = channel((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** The default (unstyled) OKLab color at position t: the same interpolation the CSS `color-mix` performs. */
export function defaultOklabAt(scheme: ColorScheme, t: number): Oklab {
  const anchors = anchorsOf(scheme);
  const { index, weight } = segmentAt(t, anchors.length);
  const a = hexToOklab(anchors[index]!), b = hexToOklab(anchors[index + 1]!);
  return [a[0] * weight + b[0] * (1 - weight), a[1] * weight + b[1] * (1 - weight), a[2] * weight + b[2] * (1 - weight)];
}

/** The default OKLab color of one bin. */
export function defaultBinOklab(scheme: ColorScheme, bin: number, bins: number): Oklab {
  return defaultOklabAt(scheme, binPosition(bin, bins));
}

// ───────────────────────────── domains ─────────────────────────────

export interface ScaleDomain {
  readonly scheme: ColorScheme;
  /** Ends of the colored range; for diverging, symmetric about `mid`. */
  readonly lo: number;
  readonly hi: number;
  /** Diverging midpoint (NaN for sequential). */
  readonly mid: number;
  /** Diverging half-width: the larger distance of the domain's ends from `mid` (NaN for sequential). */
  readonly radius: number;
  readonly bins: number;
  /** True when the range has no width (one distinct value): every value takes the middle bin. */
  readonly degenerate: boolean;
}

/** The bin of a finite value under a resolved domain. */
export function binOf(domain: ScaleDomain, v: number): number {
  return domain.scheme === 'diverging'
    ? divergingBin(v, domain.mid, domain.radius, domain.bins)
    : sequentialBin(v, domain.lo, domain.hi, domain.bins);
}

/**
 * A sequential or diverging domain from finite ends lo <= hi. For diverging the colored range is widened to be
 * symmetric about `mid`, so equal distances from the midpoint get equal color strength on both arms.
 */
export function makeDomain(scheme: ColorScheme, lo: number, hi: number, mid: number, bins: number): ScaleDomain {
  if (scheme === 'diverging') {
    const radius = Math.max(Math.abs(lo / 2 - mid / 2), Math.abs(hi / 2 - mid / 2)) * 2;
    const r = Number.isFinite(radius) ? radius : Number.MAX_VALUE;
    return {
      scheme, mid, radius: r, bins, degenerate: !(r > 0),
      lo: Math.max(-Number.MAX_VALUE, mid - r), hi: Math.min(Number.MAX_VALUE, mid + r),
    };
  }
  return { scheme, lo, hi, mid: NaN, radius: NaN, bins, degenerate: !(hi > lo) };
}
