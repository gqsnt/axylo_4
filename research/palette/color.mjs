// Pure color math and the palette constraints of decision 0003, shared by the solver, the scorer and the
// preview. No dependencies, no I/O. The formulas match research/harness/palette.mjs, which scored the ten
// libraries in finding R7: WCAG 2 relative luminance and contrast; OKLab (Ottosson 2020); color-vision
// deficiency simulated with the Machado, Oliveira and Fernandes (2009) matrices at severity 1.0, applied in
// linear RGB and clamped to [0, 1] before the OKLab conversion.

export const lin = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const gam = v => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/** '#rrggbb' -> gamma-encoded sRGB channels in [0, 1]. */
export const srgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
/** Gamma-encoded sRGB in [0, 1] -> '#rrggbb' (clamped, rounded). */
export const toHex = rgb => '#' + rgb.map(v => Math.round(255 * clamp01(v)).toString(16).padStart(2, '0')).join('');
export const linear = hex => srgb(hex).map(lin);

export const luminance = hex => { const [r, g, b] = linear(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** Linear sRGB -> OKLab [L, a, b]. */
export function oklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab -> linear sRGB (may be out of gamut). */
export function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** OKLCH (hue in degrees) -> '#rrggbb', or null when outside the sRGB gamut. */
export function lchToHex([L, C, h]) {
  const rad = h * Math.PI / 180;
  const rgb = oklabToLinear([L, C * Math.cos(rad), C * Math.sin(rad)]);
  if (!rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4)) return null;
  return toHex(rgb.map(v => gam(clamp01(v))));
}

/** '#rrggbb' -> OKLCH [L, C, h°]. */
export function lch(hex) {
  const [L, a, b] = oklab(linear(hex));
  const h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return [L, Math.hypot(a, b), h];
}

export const hueDiff = (h1, h2) => { const d = Math.abs(h1 - h2) % 360; return d > 180 ? 360 - d : d; };

export const CVD = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const VISIONS = Object.keys(CVD);

/** Linear RGB as seen under a vision (clamped), for previews and grayscale. */
export const simulateLinear = (rgbLin, vision) => CVD[vision].map(row => clamp01(row[0] * rgbLin[0] + row[1] * rgbLin[1] + row[2] * rgbLin[2]));
/** OKLab of a hex color under a vision. */
export const labUnder = (hex, vision) => oklab(simulateLinear(linear(hex), vision));
export const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
export const distUnder = (h1, h2, vision) => dist(labUnder(h1, vision), labUnder(h2, vision));

/** Source-over compositing of `hex` at `alpha` over an opaque background, in gamma-encoded sRGB as browsers do. */
export function compositeHex(hex, alpha, bgHex) {
  const f = srgb(hex), b = srgb(bgHex);
  return toHex(f.map((v, i) => v * alpha + b[i] * (1 - alpha)));
}
/** The same without rounding to 8 bits, so measurements do not depend on the rounding of the composite. */
export function compositeLinear(hex, alpha, bgHex) {
  const f = srgb(hex), b = srgb(bgHex);
  return f.map((v, i) => lin(v * alpha + b[i] * (1 - alpha)));
}

/** Smallest pairwise OKLab distance under one vision, with the pair. */
export function minPair(colors, vision) {
  const labs = colors.map(c => labUnder(c, vision));
  let min = Infinity, pair = null;
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
    const d = dist(labs[i], labs[j]);
    if (d < min) { min = d; pair = [i, j]; }
  }
  return { min, pair };
}

/** Adjacent pairs of a stacked area or donut with `n` parts: k and k+1, and the closing pair (n, 1) of a ring. */
export function neighbourPairs(n) {
  const pairs = [];
  for (let k = 0; k + 1 < n; k++) pairs.push([k, k + 1]);
  return pairs;
}
export function ringClosures(n) {
  const pairs = [];
  for (let m = 3; m <= n; m++) pairs.push([m - 1, 0]);
  return pairs;
}

