import type { BandScale, Tick, TickCandidates } from '../core/contracts';

/**
 * Bands of equal width. `padding` is the fraction of a step left empty, the same between bands and at both
 * ends, so the outer gaps match the inner ones. The range may run backwards (a vertical category axis
 * drawn top to bottom from a bottom origin); `map` always returns the lower pixel edge of the band, so a
 * rectangle at map(i) with width `bandwidth` covers it either way.
 */
export function bandScale(count: number, range: readonly [number, number], padding: number): BandScale {
  const n = Math.max(0, Math.floor(count));
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
 * Sets of category labels: every category, then every 2nd, 3rd, …, always keeping the first. Sets that would
 * not be smaller than the one before are skipped, and so are thinned sets with more ticks than any screen
 * could show, which keeps the cost bounded for very many categories.
 */
export function bandTickCandidates(labels: readonly string[]): TickCandidates {
  const n = labels.length;
  if (n === 0) return [];
  const sets: Tick[][] = [];
  let lastSize = Infinity;
  for (let k = 1; k <= n; k++) {
    const size = Math.ceil(n / k);
    if (size >= lastSize) continue;
    if (k > 1 && size > MAX_THINNED) continue;
    const set: Tick[] = [];
    for (let i = 0; i < n; i += k) set.push({ value: i, label: labels[i] as string });
    sets.push(set);
    lastSize = size;
    if (size === 1) break;
  }
  return sets;
}

/** No axis is wide enough for more labels than this at the 12 px minimum text size (spec L2). */
const MAX_THINNED = 1000;
