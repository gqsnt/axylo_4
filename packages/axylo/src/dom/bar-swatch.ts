/**
 * The bar and histogram legend swatch: a filled square with the bar's pattern past the eighth series (spec F9).
 * Its own module so only the kinds that draw bars carry scene/bars.
 */
import { barPattern } from '../scene/bars';
import { swatchPattern, type SwatchPattern } from './swatch';
import type { SeriesSwatch } from './interaction-types';

export function seriesPattern(index: number): SwatchPattern['kind'] | null {
  const p = barPattern(index, false);
  return p === 'none' ? null : p;
}

export const barSwatch: SeriesSwatch = (color, cue, hollow) => {
  const p = seriesPattern(color);
  return { color, cue, line: false, hollow, fill: true, pattern: p && swatchPattern(p) };
};