// Tokens no series color may come within THRESHOLDS.token of: focus and reference (constraint 5) and muted,
// which paints the donut's "Other" slice beside series slices.
export const TOKEN_NAMES = ['focus', 'reference', 'muted'];

export const THRESHOLDS = {
  contrast: 3,
  minDelta: 0.10,
  prefix4: 0.14,
  hueMatch: 30,
  token: 0.10,
  composite: 0.06,
  alphas: [0.25, 0.8],
  prefixes: [3, 4, 5, 6],
};

/**
 * Every measured quantity of constraints 1–6 for one scheme. `scheme` is { background, focus, reference, series }.
 * `other` is the other scheme, for the hue match (constraint 4), optional.
 */
export function measureScheme(scheme, other) {
  const { background: bg, series } = scheme;
  const contrastBy = series.map(c => contrast(c, bg));
  const full = Object.fromEntries(VISIONS.map(v => [v, minPair(series, v)]));
  const prefixes = Object.fromEntries(THRESHOLDS.prefixes.map(n => [n, Object.fromEntries(VISIONS.map(v => [v, minPair(series.slice(0, n), v)]))]));
  const tokens = {};
  for (const t of TOKEN_NAMES) {
    const d = series.map(c => distUnder(c, scheme[t], 'normal'));
    const k = d.indexOf(Math.min(...d));
    tokens[t] = { min: d[k], slot: k };
  }
  const composites = {};
  for (const alpha of THRESHOLDS.alphas) {
    const labs = Object.fromEntries(VISIONS.map(v => [v, series.map(c => oklab(simulateLinear(compositeLinear(c, alpha, bg), v)))]));
    const at = (pairs, v) => pairs.map(([i, j]) => ({ pair: [i, j], d: dist(labs[v][i], labs[v][j]) }));
    composites[alpha] = Object.fromEntries(VISIONS.map(v => {
      const nb = at(neighbourPairs(series.length), v), ring = at(ringClosures(series.length), v);
      const lo = list => list.reduce((m, x) => (x.d < m.d ? x : m), { d: Infinity, pair: null });
      return [v, { neighbours: nb, ring, minNeighbour: lo(nb), minRing: lo(ring) }];
    }));
  }
  const hue = other ? series.map((c, k) => hueDiff(lch(c)[2], lch(other.series[k])[2])) : null;
  return { contrast: contrastBy, full, prefixes, tokens, composites, hue };
}

/** The hard constraints as a list of { id, ok, value, limit, label } for one scheme. */
export function checkScheme(scheme, other) {
  const m = measureScheme(scheme, other), T = THRESHOLDS, out = [];
  out.push({ id: 1, label: 'lowest contrast on background', value: Math.min(...m.contrast), limit: T.contrast });
  for (const v of VISIONS) out.push({ id: 2, label: `min pairwise ΔE (all 8), ${v}`, value: m.full[v].min, limit: T.minDelta });
  for (const n of T.prefixes) for (const v of VISIONS) out.push({ id: 3, label: `min pairwise ΔE (first ${n}), ${v}`, value: m.prefixes[n][v].min, limit: n === 4 ? T.prefix4 : T.minDelta });
  if (m.hue) out.push({ id: 4, label: 'largest light/dark hue difference per slot (°)', value: Math.max(...m.hue), limit: T.hueMatch, upper: true });
  for (const t of TOKEN_NAMES) out.push({ id: 5, label: `nearest series to ${t} token`, value: m.tokens[t].min, limit: T.token });
  for (const a of T.alphas) out.push({ id: 6, label: `min neighbour ΔE at ${a * 100}% opacity, normal`, value: m.composites[a].normal.minNeighbour.d, limit: T.composite });
  for (const c of out) c.ok = c.upper ? c.value <= c.limit : c.value >= c.limit;
  return { checks: out, measured: m };
}
