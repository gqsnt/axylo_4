import { afterEach, expect, it, vi } from 'vitest';
import { createController } from '../../src/core/controller';
import type { DiagnosticEffect } from '../../src/core/contracts';
import * as stages from '../../src/core/stages';
import type { Diagnostic } from '../../src/public';
import { aligned, at, axes, chart, codes, committed, date, day, lastModel, marks, pathRuns, rows, scene, seriesRows, types, type Recording, type Type } from './model';

const end = [{ x: 1, y: 10 }, { x: 2, y: 20 }];
const dataFor = (type: Type) => type === 'donut' ? [{ x: 'A', y: 10 }, { x: 'B', y: 20 }] : end;
type Listener = (d: Diagnostic) => void;
type Case = { code: Diagnostic['code']; level: Diagnostic['level']; effect: DiagnosticEffect; name: string; fix: RegExp };
const errorState = (r: Recording) => {
  expect(scene(r).marks).toEqual([]);
  expect(lastModel(r).message).toBe('The chart could not be drawn.');
};

afterEach(() => vi.restoreAllMocks());

function diagnostic(type: Type, test: Case, receive: (onDiagnostic: Listener) => Recording, outcome: (r: Recording) => void) {
  it(`F3 ${type}: ${test.code} ${test.name}`, () => {
    // The public conversion discards the effect. Observe its input while keeping the real delivery path.
    const converted = vi.spyOn(stages, 'toPublic');
    const delivered: Diagnostic[] = [];
    const r = receive(d => delivered.push(d));
    r.frames();
    outcome(r);
    if (test.code !== 'AX199') r.controller.invalidate.resize();
    r.frames();
    const matches = delivered.filter(d => d.code === test.code);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ code: test.code, level: test.level, chart: expect.any(String) });
    expect(matches[0]?.chart).toBeTruthy();
    expect(matches[0]?.message).toMatch(test.fix);
    expect(r.printed.filter(message => message.includes('[' + 'axylo ' + test.code + ']'))).toHaveLength(1);
    const effects = converted.mock.calls.flatMap(([inputs]) => inputs.filter(d => d.code === test.code).map(d => d.effect));
    expect([...new Set(effects)]).toEqual([test.effect]);
    r.controller.handle.destroy();
  });
}

