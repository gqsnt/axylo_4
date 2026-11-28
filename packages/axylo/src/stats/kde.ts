/**
 * Numeric core of the Gaussian kernel density estimate behind `kde()` and `violinData()` (`axylo/stats`).
 * Internal: the public types and option checks live in `stats.ts`, so the packed `dist/stats.d.ts` names nothing
 * from this file. Every top-level statement is a declaration, so `import 'axylo/stats'` bundles to 0 raw bytes.
 */

/**
 * The window of a kernel, in bandwidths, past which its mass is below 1e-16 (Q(8.3) ≈ 5e-17): mass beyond it
 * cannot change any density value at double precision, so the work per sample stays bounded by that window.
 */
const REACH = 8.3;

/**
 * Upper tail Q(z) = 1 − Φ(z) of the standard normal, for z >= 0, from the Chebyshev fit of erfc in Numerical
 * Recipes (erfcc, fractional error below 1.2e-7 everywhere). A fractional error keeps small tail masses accurate,
 * and the fit is monotone, so cell masses (differences of Q) are never negative by more than rounding.
 */
function upperTail(z: number): number {
  const x = z * Math.SQRT1_2;
  const t = 1 / (1 + 0.5 * x);
  return 0.5 * t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806
    + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
}

/** exp(−z² / 2): the standard normal density without its 1 / √(2π), which Simpson's weight below carries. */
const bell = (z: number) => Math.exp(-0.5 * z * z);

/**
 * Φ(v) − Φ(u) for u <= v, each tail taken on its own side so neither is a difference of two values near 1. A cell
 * narrower than a tenth of the bandwidth is integrated by Simpson's rule instead (relative error below 1e-7): the
 * difference of two nearly equal tails would keep only the tails' own error there. For u = v (a cell of no width)
 * it is the standard normal density at u, the limit of the mass per standard unit, which the caller scales as such.
 */
function between(u: number, v: number): number {
  const w = v - u;
  if (w < 0.1) return (w || 1) * 0.06649038006690546 * (bell(u) + 4 * bell(u / 2 + v / 2) + bell(v));
  const m = u >= 0 ? upperTail(u) - upperTail(v) : v <= 0 ? upperTail(-v) - upperTail(-u) : 1 - upperTail(-u) - upperTail(v);
  return m > 0 ? m : 0;
}

/** (p − q) / h without overflow: two finite values of opposite sign can be further apart than Number.MAX_VALUE. */
function gap(p: number, q: number, h: number): number {
  const d = p - q;
  return Number.isFinite(d) ? d / h : p / h - q / h;
}

/**
 * Density of the sorted finite `sample` on `points` evenly spaced grid values from `lo` to `hi` (a <= lo < hi <= b,
 * both finite; a tight finite clamp may give steps of an ulp, and `estimate` rejects a grid that is not strictly
 * increasing or a density that is not finite). Cells and weights use the stored grid values, so the rounding that
 * makes a tight grid's steps uneven moves no mass; a cell of no width takes the point value.
 *
 * Each value is the estimate's mean over the grid value's own cell, the half steps around it cut to [lo, hi],
 * computed from the normal CDF, so a bandwidth narrower than a grid step is not missed. The kernels are reflected
 * in each finite bound of [a, b]. With support width L = b − a (never computed directly: it can overflow):
 * - L > 2 · REACH · h (or one bound or none): one mirror per finite bound reaches the support; every further image
 *   is past REACH.
 * - otherwise, all images at once as the cosine series of the reflected kernel on [a, b] (the Neumann heat kernel),
 *   1 + 2 Σ exp(−(mπh / L)² / 2) cos(mπθ) cos(mπs), θ and s the sample and point as fractions of [a, b], whose
 *   terms past m = 48 are below 1e-17 there; a bandwidth far above L leaves the constant term only.
 * The result is scaled to unit trapezoid area over the grid (`peak` false) or to a largest value of 1 (`peak` true).
 */
