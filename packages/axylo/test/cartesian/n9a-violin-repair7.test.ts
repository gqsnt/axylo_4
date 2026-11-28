import { describe, expect, it } from 'vitest';
import { violinData } from '../../src/stats';
import { position } from '../../src/scene/geometry';
import { n5run, xPixel, yScaleOf, type N5Run } from './n5-pipeline';

describe('N9a repair 7', () => {
  it("a mixed median column ['2', 2] rejects the string by whole-column auto mode, so row 0 is not also an AX106 grid", () => {
    const rows = [
      { x: 'A', median: '2', grid: [], density: [] },
      { x: 'B', median: 2, grid: [0, 1], density: [1, 1] },
    ];
    const run = n5run({ data: rows, x: 'x', axes: { v: { position: 'left' } }, layers: [{ type: 'violin', yAxis: 'v', median: 'median' }] });
    expect(run.diagnostics.filter(d => d.field === "grid")).toEqual([]);
  });
});
