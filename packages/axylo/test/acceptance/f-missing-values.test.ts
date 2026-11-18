import fc from 'fast-check';
import { expect, it } from 'vitest';
import { aligned, at, axes, chart, codes, committed, date, defaultMessages, message, expectCompact, expectGeometry, expectValues, lastModel, marks, pathRuns, pixel, points, reading, rows, walk } from './model';

const observations = [
  { x: '2024-02-24', y: 6 },
  { x: '2024-02-25', y: 8 },
  { x: '2024-02-26', y: null },
  { x: '2024-02-27', y: 5 },
  { x: '2024-02-28' },
  { x: '2024-03-01', y: 0 },
  { x: '2024-03-02', y: 7 },
];

for (const kind of aligned) {
  for (const compact of [false, true]) {
    const type = compact ? 'compact' : kind;
    it(`F2 ${type}: ${kind} distinguishes null, absent field, absent date and zero in geometry and reader text`, () => {
      const r = chart(type, observations, {}, undefined, kind);
      r.frames();
      expect(codes(r).sort()).toEqual(['AX102', 'AX105']);
      const { x, y } = axes(r);
      if (kind === 'bar') {
        const [filled, missing] = marks(r, 'rects');
        expect(filled?.variant).toBe('bar');
        expect(missing?.variant).toBe('missing');
        expect(filled?.xywh).toHaveLength(5 * 4);
        expect(missing?.xywh).toHaveLength(3 * 4);
        expectGeometry([filled!.xywh[13]!, filled!.xywh[15]!], [y.map(0), 0]);
        const missingCenters = [0, 4, 8].map(i => missing!.xywh[i]! + missing!.xywh[i + 2]! / 2);
        expectGeometry(missingCenters, [2, 4, 5].map(i => pixel(x, date(i))));
        expectGeometry([1, 5, 9].map(i => missing!.xywh[i]!), [y.map(0), y.map(0), y.map(0)]);
      } else {
        const expectedRuns = [[0, 1], [6, 7]];
        const stroke = marks(r, 'path')[0]!;
        expect(pathRuns(stroke.xy)).toHaveLength(expectedRuns.length);
        pathRuns(stroke.xy).forEach((run, i) => expectGeometry(run.map(p => p[0]), expectedRuns[i]!.map(j => pixel(x, date(j)))));
        expect(marks(r, 'points').flatMap(mark => points(mark.xy)).some(p => Math.abs(p[0] - pixel(x, date(3))) < 0.001)).toBe(true);
        if (kind === 'area') {
          const area = marks(r, 'area')[0]!;
          expect(Array.from(area.runs).filter((_, i) => i % 4 === 1)).toEqual([2, 2]);
        }
      }
      expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: '0', max: '8', last: '7' }));
      expect(lastModel(r).summary).toContain('Values not shown: 1.');
      if (compact) expectCompact(r);
      else {
        expect(lastModel(r).note).toBe('Values not shown: 1. See table.');
        const values = ['6', '8', 'No data', '5', 'No data', 'No data', '0', '7'];
        expect(rows(r).map(row => row[1])).toEqual(values);
        values.forEach((value, i) => expectValues(r, date(i), [value]));
      }
    });

    it(`F2 ${type}: ${kind} missing zero makes the requested count gaps ordinary zero values`, () => {
      const r = chart(type, observations, { y: { field: 'y', missing: 'zero' } }, undefined, kind);
      r.frames();
      expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: '0', max: '8', last: '7' }));
      const { y } = axes(r);
      if (kind === 'bar') {
        const bars = marks(r, 'rects');
        expect(bars).toHaveLength(1);
        expect(bars[0]?.xywh).toHaveLength(32);
        expectGeometry([2, 4, 5, 6].map(i => bars[0]!.xywh[4 * i + 3]!), [0, 0, 0, 0]);
      } else {
        const runs = pathRuns(marks(r, 'path')[0]!.xy);
        expect(runs.map(run => run.length)).toEqual([8]);
        expectGeometry([2, 4, 5, 6].map(i => runs[0]![i]![1]), [y.map(0), y.map(0), y.map(0), y.map(0)]);
      }
      expect(lastModel(r).summary).toContain(message('valuesChanged', { count: 1, seeTable: '' }));
      if (compact) expectCompact(r);
      else {
        expect(lastModel(r).note).toBe(message('valuesChanged', { count: 1, seeTable: defaultMessages.seeTable }));
        expect(rows(r).map(row => row[1])).toEqual(['6', '8', '0', '5', '0', '0', '0', '7']);
        for (const i of [2, 4, 5, 6]) expectValues(r, date(i), ['0']);
      }
    });
  }
}

