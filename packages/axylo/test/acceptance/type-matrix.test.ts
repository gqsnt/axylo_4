import { expect, it } from 'vitest';
import { stepAcross, targetOf } from '../../src/core/focus';
import { aligned, at, axes, chart, codes, committed, day, expectGeometry, lastModel, marks, pixel, plot, reading, refAt, rows, seriesRows, walk } from './model';

const xy = [{ x: 1, y: 6 }, { x: 2, y: 8 }, { x: 3, y: 4 }];
const donut = [{ x: 'First', y: 3 }, { x: 'Zero', y: 0 }, { x: 'Missing', y: null }, { x: 'Last', y: 1 }];

for (const kind of aligned) {
  it(`T-keyboard-${kind} ${kind}: visits once per x then switches through series in declared order (reading: x and series use their own keys)`, () => {
    const categories = kind === 'bar';
    const values = categories ? ['West', 'East'] : [1, 2];
    const r = chart(kind, [
      { x: values[0], s: 'Website', y: 11 }, { x: values[1], s: 'Website', y: 22 },
      { x: values[0], s: 'Phone', y: 33 }, { x: values[1], s: 'Phone', y: 44 },
    ], { series: 's' });
    r.frames();
    const { view, lookup } = committed(r);
    if (view.kind === 'donut' || view.kind === 'scatter') throw new Error('Expected aligned data');
    const [first, second] = categories ? [0, 1] : [1, 2];
    expect(stepAcross(view, null, 'first')).toBe(first);
    expect(stepAcross(view, first, 'next')).toBe(second);
    expect(stepAcross(view, second, 'next')).toBeNull();
    expect(stepAcross(view, second, 'previous')).toBe(first);
    for (const [x, expected] of [[first!, ['11', '33']], [second!, ['22', '44']]] as const) {
      const selected = refAt(r, x);
      const next = lookup.step(selected, 'series-next');
      expect(lookup.datum(selected)?.seriesLabel).toBe('Website');
      expect(lookup.datum(next!)?.seriesLabel).toBe('Phone');
      expect(lookup.step(next, 'series-previous')).toEqual(selected);
      expect([lookup.datum(selected)?.value, lookup.datum(next!)?.value]).toEqual(expected);
    }
  });

  it(`T-pointer-${kind} ${kind}: picks ${kind === 'bar' ? 'the category band under the pointer at either edge' : 'the nearest x regardless of pointer height'}`, () => {
    for (const horizontal of kind === 'bar' ? [false, true] : [false]) {
      const r = chart(kind, kind === 'bar' ? [{ x: 'One', y: 10 }, { x: 'Two', y: 3 }, { x: 'Three', y: 8 }] : xy, horizontal ? { horizontal } : {});
      r.frames();
      const { x } = axes(r);
      const { plot: box } = plot(r);
      const projection = kind === 'bar' ? [0, 1, 2] : [1, 2, 3];
      projection.forEach(position => {
        const across = pixel(x, position);
        const neighbor = kind === 'bar' ? 0 : position === 3 ? -1 : 1;
        const near = neighbor ? across + (pixel(x, position + neighbor) - across) / 4 : across;
        for (const side of [1, (horizontal ? box.width : box.height) - 1]) {
          const [px, py] = horizontal ? [box.x + side, near] : [near, box.y + side];
          expect(committed(r).lookup.pick(px, py)).toEqual({ kind: 'x', x: position });
        }
      });
    }
  });

  it(`T-tooltip-${kind} ${kind}: lists visible series in order and distinguishes No observation from No data`, () => {
    const data = [
      { x: 1, y: 5, s: 'Alpha' }, { x: 2, y: 6, s: 'Alpha' }, { x: 3, y: 7, s: 'Alpha' },
      { x: 1, y: 8, s: 'Beta' }, { x: 2, y: null, s: 'Beta' },
      { x: 1, y: 9, s: 'Gamma' }, { x: 3, y: 11, s: 'Gamma' },
    ];
    const r = chart(kind, data, { series: 's', ...(kind === 'area' ? { stacked: true } : {}) });
    r.frames();
    const readout = at(r, 2);
    expect(readout.rows.map(row => [row.seriesLabel, row.value])).toEqual([
      ['Alpha', '6'], ['Beta', 'No data'], ['Gamma', 'No observation'],
    ]);
    expect(readout.total).toBe(kind === 'area' ? '6 (incomplete)' : null);
    const beta = readout.rows[1]!.ref;
    if (beta.kind !== 'aligned') throw new Error('Expected an aligned series');
    r.controller.actions.toggle(beta.seriesKey);
    r.frames();
    expect(at(r, 2).rows.map(row => row.seriesLabel)).toEqual(['Alpha', 'Gamma']);
    expect(reading(r, refAt(r, 2))).not.toContain('Beta');
  });
}