for (const type of types) {
  const encoding = type === 'donut' ? 'value' : 'y';
  diagnostic(type, { code: 'AX100', level: 'error', effect: 'chart-error', name: 'reports unequal typed columns and draws the error state once', fix: /x.*2.*y.*1|y.*1.*x.*2/i },
    onDiagnostic => chart(type, { columns: { x: new Float64Array(2), y: new Float64Array(1) } }, { onDiagnostic }), errorState);
  diagnostic(type, { code: 'AX101', level: 'error', effect: 'chart-error', name: 'names the missing field, suggests the available field and draws the error state', fix: /Available fields.*Did you mean "amount"/i },
    onDiagnostic => chart(type, dataFor(type).map(({ x, y }) => ({ x, amount: y })), { [encoding]: 'amunt', onDiagnostic }), errorState);

  for (const [code, value, fix] of [['AX102', undefined, /supply the field/i], ['AX103', Infinity, /check the calculation/i], ['AX106', '40', /convert values to numbers/i]] as const) {
    diagnostic(type, { code, level: 'warning', effect: 'omitted', name: 'omits the bad value, preserves its neighbours and discloses one omission', fix }, onDiagnostic => {
      const xs = type === 'donut' ? ['A', 'B', 'C', 'D'] : [1, 2, 3, 4];
      return chart(type, [{ x: xs[0], y: 10 }, { x: xs[1], ...(value === undefined ? {} : { y: value }) }, { x: xs[2], y: 30 }, { x: xs[3], y: 40 }], { onDiagnostic });
    }, r => {
      const finding = r.controller.handle.diagnostics.find(d => d.code === code);
      expect(finding).toMatchObject({ field: 'y', rows: [1], count: 1 });
      expect(lastModel(r).summary).toContain('Values not shown: 1.');
      if (type === 'donut') expect(marks(r, 'arcs')[0]?.angles).toHaveLength(6);
      else if (type === 'scatter') expect(marks(r, 'points')[0]?.xy).toHaveLength(6);
      else if (type === 'bar') {
        expect(marks(r, 'rects').find(mark => mark.variant === 'bar')?.xywh).toHaveLength(12);
        expect(marks(r, 'rects').find(mark => mark.variant === 'missing')?.xywh).toHaveLength(4);
      } else {
        expect(pathRuns(marks(r, 'path')[0]!.xy).map(run => run.length)).toEqual([2]);
        expect(marks(r, 'points')[0]?.xy.length).toBeGreaterThanOrEqual(2);
      }
      if (type !== 'compact') expect(lastModel(r).note).toBe('Values not shown: 1. See table.');
    });
  }

  diagnostic(type, { code: 'AX104', level: 'hint', effect: 'none', name: 'draws an entirely decimal-string column in full', fix: /parse: 'number'/ },
    onDiagnostic => chart(type, dataFor(type).map(({ x, y }) => ({ x, y: String(y) })), { onDiagnostic }), r => {
      expect(scene(r).marks.some(mark => ['path', 'rects', 'points', 'arcs'].includes(mark.type))).toBe(true);
      expect(lastModel(r).summary).toContain('20');
      expect(lastModel(r).note).toBeNull();
      if (type !== 'compact') expect(rows(r).map(row => row[type === 'scatter' ? 2 : 1])).toEqual(['10', '20']);
    });

  diagnostic(type, { code: 'AX140', level: 'warning', effect: 'none', name: 'generates a name and keeps the marks when no title is supplied', fix: /set one.*descriptive name/i },
    onDiagnostic => chart(type, dataFor(type), { title: undefined, onDiagnostic }), r => {
      expect(lastModel(r).name).toMatch(/chart of y by (x|Category)$/);
      expect(lastModel(r).message).toBeNull();
      expect(lastModel(r).note).toBeNull();
      expect(scene(r).marks.length).toBeGreaterThan(0);
    });

  diagnostic(type, { code: 'AX150', level: 'warning', effect: 'none', name: 'suggests tooltip for a misspelled key and leaves the chart drawable', fix: /Did you mean "tooltip"/i },
    onDiagnostic => chart(type, dataFor(type), { tooltp: false, onDiagnostic }), r => {
      expect(committed(r).tooltip).toBe(true);
      expect(lastModel(r).message).toBeNull();
      expect(scene(r).marks.length).toBeGreaterThan(0);
    });

  diagnostic(type, { code: 'AX160', level: 'warning', effect: 'changed', name: 'reports a late formatter exception once even under strict mode and keeps the marks', fix: /make the formatter handle every value/i },
    onDiagnostic => chart(type, dataFor(type), { [encoding]: { field: 'y', format: () => { throw new Error('fixture'); } }, strict: true, onDiagnostic }), r => {
      expect(lastModel(r).summary).toContain('20');
      expect(lastModel(r).message).toBeNull();
      expect(scene(r).marks.length).toBeGreaterThan(0);
    });
}

for (const type of ['line', 'area', 'bar', 'compact'] as const) {
  diagnostic(type, { code: 'AX105', level: 'hint', effect: 'none', name: 'inserts an expected daily gap and draws it as missing', fix: /explicit nulls.*gaps/i },
    onDiagnostic => chart(type, [0, 1, 3, 4].map(i => ({ x: new Date(date(i)).toISOString().slice(0, 10), y: i + 1 })), { onDiagnostic }), r => {
      if (type === 'bar') expect(marks(r, 'rects').find(mark => mark.variant === 'missing')?.xywh).toHaveLength(4);
      else expect(pathRuns(marks(r, 'path')[0]!.xy).map(run => run.length)).toEqual([2, 2]);
      if (type !== 'compact') expect(at(r, date(2)).rows[0]?.value).toBe('No data');
      expect(lastModel(r).note).toBeNull();
    });

  diagnostic(type, { code: 'AX108', level: 'error', effect: 'series-disabled', name: 'omits the duplicate series and keeps the unaffected one', fix: /one row per x and series/i },
    onDiagnostic => chart(type, [...end.map(row => ({ ...row, s: 'Keep' })), { x: 1, y: 15, s: 'Bad' }, { x: 1, y: 40, s: 'Bad' }], { series: 's', onDiagnostic }), r => {
      expect([...marks(r, 'path'), ...marks(r, 'rects'), ...marks(r, 'points')].map(mark => mark.series)).not.toContain(1);
      expect(lastModel(r).summary).toContain('Bad could not be drawn');
    });
}