for (const type of ['line', 'area', 'compact'] as const) {
  it(`F2 ${type}: for any generated missing index no stroke or fill run bridges it`, () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.integer({ min: -8, max: 8 }), fc.constantFrom(null, undefined, NaN, 'absent')), { maxLength: 14 }), values => {
      const r = chart(type, values.map((y, x) => y === 'absent' ? { x } : { x, y }), { x: { field: 'x', type: 'number' } }, undefined, type === 'compact' ? 'area' : 'line');
      r.frames();
      if (values.every(value => !Number.isFinite(value))) {
        expect(marks(r, 'path')).toEqual([]);
        return;
      }
      const { x } = axes(r);
      const indexes = (run: [number, number][]) => {
        if (x.type === 'band') throw new Error('Expected a numeric x axis');
        return run.map(([px]) => Math.round(x.invert(px)));
      };
      const strokes = marks(r, 'path').flatMap(mark => pathRuns(mark.xy));
      const fills = marks(r, 'area').flatMap(mark => {
        const vertices = points(mark.upper);
        return Array.from({ length: mark.runs.length / 4 }, (_, run) => {
          const start = mark.runs[run * 4]!;
          return vertices.slice(start, start + mark.runs[run * 4 + 1]!);
        });
      });
      for (const run of [...strokes, ...fills].map(indexes)) {
        expect(values.slice(run[0]!, run.at(-1)! + 1).every(Number.isFinite)).toBe(true);
      }
    }), { numRuns: 1_000 });
  });
}

it('F2 line: deleted daily rows and explicit nulls leave the same seven-day break', () => {
  const data = Array.from({ length: 12 }, (_, i) => ({ x: new Date(date(i)).toISOString().slice(0, 10), y: i >= 2 && i <= 8 ? null : i }));
  const explicit = chart('line', data);
  const deleted = chart('line', data.filter(row => row.y !== null));
  explicit.frames();
  deleted.frames();
  expect(codes(explicit)).toEqual([]);
  expect(codes(deleted)).toContain('AX105');
  expect(pathRuns(marks(deleted, 'path')[0]!.xy).map(run => run.length)).toEqual([2, 3]);
  expect(marks(deleted, 'path')[0]?.xy).toEqual(marks(explicit, 'path')[0]?.xy);
  expect(rows(deleted)).toEqual(rows(explicit));
  expect(at(deleted, date(5)).rows[0]?.value).toBe('No data');
});

const scatter = [{ x: 1, y: 4 }, { x: 2, y: null }, { x: 3 }, { x: 4, y: 0 }];

it('F2 scatter: gaps are unplotted, zero is readable and the table says No data (reading: the table keeps omitted observations)', () => {
  const r = chart('scatter', scatter);
  r.frames();
  expect(marks(r, 'points')[0]?.xy).toHaveLength(4);
  const refs = walk(r);
  const { lookup } = committed(r);
  expect(refs.map(ref => lookup.datum(ref)?.value)).toEqual(['4', '0']);
  expect(reading(r, refs[1]!)).toContain('0');
  expect(lastModel(r).summary).toContain(message('seriesSummary', { series: 'y', min: 0, max: 4, last: 0 }));
  expect(rows(r).map(row => row[2])).toEqual(['4', 'No data', 'No data', '0']);
});

it('F2 scatter: missing zero draws two imputed zero points and exposes all four observations', () => {
  const r = chart('scatter', scatter, { y: { field: 'y', missing: 'zero' } });
  r.frames();
  expect(marks(r, 'points')[0]?.xy).toHaveLength(8);
  const refs = walk(r);
  const { lookup } = committed(r);
  expect(refs.map(ref => lookup.datum(ref)?.value)).toEqual(['4', '0', '0', '0']);
  expect(rows(r).map(row => row[2])).toEqual(['4', '0', '0', '0']);
  refs.slice(1).forEach(ref => expect(reading(r, ref)).toContain('0'));
});