it('T-keyboard-donut donut: steps through all slices in given order including zero and missing and returns in reverse', () => {
  const r = chart('donut', donut);
  r.frames();
  const { lookup } = committed(r);
  const refs = walk(r);
  expect(refs.map(ref => lookup.datum(ref)?.seriesLabel)).toEqual(['First', 'Zero', 'Missing', 'Last']);
  expect(refs.map(ref => lookup.datum(ref)?.value)).toEqual(['3', '0', 'No data', '1']);
  expect(lookup.step(refs[0]!, 'previous')).toBeNull();
  expect(refs.slice(1).map(ref => lookup.step(ref, 'previous'))).toEqual(refs.slice(0, -1));
});

it('T-keyboard-scatter scatter: moves by x then y across series and can traverse all points in reverse', () => {
  const r = chart('scatter', [{ x: 2, y: 1, s: 'B' }, { x: 1, y: 4, s: 'A' }, { x: 1, y: 3, s: 'B' }, { x: 2, y: 2, s: 'A' }], { series: 's' });
  r.frames();
  const { lookup } = committed(r);
  const refs = walk(r);
  expect(refs.map(ref => lookup.datum(ref)?.row)).toEqual([2, 1, 0, 3]);
  expect(lookup.step(refs[0]!, 'previous')).toBeNull();
  expect(refs.slice(1).map(ref => lookup.step(ref, 'previous'))).toEqual(refs.slice(0, -1));
});

it('T-pointer-donut donut: picks clockwise by arc; the hole and outside of the ring yield no slice', () => {
  const r = chart('donut', donut);
  r.frames();
  const { lookup } = committed(r);
  const arc = marks(r, 'arcs')[0]!;
  const radius = (arc.r0 + arc.r1) / 2;
  expect(lookup.pick(arc.cx + radius, arc.cy)).toEqual({ kind: 'slice', sliceKey: 'First' });
  expect(lookup.pick(arc.cx - radius / Math.sqrt(2), arc.cy - radius / Math.sqrt(2))).toEqual({ kind: 'slice', sliceKey: 'Last' });
  expect(lookup.pick(arc.cx, arc.cy)).toBeNull();
  expect(lookup.pick(arc.cx + arc.r1 + 1, arc.cy)).toBeNull();
});

it('T-pointer-scatter scatter: picks the nearest point within 24 CSS pixels and breaks a distance tie by later caller row', () => {
  const r = chart('scatter', [{ x: 49, y: 5 }, { x: 51, y: 5 }], {
    x: { field: 'x', domain: [0, 100] }, y: { field: 'y', domain: [0, 10] },
  });
  r.frames();
  const { x, y } = axes(r);
  const { lookup } = committed(r);
  const px = pixel(x, 49);
  const py = y.map(5);
  expect(lookup.primary(lookup.pick(px, py + 23.5)!)?.kind).toBe('point');
  expect(lookup.pick(px, py + 24.5)).toBeNull();
  const tx = (px + pixel(x, 51)) / 2;
  const tied = lookup.pick(tx, py)!;
  expect(lookup.datum(lookup.primary(tied)!)?.row).toBe(1);
});

it('T-tooltip-donut donut: tooltip gives slice label, value and percentage independently', () => {
  const r = chart('donut', donut);
  r.frames();
  const { lookup } = committed(r);
  const tooltip = lookup.tooltip(targetOf(walk(r)[0]!));
  expect(tooltip.title).toBe('First');
  expect(tooltip.rows).toMatchObject([{ seriesLabel: 'First', value: '3', percent: '75%' }]);
  expect(tooltip.total).toBeNull();
});

it('T-tooltip-scatter scatter: lists at most eight coincident points, reports the total and includes series, x and y', () => {
  const r = chart('scatter', Array.from({ length: 10 }, (_, i) => ({ x: 3, y: 6, s: 'Point ' + i })), { series: 's' });
  r.frames();
  const { x, y } = axes(r);
  const { lookup } = committed(r);
  const tooltip = lookup.tooltip(lookup.pick(pixel(x, 3), y.map(6))!);
  expect(tooltip.title).toBe('3');
  expect(tooltip.count).toBe(10);
  expect(tooltip.rows).toHaveLength(8);
  expect(tooltip.rows[0]).toMatchObject({ seriesLabel: 'Point 9', x: '3', value: '6', row: 9 });
  expect(tooltip.rows.every(row => row.x === '3' && row.value === '6')).toBe(true);
  expect(new Set(tooltip.rows.map(row => row.seriesLabel)).size).toBe(8);
});