for (const type of ['line', 'area', 'bar', 'scatter', 'compact'] as const) {
  diagnostic(type, { code: 'AX107', level: 'warning', effect: 'omitted', name: 'omits an impossible date and discloses the lost observation', fix: /supply.*date|supply an x value/i },
    onDiagnostic => chart(type, [{ x: '2024-02-28', y: 10 }, { x: '2024-02-30', y: 999 }, { x: '2024-02-29', y: 20 }], { x: { field: 'x', type: 'date' }, onDiagnostic }), r => {
      expect(lastModel(r).summary).toContain('maximum 20');
      expect(lastModel(r).summary).toContain('Values not shown: 1.');
      expect(axes(r).x.type).toBe('time');
      if (type !== 'compact') expect(rows(r)).toHaveLength(2);
    });

  for (const [code, data, x, text, fix] of [
    ['AX109', [{ x: date(0), y: 10 }, { x: date(1), y: 20 }], { field: 'x' }, '1,708,732,800,000', /type: 'time'/],
    ['AX111', [{ x: date(0), y: 10 }, { x: date(1), y: 20 }], { field: 'x', type: 'time' }, 'UTC', /use date strings/i],
    ['AX112', [{ x: '2024-03-10T02:30', y: 10 }, { x: '2024-03-10T03:30', y: 20 }], { field: 'x' }, '2:30 AM', /include a UTC offset or Z/i],
    ['AX152', [{ x: date(0), y: 10 }, { x: date(1) - day / 2, y: 20 }], { field: 'x', type: 'time', timeZone: 'Invalid/Zone' }, 'UTC', /zone recognized by Intl/i],
  ] as const) {
    diagnostic(type, { code, level: code === 'AX152' ? 'warning' : 'hint', effect: 'none', name: 'keeps both observations and reads the axis as specified', fix },
      onDiagnostic => chart(type, data, { x, onDiagnostic }), r => {
        expect(lastModel(r).summary).toContain(text);
        expect(lastModel(r).message).toBeNull();
        expect(axes(r).x.type).toBe(code === 'AX109' ? 'linear' : 'time');
        if (type !== 'compact') expect(rows(r)).toHaveLength(2);
      });
  }

  diagnostic(type, { code: 'AX130', level: 'warning', effect: 'none', name: 'keeps all nine series and assigns a secondary cue', fix: /filter or group series/i },
    onDiagnostic => chart(type, seriesRows(9), { series: 's', onDiagnostic }), r => {
      expect(lastModel(r).summary).toContain('9 series');
      const mark = type === 'bar' ? 'rects' : type === 'scatter' ? 'points' : 'path';
      expect(marks(r, mark)).toHaveLength(9);
    });

  diagnostic(type, { code: 'AX151', level: 'warning', effect: 'none', name: 'accepts the out-of-order append through a full update', fix: /append rows in x order/i },
    onDiagnostic => {
      const r = chart(type, [{ x: 2, y: 10 }, { x: 3, y: 20 }], { onDiagnostic });
      r.frames();
      r.controller.handle.append([{ x: 1, y: 7 }]);
      return r;
    }, r => {
      expect(lastModel(r).summary).toContain('minimum 7, maximum 20, last 20');
      if (type !== 'compact') expect(rows(r).map(row => row[0])).toEqual(['1', '2', '3']);
      expect(lastModel(r).message).toBeNull();
    });
}

for (const [type, kind] of [['area', 'area'], ['bar', 'bar'], ['compact', 'area'], ['compact', 'bar']] as const) {
  diagnostic(type, { code: 'AX110', level: 'warning', effect: 'none', name: `widens the ${kind} domain to include zero`, fix: /include zero in the domain/i },
    onDiagnostic => chart(type, end, { y: { field: 'y', domain: [8, 25] }, onDiagnostic }, undefined, kind), r => {
      expect(axes(r).y.domain).toEqual([0, 25]);
      expect(lastModel(r).summary).toContain('minimum 10, maximum 20');
    });
}

for (const type of [...aligned, 'compact'] as const) {
  diagnostic(type, { code: 'AX134', level: 'error', effect: 'chart-error', name: 'reports both counts above the aligned 20,000,000-slot limit and draws the error state', fix: /4473 series.*4473 x positions.*fewer series.*scatter/i },
    onDiagnostic => chart(type, Array.from({ length: 4473 }, (_, x) => ({ x, y: 1, s: 'S' + x })), { series: 's', onDiagnostic }), errorState);
}