export function densityOnGrid(
  sample: Float64Array, h: number, lo: number, hi: number, a: number, b: number, points: number, peak: boolean,
): [grid: Float64Array, density: Float64Array] {
  const grid = new Float64Array(points), edge = new Float64Array(points + 1), rho = new Float64Array(points);
  const last = points - 1, n = sample.length, half = hi / 2 - lo / 2;
  // lo + t · (hi − lo) keeps a tight clamp's steps exact (4 points on 3 ulps are consecutive doubles); a span past
  // Number.MAX_VALUE falls back to a weighted mean of the ends. The ends are stored exactly.
  const width = hi - lo;
  for (let k = 0; k < points; k++) grid[k] = width < Infinity ? lo + (k / last) * width : (1 - k / last) * lo + (k / last) * hi;
  grid[last] = hi;
  for (let k = 0; k <= points; k++) edge[k] = grid[Math.max(k - 1, 0)]! / 2 + grid[Math.min(k, last)]! / 2;

  // L = b − a when it is finite (exact for a subnormal support, whose halves round onto each other), else from
  // half-differences (bounds of opposite sign near ±Number.MAX_VALUE). c = 2πh / L is 0 for an open side (L infinite),
  // where REACH · h could overflow to Infinity, and Infinity for a bandwidth far above L (the constant term only).
  const q = b - a < Infinity ? 1 : 0.5, span = b * q - a * q, c = 2 * Math.PI * q * (h / span);
  if (c * REACH >= Math.PI) {
    // Cosine series of the kernel reflected in both bounds. Its terms are below 1e-17 once mπh / L > 8.85, so 48
    // reach that at L = 2 · REACH · h; the series of the cell means is the series of each cosine's cell mean.
    // `angle` is π times a value's fraction of [a, b], at most π: the difference to a is exact (Sterbenz) for values
    // close to a, so a narrow support far from 0 keeps its fractions.
    const angle = (p: number) => Math.PI * ((p * q - a * q) / span), terms = new Float64Array(49);
    for (let m = 1; m < 49; m++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += Math.cos(m * angle(sample[i]!));
      // Half of each term, and f starts at n / 2 below: a common factor that the normalization removes.
      terms[m] = sum * Math.exp(-((m * c) ** 2) / 8);
    }
    for (let k = 0; k < points; k++) {
      const u = angle(edge[k]!), v = angle(edge[k + 1]!);
      let f = n / 2;
      // The cell mean of cos(m · s) from its antiderivative: the grid covers at least 3 / 16.6 of [a, b] here, so
      // a cell spans more than 7e-5 and the difference of sines keeps ~1e-12 of the mean.
      // A cell whose half steps round onto its own grid value (steps of one ulp) has no width: its mean is the point value.
      for (let m = 1; m < 49; m++) f += terms[m]! * (v > u ? (Math.sin(m * v) - Math.sin(m * u)) / (m * (v - u)) : Math.cos(m * u));
      rho[k] = Math.max(f, 0);
    }
  } else {
    // Cell values are mean densities in units of half the grid width: a cell's mass times half / its width. The
    // grid here is at least 3 · h wide (L > 2 · REACH · h), so no cell's width underflows in standard units.
    // Adds one kernel to every cell within reach. `z` maps an edge to its standard score, increasing in the edge.
    const spread = (z: (e: number) => number) => {
      let c = 0, top = points;
      while (c < top) {
        const mid = (c + top) >>> 1;
        if (z(edge[mid + 1]!) > -REACH) top = mid; else c = mid + 1;
      }
      for (let zu = z(edge[c]!); c < points && zu < REACH; c++) {
        const zv = z(edge[c + 1]!);
        // A cell of no width (its half steps rounded onto its grid value, so zu = zv): `between` gives the point
        // density in standard units, and h stands for the width, so it is the point density in the same units. On a
        // clamp a few ulps wide with h far below its step, half / h would overflow before the normalization removes
        // the common scale: the floor half · 1e-289 (~2^-960) keeps that cell's value at most ~2^960 times the others
        // and their sum finite, while the peak stays there.
        rho[c] = rho[c]! + between(zu, zv) * (half / (edge[c + 1]! - edge[c]! || h + half * 1e-289));
        zu = zv;
      }
    };
    for (let i = 0; i < n; i++) {
      const x = sample[i]!, left = gap(x, a, h), right = gap(b, x, h);
      spread(e => gap(e, x, h));
      // Mirror images 2a − x and 2b − x, as distances from the bound so nothing overflows (an open bound reaches no cell).
      spread(e => gap(e, a, h) + left);
      spread(e => -(gap(b, e, h) + right));
    }
  }

  // Trapezoid weights of the grid relative to half its width, as halves first so a grid spanning
  // ±Number.MAX_VALUE does not overflow and a tiny grid's weights stay normal.
  let total = 0, top = 0;
  for (let k = 0; k < points; k++) {
    total += rho[k]! * ((grid[Math.min(k + 1, last)]! / 2 - grid[Math.max(k - 1, 0)]! / 2) / half);
    top = Math.max(top, rho[k]!);
  }
  for (let k = 0; k < points; k++) rho[k] = peak ? rho[k]! / top : rho[k]! / total / half;
  return [grid, rho];
}
