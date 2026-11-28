import { describe, expect, it } from 'vitest';
import { paintedMap } from '../../../src/spatial/bubble/paint';
import { geometryOf } from './oracle';

// Independent decoder: walks M / a / Z of a whole-circle path and returns each closed circle's radius, its
// diameter step and how far its end lands from its start, so a moved end point or a radius that differs from the
// diameter (an area that is not the size's) shows up.
function decode(d: string): { r: number; dx: number; miss: number }[] {
  const t = d.match(/[MaAZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: { r: number; dx: number; miss: number }[] = [];
  let k = 0, sx = 0, sy = 0, x = 0, y = 0, r = 0, dx = 0;
  while (k < t.length) {
    const c = t[k++]!;
    if (c === 'M') { sx = x = Number(t[k++]); sy = y = Number(t[k++]); }
    else if (c === 'a') { r = Number(t[k++]); k += 4; const ddx = Number(t[k++]); x += ddx; y += Number(t[k++]); if (ddx > 0) dx = ddx; }
    else if (c === 'Z') out.push({ r, dx, miss: Math.hypot(x - sx, y - sy) });
    else throw new Error(`unexpected ${c}`);
  }
  return out;
}

describe('whole-circle arcs keep the size-proportional area', () => {
  it('separated sizes 1 and 2 at max 24 paint areas in ratio 1:2, closed, diameter = 2 r', () => {
    const r1 = 24 * Math.sqrt(1 / 2), r2 = 24;
    const g = geometryOf([{ x: 40.003, y: 50.007, r: r1, series: 0, row: 0 }, { x: 140.004, y: 50.006, r: r2, series: 0, row: 1 }]);
    const circles = decode(paintedMap(g, 1).series[0]!.d);
    expect(circles).toHaveLength(2);
    for (const c of circles) { expect(c.miss).toBe(0); expect(c.dx).toBe(2 * c.r); }
    const [a, b] = [...circles].sort((p, q) => p.r - q.r);
    expect(Math.abs((b!.r * b!.r) / (a!.r * a!.r) - 2)).toBeLessThan(1e-6);
    expect(Math.abs(a!.r - r1)).toBeLessThan(1e-4);
  });
});
