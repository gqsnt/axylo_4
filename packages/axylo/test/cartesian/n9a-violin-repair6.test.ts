/**
 * N9a repair round 6: clipping crossings at tiny magnitudes, and empty payloads on rows whose median the chart reads
 * from a decimal string (data/values: a decimal string is read as its number).
 */
import { describe, expect, it } from 'vitest';
import { violinData } from '../../src/stats';
import { position } from '../../src/scene/geometry';
import { n5run, xPixel, yScaleOf, type N5Run } from './n5-pipeline';

const payloadIssues = (run: N5Run) => run.diagnostics.filter(d => d.field === 'grid' || d.field === 'density');

describe('N9a repair 6', () => {
  it('a violin of [3e-200] on [0, 6e-200] over a pinned [2e-200, 4e-200] anchors and wins the pick at its centre', () => {
    const { data } = violinData([{ g: 'A', v: 3e-200 }], { group: 'g', value: 'v', clamp: [0, 6e-200], bandwidth: 1e-200, points: 2 });
    const run = n5run({
      data: { columns: { ...data.columns, mark: [NaN] } }, x: 'x', axes: { v: { position: 'left', domain: [2e-200, 4e-200] } },
      layers: [{ type: 'scatter', y: 'mark', yAxis: 'v' }, { type: 'violin', yAxis: 'v', inner: 'none' }],
    });
    const key = run.view.frame.series[1]!.key;
    const anchor = run.lookup.anchor({ kind: 'aligned', seriesKey: key, x: 0 });
    expect(anchor).not.toBeNull();
    for (const value of [anchor!.x, anchor!.y, anchor!.width, anchor!.height]) expect(Number.isFinite(value)).toBe(true);
    const px = xPixel(run.layout, run.view, 0), mid = position(yScaleOf(run.layout, 0), 3e-200);
    const hit = run.lookup.pick(px, mid), ref = hit && run.lookup.primary(hit);
    expect(ref && ref.kind === 'aligned' ? ref.seriesKey : null).toBe(key);
  });

  it("reports AX106 on an empty payload whose median is the decimal string '2', and stays silent for no data", () => {
    const rows = [
      { x: 'A', min: 1, q1: 1.5, median: '2', q3: 2.5, max: 3, grid: [], density: [] },
      // A missing (null) median, not a row-form NaN: a NaN in a row object is a non-finite number, which makes the
      // column's strings non-numeric to the chart (review sol-6.2-medium__20261127T220111Z; repair 8 covers it).
      { x: 'B', min: null, q1: null, median: null, q3: null, max: null, n: 0, grid: [], density: [] },
    ];
    const run = n5run({
      data: rows, x: 'x', axes: { v: { position: 'left' } },
      layers: [{ type: 'violin', yAxis: 'v', median: { field: 'median', parse: 'number' } }],
    });
    expect(payloadIssues(run).map(d => [d.code, d.field, d.rows])).toEqual([['AX106', 'grid', [0]]]);
  });
});