for (const type of ['line', 'area', 'bar', 'scatter'] as const) {
  it(`T-zoom-${type} ${type}: numeric, time and calendar-date fields support zoom on x and Reset restores all observations`, () => {
    const epoch = Date.UTC(2024, 1, 24);
    for (const [kind, values] of [
      ['number', [1, 2, 3]],
      ['time', [epoch, epoch + day, epoch + 2 * day]],
      ['date', ['2024-02-24', '2024-02-25', '2024-02-26']],
    ] as const) {
      const r = chart(type, xy.map((row, i) => ({ ...row, x: values[i]! })), { x: { field: 'x', type: kind }, y: { field: 'y', domain: [0, 10] } });
      const handle = r.controller.handle;
      r.frames();
      expect(committed(r).zoom).toBe(true);
      handle.zoom([values[1], values[2]]);
      r.frames();
      expect(committed(r).zoomed).toBe(true);
      expect(committed(r).lookup.count).toBe(2);
      expect(axes(r).y.domain).toEqual([0, 10]);
      expect(committed(r).reader.table?.rowCount).toBe(2);
      handle.zoom(null);
      r.frames();
      expect(committed(r).zoomed).toBe(false);
      expect(committed(r).reader.table?.rowCount).toBe(3);
    }
  });

  it(`T-limit-${type} ${type}: eight series are accepted without AX130; the ninth raises it with all nine still readable`, () => {
    const r = chart(type, seriesRows(8), { series: 's' });
    r.frames();
    expect(codes(r)).toEqual([]);
    r.controller.handle.update({ data: seriesRows(9) });
    r.frames();
    expect(codes(r)).toEqual(['AX130']);
    expect(lastModel(r).summary).toContain('9 series');
    const mark = type === 'bar' ? 'rects' : type === 'scatter' ? 'points' : 'path';
    expect(marks(r, mark)).toHaveLength(9);
    if (type === 'scatter') expect(committed(r).reader.table?.rowCount).toBe(18);
    else expect(at(r, 1)).toMatchObject({ count: 9, rows: expect.arrayContaining([expect.objectContaining({ seriesLabel: 'Series 0' })]) });
  });

  it(`T-reference-${type} ${type}: a line and band extend the appropriate domains, bind to reference paint and are listed in summary and caption`, () => {
    const r = chart(type, xy, { reference: [{ y: 20, label: 'Target' }, { x: [4, 6], label: 'Outage' }] });
    r.frames();
    const { x, y } = axes(r);
    if (x.type === 'band') throw new Error('Expected continuous axis');
    expect(x.domain[1]).toBeGreaterThanOrEqual(6);
    expect(y.domain[1]).toBeGreaterThanOrEqual(20);
    const rule = marks(r, 'rule').find(mark => mark.role === 'reference')!;
    expect(rule.stroke).toEqual({ kind: 'token', name: 'reference' });
    expectGeometry([rule.y1, rule.y2], [y.map(20), y.map(20)]);
    const band = marks(r, 'band')[0]!;
    expect(band.fill).toEqual({ kind: 'token', name: 'reference' });
    expectGeometry([band.box.x, band.box.width], [x.map(4), x.map(6) - x.map(4)]);
    expect(r.texts.at(-1)?.filter(text => text.role === 'reference').map(text => text.full)).toEqual(expect.arrayContaining(['Target', 'Outage']));
    for (const text of [lastModel(r).summary, committed(r).reader.table?.caption]) {
      expect(text).toMatch(/Target at 20/);
      expect(text).toMatch(/Outage from 4 to 6/);
    }
  });
}

it('T-zoom-bar bar: a category band axis ignores public zoom and retains all rows', () => {
  const r = chart('bar', [{ x: 'B', y: 6 }, { x: 'A', y: 8 }, { x: 'C', y: 2 }]);
  r.frames();
  r.controller.handle.zoom(['A', 'C']);
  r.frames();
  expect(committed(r)).toMatchObject({ zoom: false, zoomed: false });
  expect(rows(r).map(row => row[0])).toEqual(['B', 'A', 'C']);
});

it('T-zoom-donut donut: even an explicit zoom call leaves arc angles and table rows in slice order', () => {
  const r = chart('donut', donut);
  r.frames();
  r.controller.handle.zoom([0, 1]);
  r.frames();
  expect(committed(r)).toMatchObject({ zoom: false, zoomed: false });
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(4);
  expect(rows(r).map(row => row[0])).toEqual(['First', 'Zero', 'Missing', 'Last']);
});

it('T-limit-donut donut: eight positive values draw eight arcs; adding a ninth groups only the smallest two', () => {
  const data = Array.from({ length: 9 }, (_, i) => ({ x: 'Slice ' + i, y: i + 1 }));
  const r = chart('donut', data.slice(0, 8));
  r.frames();
  expect(codes(r)).toEqual([]);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(16);
  r.controller.handle.update({ data });
  r.frames();
  expect(codes(r)).toEqual(['AX121']);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(16);
  expect(lastModel(r).summary).toContain('Other (2): 3');
  expect(rows(r)).toHaveLength(9);
});

it('T-reference-donut donut: a Cartesian reference option is diagnosed and produces neither reference marks nor reader text', () => {
  const r = chart('donut', donut, { reference: [{ y: 20, label: 'Target' }] });
  r.frames();
  expect(codes(r)).toEqual(['AX150']);
  expect(marks(r, 'rule')).toEqual([]);
  expect(marks(r, 'band')).toEqual([]);
  expect(lastModel(r).summary).not.toContain('Target');
  expect(committed(r).reader.table?.caption).not.toContain('Target');
});
