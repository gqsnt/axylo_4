import type { BandScale, Tick, TickCandidates } from '../core/contracts';

/**
 * Bands of equal width. `padding` is the fraction of a step left empty, the same between bands and at both
 * ends, so the outer gaps match the inner ones. The range may run backwards (a vertical category axis
 * drawn top to bottom from a bottom origin); `map` always returns the lower pixel edge of the band, so a
 * rectangle at map(i) with width `bandwidth` covers it either way.
 */
export function bandScale(count: number, range: readonly [number, number], padding: number): BandScale {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const p = Number.isFinite(padding) ? Math.min(Math.max(padding, 0), 0.95) : 0;
  const r0 = range[0];
  const r1 = range[1];
  const extent = Math.abs(r1 - r0);
  const forward = r1 >= r0;
  const step = n === 0 ? 0 : extent / (n + p);
  const bandwidth = step * (1 - p);
  const outer = step * p;

  // Offset of band i's leading edge from range[0], measured along the range direction.
  const lead = (i: number): number => outer + i * step;
  const map = (i: number): number => (forward ? r0 + lead(i) : r0 - lead(i) - bandwidth);

  return {
    type: 'band',
    count: n,
    range: [r0, r1],
    step,
    bandwidth,
    map,
    center: (i: number) => map(i) + bandwidth / 2,
    invert(pixel: number): number {
      if (n === 0) return -1;
      if (step === 0 || !Number.isFinite(pixel)) return 0;
      const along = forward ? pixel - r0 : r0 - pixel;
      // Nearest band centre, so a pixel in the padding belongs to the closer band.
      const i = Math.round((along - outer - bandwidth / 2) / step);
      return Math.min(Math.max(i, 0), n - 1);
    },
  };
}

/**
 * Sets of category labels, densest first: every category, then every k-th, always keeping the first.
 *
 * Strides are 1 to 10, then 20, 50, 100, 200, 500, … (1, 2, 5 × 10^k), so there are about 3·log10(n) + 10
 * sets for n categories. Sets are built on first read and kept, so laying out 100,000 categories costs
 * only the sets layout actually looks at. The result is still a plain readonly array of arrays.
 */
export function bandTickCandidates(labels: readonly string[]): TickCandidates {
  const n = labels.length;
  if (n === 0) return [];
  const strides: number[] = [];
  let lastSize = Infinity;
  for (const k of strideSequence(n)) {
    const size = Math.ceil(n / k);
    if (size < lastSize) {
      strides.push(k);
      lastSize = size;
    }
    if (size === 1) break;
  }
  const sets: Tick[][] = [];
  strides.forEach((k, index) => {
    let built: Tick[] | null = null;
    Object.defineProperty(sets, index, {
      enumerable: true,
      get(): Tick[] {
        if (built === null) {
          const set: Tick[] = [];
          for (let i = 0; i < n; i += k) set.push({ value: i, label: labels[i] as string });
          built = set;
        }
        return built;
      },
    });
  });
  return sets;
}

/** 1, 2, …, 10, 20, 50, 100, 200, 500, … up to the first stride at or above n. */
function strideSequence(n: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= 10; k++) out.push(k);
  for (let base = 10; out[out.length - 1]! < n; base *= 10) out.push(2 * base, 5 * base, 10 * base);
  return out;
}