diagnostic('donut', { code: 'AX108', level: 'error', effect: 'chart-error', name: 'disables the donut when two labels are equal', fix: /one row per donut label/i },
  onDiagnostic => chart('donut', [{ x: 'A', y: 10 }, { x: 'A', y: 20 }], { onDiagnostic }), errorState);
diagnostic('donut', { code: 'AX120', level: 'error', effect: 'chart-error', name: 'shows the error state for a negative slice', fix: /supply non-negative values/i },
  onDiagnostic => chart('donut', [{ x: 'A', y: 10 }, { x: 'B', y: -1 }], { onDiagnostic }), errorState);
diagnostic('donut', { code: 'AX121', level: 'warning', effect: 'changed', name: 'draws seven largest slices and one Other (2) slice while keeping every table row', fix: /aggregate.*bar chart/i },
  onDiagnostic => chart('donut', Array.from({ length: 9 }, (_, i) => ({ x: 'Slice ' + i, y: i + 1 })), { onDiagnostic }), r => {
    expect(marks(r, 'arcs')[0]?.angles).toHaveLength(16);
    expect(rows(r)).toHaveLength(9);
    expect(lastModel(r).summary).toContain('Other (2): 3');
  });
diagnostic('compact', { code: 'AX131', level: 'hint', effect: 'none', name: 'keeps both series and gives them different dashes', fix: /one series or turn off compact mode/i },
  onDiagnostic => chart('compact', seriesRows(2), { series: 's', onDiagnostic }), r => {
    expect(new Set(marks(r, 'path').map(mark => JSON.stringify(mark.dash.normal))).size).toBe(2);
  });
diagnostic('bar', { code: 'AX132', level: 'hint', effect: 'none', name: 'keeps all bars when categories outnumber pixels', fix: /aggregate categories/i },
  onDiagnostic => chart('bar', Array.from({ length: 350 }, (_, i) => ({ x: 'Band ' + i, y: 1 })), { onDiagnostic }, { container: { width: 230, height: 250 } }), r => {
    expect(marks(r, 'rects')[0]?.xywh).toHaveLength(350 * 4);
  });
diagnostic('scatter', { code: 'AX133', level: 'hint', effect: 'none', name: 'keeps all 50,001 points and warns that drawing may be slow', fix: /drawing.*may be slow/i },
  onDiagnostic => chart('scatter', { columns: { x: Float64Array.from({ length: 50_001 }, (_, i) => i), y: new Float32Array(50_001).fill(2) } }, { onDiagnostic }), r => {
    expect(marks(r, 'points')[0]?.xy).toHaveLength(50_001 * 2);
  });
diagnostic('line', { code: 'AX141', level: 'warning', effect: 'none', name: 'reports a low-contrast resolved theme and draws with the same paint binding', fix: /adjust.*contrast|adjust.*3:1/i },
  onDiagnostic => {
    const r = chart('line', end, { strict: true, colors: { y: '#ddd' }, onDiagnostic });
    const resolve = r.host.theme;
    r.host.theme = (keys, colors) => {
      const result = resolve(keys, colors);
      const background = colors.y!;
      return { ...result, backdropKnown: true, theme: { ...result.theme, paints: {
        series: [background], tokens: { ...result.theme.paints.tokens, background },
      } } };
    };
    return r;
  }, r => {
    expect(marks(r, 'path')[0]?.stroke).toEqual({ kind: 'series', index: 0 });
    expect(lastModel(r).message).toBeNull();
  });
diagnostic('line', { code: 'AX142', level: 'hint', effect: 'none', name: 'replaces a too-small plot with its title, summary and table', fix: /give the plot more room/i },
  onDiagnostic => chart('line', end, { onDiagnostic }, { container: { width: 100, height: 200 } }), r => {
    expect(scene(r).marks).toEqual([]);
    expect(lastModel(r)).toMatchObject({ summaryVisible: true, title: { text: 'Measurements' } });
    expect(committed(r).reader.table?.rowCount).toBe(2);
  });
