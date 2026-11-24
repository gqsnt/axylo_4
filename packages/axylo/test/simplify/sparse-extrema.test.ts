import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { linearScale } from '../../src/scale/linear';
import { drawing } from '../../src/scene/lines';
import { buildPath, simplifyLine } from '../../src/simplify';

describe('dense affine geometry', () => {
  it('keeps the earliest plateau extrema through resizes and clipped ranges', () => {
    const levels = fc.array(fc.integer({ min: -7, max: 7 }), { minLength: 3, maxLength: 39 });
    fc.assert(fc.property(levels, fc.boolean(), fc.boolean(), (pattern, inverted, float32) => {
      const count = 4865;
      let time = 1_700_000_000_000;
      const x = Float64Array.from({ length: count }, (_, i) => time += i % 121 < 81 ? 21 : 220);
      const y = new (float32 ? Float32Array : Float64Array)(count);
      for (let i = 0; i < count; i++) y[i] = pattern[Math.floor(i / 89) % pattern.length]! / 3;
      const slot = new Uint8Array(count);
      for (const [start, end, width, ratio] of [[0, count, 31, 1], [11, count - 100, 19.5, 2]] as const) {
        const left = -10.75;
        const right = left + width;
        const xy = {
          kind: 'xy',
          x: linearScale([x[start]!, x[end - 1]!], inverted ? [right, left] : [left, right]),
          y: linearScale([-1, 2], [30, -5]),
        } as const;
        const input = { ...drawing(x, xy, { x: left, y: -5, width, height: 35 }, ratio), y, slot, range: { start, end } };
        const columns = new Map<number, number[]>();
        for (let i = start; i < end; i++) {
          const pixel = Math.floor(xy.x.map(x[i]!) * ratio);
          const column = columns.get(pixel);
          if (column) column.push(i);
          else columns.set(pixel, [i]);
        }
        const expected = [...columns.values()].flatMap(column => {
          const values = column.map(i => y[i]!);
          const keep = new Set([column[0], column.at(-1), column[values.indexOf(Math.min(...values))],
            column[values.indexOf(Math.max(...values))]]);
          return column.filter(index => keep.has(index));
        });
        const kept = simplifyLine(input);
        expect(kept.indexes).toEqual(Uint32Array.from(expected));
        expect(kept.breaks).toHaveLength(0);
        expect(kept.isolated).toHaveLength(0);
        const coordinates = Float32Array.from(expected.flatMap(i => [xy.x.map(x[i]!), xy.y.map(y[i]!)])).buffer;
        expect(new Uint32Array(buildPath(kept.indexes, kept.breaks, input).buffer)).toEqual(new Uint32Array(coordinates));
      }
    }));
  });

  it('packs the exact sign of zero at affine endpoints', () => {
    const x = Float64Array.of(-0, 1, 2);
    const xy = { kind: 'xy', x: linearScale([0, 2], [-0, -2]), y: linearScale([0, 2], [2, -0]) } as const;
    const input = drawing(x, xy, { x: -2, y: 0, width: 2, height: 2 }, 1);
    const path = buildPath(Uint32Array.of(0, 1, 2), new Uint32Array(), { ...input, y: x });
    expect(new Uint32Array(path.buffer)).toEqual(new Uint32Array(Float32Array.of(-0, 2, -1, 1, -2, -0).buffer));
  });
});
