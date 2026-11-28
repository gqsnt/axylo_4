/** Radius precision through serialization (repair N8b-R6): the written radius is the drawn radius to 7 significant digits. */
import { describe, expect, it } from 'vitest';
import { paintedMap } from '../../../src/spatial/bubble/paint';
import { circlesPath, writeRadius } from '../../../src/spatial/bubble/geometry';
import { renderLegend } from '../../../src/spatial/bubble/legend';
import { geometryOf } from './oracle';
import { TestDocument, type TestElement } from '../../core/n3-dom';

const arcRadii = (d: string): number[] => [...d.matchAll(/[Aa]([0-9.e-]+) ([0-9.e-]+) /g)].flatMap(m => [Number(m[1]), Number(m[2])]);
const legendRadii = (radii: number[]): number[] => {
  const doc = new TestDocument();
  const list = doc.createElement('ul') as unknown as HTMLUListElement;
  renderLegend(doc as unknown as Document, list, {
    title: 's', signature: JSON.stringify(radii), entries: radii.map((radius, i) => ({ value: i + 1, radius, text: String(i + 1) })),
  });
  const svg = (list as unknown as TestElement).children[0]!.children[0]!;
  return svg.children.map(c => Number(c.getAttribute('r')));
};

describe('radius precision through path and legend', () => {
  it('max 1.006: one bubble writes radius 1.006 in the painted arcs, the focus path and the legend', () => {
    const g = geometryOf([{ x: 50, y: 50, r: 1.006, series: 0, row: 0 }]);
    const painted = arcRadii(paintedMap(g, 1).series[0]!.d);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.every(r => r === 1.006)).toBe(true);
    const focus = arcRadii(circlesPath(g, Uint32Array.of(0)));
    expect(focus.length).toBeGreaterThan(0);
    expect(focus.every(r => r === 1.006)).toBe(true);
    expect(legendRadii([1.006])).toEqual([1.006]);
  });

  it('sizes 1 and 2 at max 24: radii 24·√(1/2) and 24 keep area ratio 1/2 within 1e-6 in path and legend', () => {
    const small = 24 * Math.sqrt(1 / 2);
    // Separated so neither occludes the other: both are whole circles in the painted path.
    const g = geometryOf([{ x: 30, y: 30, r: small, series: 0, row: 0 }, { x: 120, y: 30, r: 24, series: 0, row: 1 }], 200, 100);
    const painted = [...new Set(arcRadii(paintedMap(g, 1).series[0]!.d))].sort((a, b) => a - b);
    expect(painted).toHaveLength(2);
    expect(Math.abs(painted[0]! - small)).toBeLessThanOrEqual(small * 5e-7);
    expect(painted[1]).toBe(24);
    expect(Math.abs((painted[0]! / painted[1]!) ** 2 - 0.5)).toBeLessThan(1e-6);
    const legend = legendRadii([24, small]);
    expect(legend[0]).toBe(24);
    expect(Math.abs((legend[1]! / legend[0]!) ** 2 - 0.5)).toBeLessThan(1e-6);
  });

  it('for any radius in (0, 1000], the written radius is within 5e-7 relative of it', async () => {
    const fc = (await import('fast-check')).default;
    fc.assert(fc.property(fc.double({ min: 1e-6, max: 1000, noNaN: true }), r => Math.abs(Number(writeRadius(r)) - r) <= r * 5e-7));
  });
});