it('F2 donut: null and absent slices have no arc and read No data; a real zero reads 0', () => {
  const r = chart('donut', [{ x: 'A', y: 5 }, { x: 'B', y: null }, { x: 'C' }, { x: 'D', y: 0 }]);
  r.frames();
  expect(codes(r)).toEqual(['AX102']);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(2);
  const refs = walk(r);
  expect(refs).toHaveLength(4);
  expect(rows(r).map(row => row[1])).toEqual(['5', 'No data', 'No data', '0']);
  refs.forEach((ref, i) => expect(reading(r, ref)).toContain(['5', 'No data', 'No data', '0'][i]!));
  expect(lastModel(r).summary).toContain(`${defaultMessages.total} 5`);
  expect(lastModel(r).note).toBe('Values not shown: 1. See table.');
});

it('F2 bar: horizontal missing marks sit at zero and real zero is a zero-width bar', () => {
  const r = chart('bar', [{ x: 'Valid', y: 8 }, { x: 'None', y: null }, { x: 'Zero', y: 0 }], { horizontal: true });
  r.frames();
  const { y } = axes(r);
  const filled = marks(r, 'rects').find(mark => mark.variant === 'bar')!;
  const missing = marks(r, 'rects').find(mark => mark.variant === 'missing')!;
  expect(filled.xywh).toHaveLength(8);
  expect(missing.xywh).toHaveLength(4);
  expectGeometry([filled.xywh[4]!, filled.xywh[6]!, missing.xywh[0]!, missing.xywh[2]!], [y.map(0), 0, y.map(0), 0]);
  expectValues(r, 1, ['No data']);
  expectValues(r, 2, ['0']);
  expect(rows(r)).toEqual([['Valid', '8'], ['None', 'No data'], ['Zero', '0']]);
});

it('F2 donut: missing zero makes null and absent counts readable as zero without drawing their arcs', () => {
  const r = chart('donut', [{ x: 'A', y: 6 }, { x: 'B', y: null }, { x: 'C' }, { x: 'D', y: 0 }], {
    value: { field: 'y', missing: 'zero' },
  });
  r.frames();
  expect(codes(r)).toEqual(['AX102']);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(2);
  const { lookup } = committed(r);
  const zeros = walk(r).slice(1);
  expect(zeros).toHaveLength(3);
  for (const ref of zeros) {
    if (ref.kind !== 'slice') throw new Error('Expected a slice');
    expect(lookup.tooltip(ref).rows[0]).toMatchObject({ value: '0', percent: '0%' });
    expect(reading(r, ref)).toContain('0 (0%)');
  }
  expect(rows(r).map(row => row[1])).toEqual(['6', '0', '0', '0']);
  expect(lastModel(r).summary).toContain(`${defaultMessages.total} 6`);
});

for (const type of ['line', 'area'] as const) {
  it(`F2 ${type}: an isolated value between two gaps is drawn at its coordinates below 12 px spacing`, () => {
    const isolated = 72;
    const r = chart(type, Array.from({ length: 150 }, (_, x) => ({
      x, y: x === isolated ? 19 : Math.abs(x - isolated) === 1 ? null : 2,
    })));
    r.frames();
    const { x, y } = axes(r);
    expect(pixel(x, isolated + 2) - pixel(x, isolated)).toBeLessThan(12);
    const expected = [pixel(x, isolated), y.map(19)];
    const marker = marks(r, 'points').flatMap(mark => points(mark.xy)).find(([px]) => Math.abs(px - expected[0]!) < 0.001);
    expectGeometry(marker ?? [], expected);
    expect(pathRuns(marks(r, 'path')[0]!.xy).map(run => run.length)).toEqual([71, 76]);
  });
}

it("F2 scatter: appending unplottable values retains their table rows and missing zero only imputes missing values", () => {
  const r = chart('scatter', [{ x: 1, y: 2 }, { x: 2, y: null }], { y: { field: 'y', missing: 'zero' } });
  r.frames();
  r.controller.handle.append([{ x: 3, y: Infinity }, { x: 4, y: '40' }, { x: 4 }, { x: 5, y: NaN }]);
  r.frames();
  const { noData } = defaultMessages;
  expect(rows(r).map(row => [row[0], row[2]])).toEqual([
    ['1', '2'], ['2', '0'], ['3', noData], ['4', '0'], ['4', noData], ['5', noData],
  ]);
  expect(walk(r).map(ref => committed(r).lookup.datum(ref)?.value)).toEqual(['2', '0', '0']);
  expect(r.controller.handle.diagnostics.map(({ code, count }) => [code, count]).sort()).toEqual([
    ['AX102', 1], ['AX103', 2], ['AX106', 1],
  ]);
});

