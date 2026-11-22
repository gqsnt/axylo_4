import fc from 'fast-check';
import { expect, it } from 'vitest';
import { computeLayout } from '../../src/layout';
import { sector, SECTOR_ARCS, SECTOR_RING } from '../../src/render/geometry';
import { createSvgRenderer } from '../../src/render/svg';
import { buildScene } from '../../src/scene';
import { TOKEN_BINDINGS } from '../../src/theme';
import { donut } from '../view/fixtures';
import type { Scene } from '../../src/core/contracts';

const TURN = 2 * Math.PI;

function ringScene(values: readonly number[], width: number, height: number) {
  const { view } = donut(values.map((value, i) => ({ label: 'S' + (i + 1), value })));
  return buildScene(view, computeLayout({ kind: 'ring', width, height }), 1);
}

function svgPaths(scene: Scene): (string | undefined)[] {
  const paths: Map<string, string>[] = [];
  const doc = {
    createElementNS(_namespace: string, tag: string) {
      const attributes = new Map<string, string>();
      const styles = new Map<string, string>();
      if (tag === 'path') paths.push(attributes);
      return {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        append() {},
        appendChild() {},
        style: {
          setProperty: (name: string, value: string) => styles.set(name, value),
          getPropertyValue: (name: string) => styles.get(name) ?? '',
        },
      };
    },
  };
  const bindings = { tokens: TOKEN_BINDINGS, series: Array.from({ length: 8 }, () => 'red') };
  createSvgRenderer(doc as unknown as Document).draw(scene, bindings, 1);
  return paths.map(path => path.get('d'));
}

it('draws all eight dense-donut browser fixture paths, including the 0.1% share', () => {
  // The 720 × 400 host leaves roughly 317 px after the title, one legend line and toolbar.
  const scene = ringScene([600, 200, 100, 50, 30, 15, 4, 1], 720, 317.390625);
  const paths = svgPaths(scene);
  expect(paths).toHaveLength(8);
  for (let i = 0; i < paths.length; i++) expect(paths[i], 'S' + (i + 1)).toMatch(/^M.*A.*Z$/);
});

it('draws positive ordered donut sectors with a full sweep and CSS-pixel gaps', () => {
  const values = fc.array(fc.oneof(fc.constant(1), fc.constant(1e6), fc.integer({ min: 0, max: 6000 }).map(n => 10 ** (n / 1000))),
    { minLength: 1, maxLength: 8 });
  const radius = fc.oneof(fc.constant(40), fc.double({ min: 40, max: 1000, noNaN: true }),
    fc.double({ min: 1000, max: 2 ** 24, noNaN: true }), fc.constant(2 ** 24));
  fc.assert(fc.property(values, radius, (values, radius) => {
    const scene = ringScene(values, Math.max(120, 2 * radius), 2 * radius);
    const mark = scene.marks[0];
    if (mark?.type !== 'arcs') throw new Error('Expected a donut mark');
    expect(mark.fills).toEqual(values.map((_, index) => ({ kind: 'series', index })));
    expect(mark.angles).toHaveLength(values.length * 2);
    const paths = svgPaths(scene);
    expect(paths).toHaveLength(values.length);
    const mid = (mark.r0 + mark.r1) / 2;
    const inset = Math.asin(mark.gap / (2 * mid));
    const scratch = new Float64Array(8);
    expect(mark.angles[0]).toBe(0);
    expect(mark.angles.at(-1)).toBeCloseTo(TURN, 6);
    for (let i = 0; i < values.length; i++) {
      expect(paths[i]).toMatch(/^M.*A.*Z$/);
      const start = mark.angles[2 * i]!;
      const end = mark.angles[2 * i + 1]!;
      const shape = sector(start, end, mark.r0, mark.r1, mark.gap, scratch);
      if (values.length === 1) {
        expect(shape).toBe(SECTOR_RING);
        expect(Math.PI * (mark.r1 ** 2 - mark.r0 ** 2)).toBeGreaterThan(0);
        continue;
      }
      expect(shape).toBe(SECTOR_ARCS);
      // On the outer half of the ring the fill contains the entire angular interval visible at mid-radius.
      const visible = end - start - 2 * inset;
      expect(visible * mid).toBeGreaterThanOrEqual(1);
      expect(visible / 2 * (mark.r1 ** 2 - mid ** 2)).toBeGreaterThan(0);
      const next = i + 1 === values.length ? TURN : mark.angles[2 * i + 2]!;
      expect(next).toBeGreaterThanOrEqual(end);
      expect((next - end + 2 * inset) * mid).toBeGreaterThanOrEqual(1);
    }
  }), { numRuns: 1_500 });
});