diagnostic('bar', { code: 'AX143', level: 'hint', effect: 'none', name: 'discloses hidden labels after fitting unordered categories', fix: /horizontal bars/i },
  onDiagnostic => chart('bar', Array.from({ length: 90 }, (_, i) => ({ x: 'Long category number ' + i + ' requiring substantial space', y: 1 })), { onDiagnostic }, { container: { width: 250, height: 250 } }), r => {
    expect(marks(r, 'rects')[0]?.xywh).toHaveLength(90 * 4);
    expect(lastModel(r).note).toBe('Some labels hidden. See table.');
  });
diagnostic('line', { code: 'AX199', level: 'error', effect: 'chart-error', name: 'reports a forced internal failure, draws a generic error, and clears old interaction', fix: /please report it/i },
  onDiagnostic => {
    const r = chart('line', end, { onDiagnostic });
    r.frames();
    r.controller.handle.__dev!.fail('scene');
    r.controller.handle.update({ data: [{ x: 1, y: 8 }, { x: 2, y: 9 }] });
    return r;
  }, r => {
    expect(scene(r).marks).toEqual([]);
    expect(lastModel(r).message).toBe('Something went wrong while drawing the chart.');
    expect(r.committed).toBeNull();
    expect(r.announcements).toEqual(['Something went wrong while drawing the chart.']);
  });

it('F3 line: AX105 reports a too-sparse regular candidate without inventing thousands of gap positions', () => {
  const r = chart('line', [0, 1, 2, 3000, 3001, 3002].map(i => ({ x: date(i), y: 8 })), { x: { field: 'x', type: 'time' } });
  r.frames();
  expect(codes(r)).toContain('AX105');
  expect(r.controller.handle.diagnostics.find(d => d.code === 'AX105')?.message).toMatch(/too sparse/i);
  expect(rows(r)).toHaveLength(6);
  expect(pathRuns(marks(r, 'path')[0]!.xy).map(run => run.length)).toEqual([6]);
});

it('DX4 line: two charts on one page each receive AX103 but that page prints it once', () => {
  const first: Diagnostic[] = [];
  const second: Diagnostic[] = [];
  const data = [{ x: 1, y: 5 }, { x: 2, y: NaN }];
  const a = chart('line', data, { title: 'First', onDiagnostic: (d: Diagnostic) => first.push(d) });
  // Both controllers must see the shared document identity at construction.
  const b = chart('line', end);
  b.controller.handle.destroy();
  const other = createController('line', {
    title: 'Second', data, x: 'x', y: 'y', onDiagnostic: (d: Diagnostic) => second.push(d),
  }, { ...b.host, page: a.host.page });
  a.frames();
  b.frames();
  expect(first).toMatchObject([{ code: 'AX103', chart: 'First', field: 'y', rows: [1] }]);
  expect(second).toMatchObject([{ code: 'AX103', chart: 'Second', field: 'y', rows: [1] }]);
  expect([...a.printed, ...b.printed].filter(line => line.includes('AX103'))).toHaveLength(1);
  other.handle.destroy();
});

it('F3 line: AX109 warns about seconds supplied as time and maps the values as milliseconds', () => {
  const r = chart('line', [{ x: 1_700_000_000, y: 6 }, { x: 1_700_060_000, y: 8 }], {
    x: { field: 'x', type: 'time', timeZone: 'UTC' },
  });
  r.frames();
  expect(codes(r)).toEqual(['AX109']);
  expect(r.controller.handle.diagnostics[0]?.message).toMatch(/multiply them by 1,000/i);
  expect(rows(r).map(row => row[0])).toEqual(['Jan 20, 1970, 4:13:20 PM UTC', 'Jan 20, 1970, 4:14:20 PM UTC']);
  expect(pathRuns(marks(r, 'path')[0]!.xy)[0]).toHaveLength(2);
});

it('F3 line: AX104 parses signed decimal strings, while an empty string is a silent No data gap', () => {
  const r = chart('line', [{ x: 1, y: '-1.5' }, { x: 2, y: '' }, { x: 3, y: '3.25' }, { x: 4, y: '4' }]);
  r.frames();
  expect(codes(r)).toEqual(['AX104']);
  expect(r.controller.handle.diagnostics[0]).toMatchObject({ field: 'y', count: 3, rows: [0, 2, 3] });
  expect(pathRuns(marks(r, 'path')[0]!.xy).map(run => run.length)).toEqual([2]);
  expect(at(r, 2).rows[0]?.value).toBe('No data');
  expect(rows(r).map(row => row[1])).toEqual(['-1.5', 'No data', '3.25', '4']);
  expect(lastModel(r).note).toBeNull();
});