it('F2 line: a generated absent daily step and the same explicit null produce the same gap', () => {
  const offset = fc.integer({ min: 2, max: 19 });
  fc.assert(fc.property(offset, fc.integer({ min: 2020, max: 2030 }), (missing, year) => {
    const data = Array.from({ length: 24 }, (_, i) => ({
      x: new Date(Date.UTC(year, 11, 20 + i)).toISOString().slice(0, 10), y: i === missing ? null : i,
    }));
    const explicit = chart('line', data);
    const absent = chart('line', data.filter((_, i) => i !== missing));
    explicit.frames();
    absent.frames();
    expect(codes(explicit)).toEqual([]);
    expect(codes(absent)).toEqual(['AX105']);
    expect(marks(absent, 'path')[0]?.xy).toEqual(marks(explicit, 'path')[0]?.xy);
    expect(rows(absent)).toEqual(rows(explicit));
  }), { numRuns: 1_000 });
});

// Matrix gap 12.
const hours = [0, 1, 2, 4, 5, 6].map(h => Date.UTC(2026, 0, 1, h));
for (const kind of aligned) {
  for (const compact of [false, true]) {
    const type = compact ? 'compact' : kind;
    it(`F2 ${type}: ${kind} draws an absent step on a regular instant axis as a gap, through the controller`, () => {
      // Hourly instants with 03:00 absent: a regular step, so the absent step is a gap and AX105 is raised.
      const r = chart(type, hours.map((x, i) => ({ x, y: 10 + i })), { x: { field: 'x', type: 'time', timeZone: 'UTC' } }, { console: false }, kind);
      r.frames();
      expect(codes(r)).toEqual(['AX105']);
      if (kind === 'bar') {
        // Seven bands: six bars and, at 03:00, the "no data" mark of a missing bar.
        expect(marks(r, 'rects').filter(m => m.variant === 'bar').reduce((n, m) => n + m.xywh.length / 4, 0)).toBe(6);
        expect(marks(r, 'rects').filter(m => m.variant === 'missing').reduce((n, m) => n + m.xywh.length / 4, 0)).toBe(1);
      } else {
        const line = marks(r, 'path').find(path => path.series === 0)!;
        expect(pathRuns(line.xy).map(run => run.length)).toEqual([3, 3]);
      }
      if (!compact) {
        expect(rows(r)).toHaveLength(7);
        expect(rows(r)[3]![1]).toBe(defaultMessages.noData);
        expect(at(r, Date.UTC(2026, 0, 1, 3)).rows[0]?.value).toBe(defaultMessages.noData);
      }
    });
  }
}

it('F2 scatter: an explicit null is a silent gap: no diagnostic, no note, and the table says No data', () => {
  const r = chart('scatter', [{ x: 1, y: 2 }, { x: 2, y: null }, { x: 3, y: 4 }], { onDiagnostic: () => { throw new Error('no diagnostic expected'); } });
  r.frames();
  expect(r.controller.handle.diagnostics).toEqual([]);
  expect(lastModel(r).note).toBeNull();
  expect(marks(r, 'points').reduce((n, m) => n + m.xy.length / 2, 0)).toBe(2);
  expect(rows(r).map(row => [row[0], row[2]])).toEqual([['1', '2'], ['2', defaultMessages.noData], ['3', '4']]);
});

it('F2 donut: a null slice reads No data in the tooltip and to the keyboard', () => {
  const r = chart('donut', [{ x: 'A', y: 3 }, { x: 'B', y: null }, { x: 'C', y: 5 }]);
  r.frames();
  const { lookup } = committed(r);
  const slice = { kind: 'slice', sliceKey: 'B' } as const;
  const tooltip = lookup.tooltip(slice);
  expect(tooltip.title).toBe('B');
  expect(tooltip.rows.map(row => row.value)).toEqual([defaultMessages.noData]);
  expect(reading(r, slice)).toBe(message('pointAll', { x: 'B', values: defaultMessages.noData, position: message('position', { index: 2, count: 3 }) }));
});
