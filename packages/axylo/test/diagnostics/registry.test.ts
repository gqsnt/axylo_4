import { describe, expect, it } from 'vitest';
import type { DiagnosticInput } from '../../src/core/contracts';
import { AlignedStore, resolveOptions, validateOptions } from '../../src/data';
import { createDiagnostic, DiagnosticCollector, diagnosticRegistry, readerDisclosure, type DiagnosticCode } from '../../src/diagnostics';
import { aligned, check, utc, version } from '../data/helpers';
import { record } from '../core/host';

function expectDiagnostic(
  diagnostic: DiagnosticInput | undefined,
  code: DiagnosticCode, level: DiagnosticInput['level'], effect: DiagnosticInput['effect'],
  field: string, count: number, rows: readonly number[] | undefined, fix: string,
) {
  expect(diagnostic).toEqual({
    code, level, effect, origin: 'call', field, count, ...(rows === undefined ? {} : { rows }),
    message: expect.stringContaining(fix),
  });
  expect(diagnostic?.message).toContain('"' + field + '"');
  if (rows?.length) expect(diagnostic?.message).toContain((rows.length === 1 ? 'row ' : 'rows ') + rows.join(', '));
}

const line = (data: readonly unknown[], options: object = {}) => aligned({ data, x: 'day', y: 'value', ...options }).diagnostics.inputs();

describe('diagnostic registry', () => {
  it('has every code and level in section 3.5', () => {
    expect(Object.fromEntries(Object.entries(diagnosticRegistry).map(([code, entry]) => [code, entry.level]))).toEqual({
      AX100: 'error', AX101: 'error', AX102: 'warning', AX103: 'warning', AX104: 'hint', AX105: 'hint',
      AX106: 'warning', AX107: 'warning', AX108: 'error', AX109: 'hint', AX110: 'warning',
      AX111: 'hint', AX112: 'hint', AX120: 'error', AX121: 'warning', AX130: 'warning', AX131: 'hint',
      AX132: 'hint', AX133: 'hint', AX134: 'error', AX140: 'warning', AX141: 'warning', AX142: 'hint', AX143: 'hint',
      AX150: 'warning', AX151: 'warning', AX152: 'warning', AX160: 'warning', AX199: 'error',
    });
  });

  it('AX100 identifies differently sized columns', () => {
    const { diagnostics, frame } = aligned({ data: { columns: { day: [1, 2], value: new Float32Array(1) } }, x: 'day', y: 'value' });
    const diagnostic = diagnostics.inputs()[0];
    expectDiagnostic(diagnostic, 'AX100', 'error', 'chart-error', 'value', 1, undefined, 'Supply equally long columns');
    expect(diagnostic?.message).toContain('"day": 2, "value": 1');
    expect(frame.length).toBe(0);
  });

  it('AX101 shows the available fields and suggests the closest key', () => {
    const [diagnostic] = line([{ day: 1, value: 2, category: 'a' }], { y: 'vlaue' });
    expectDiagnostic(diagnostic, 'AX101', 'error', 'chart-error', 'vlaue', 1, undefined, 'Did you mean "value"?');
    expect(diagnostic?.message).toContain('"day", "value", "category"');
    expect(validateOptions('line', { data: [{ day: 1, value: 2 }], x: 'day', y: 'vlaue', title: { text: 'Sessions' } })[0])
      .toEqual({ code: 'AX101', level: 'error', field: 'vlaue', chart: 'Sessions', count: 1, message: expect.any(String) });
  });

  it('AX102 distinguishes absent values and marks zero imputation as changed', () => {
    const data = [{ day: 0, value: 3 }, { day: 1 }, { day: 2, value: undefined }];
    expectDiagnostic(line(data)[0], 'AX102', 'warning', 'omitted', 'value', 2, [1, 2], 'send null');
    expectDiagnostic(line(data, { y: { field: 'value', missing: 'zero' } })[0],
      'AX102', 'warning', 'changed', 'value', 2, [1, 2], 'send null');
  });

  it('AX103 identifies non-finite row numbers', () => {
    expectDiagnostic(line([{ day: 0, value: NaN }, { day: 1, value: Infinity }])[0],
      'AX103', 'warning', 'omitted', 'value', 2, [0, 1], 'Check the calculation');
  });

  it('AX104 suggests explicit conversion for a column of decimal strings', () => {
    expectDiagnostic(line([{ day: 0, value: '40' }, { day: 1, value: '-1.5' }])[0],
      'AX104', 'hint', 'none', 'value', 2, [0, 1], "Set parse: 'number'");
  });

  it('AX105 gives positions for steps that have no source row', () => {
    const data = [1, 2, 4, 5].map(day => ({ day, value: 10 }));
    const [diagnostic] = line(data);
    expectDiagnostic(diagnostic, 'AX105', 'hint', 'none', 'day', 1, undefined, 'explicit nulls');
    expect(diagnostic?.message).toContain('(3)');
    expectDiagnostic(line(data, { y: { field: 'value', missing: 'zero' } })[0],
      'AX105', 'hint', 'none', 'day', 1, undefined, 'explicit nulls');
  });

  it('AX106 identifies unplottable strings', () => {
    expectDiagnostic(line([{ day: 0, value: 1 }, { day: 1, value: '40' }, { day: 2, value: '1,234' }])[0],
      'AX106', 'warning', 'omitted', 'value', 2, [1, 2], 'Convert values to numbers');
  });

  it('AX107 identifies dates that cannot be parsed', () => {
    expectDiagnostic(line([{ day: '2026-02-28', value: 1 }, { day: '2026-02-29', value: 2 }])[0],
      'AX107', 'warning', 'omitted', 'day', 1, [1], 'Supply an x value');
  });

  it('AX108 disables a series or donut with duplicates', () => {
    const data = [{ day: 'Mon', value: 1 }, { day: 'Mon', value: 2 }];
    expectDiagnostic(line(data)[0], 'AX108', 'error', 'series-disabled', 'day', 1, [1], 'Provide one row per x');
    expectDiagnostic(check('donut', { data, label: 'day', value: 'value' }).diagnostics.inputs()[0],
      'AX108', 'error', 'chart-error', 'day', 1, [1], 'one row per donut label');
  });

  it('AX109 explains both timestamp conventions', () => {
    expectDiagnostic(line([{ day: 1_772_064_000, value: 1 }], { x: { field: 'day', type: 'time' } })[0],
      'AX109', 'hint', 'none', 'day', 1, [0], 'Multiply them by 1,000');
    expectDiagnostic(line([{ day: 1_772_064_000_000, value: 1 }])[0],
      'AX109', 'hint', 'none', 'day', 1, [0], "Set type: 'time'");
  });

  it('AX111 suggests date strings for whole-day instants', () => {
    const data = ['2026-02-24T00:00:00Z', '2026-02-25T00:00:00Z'].map(day => ({ day, value: 3 }));
    expectDiagnostic(line(data)[0], 'AX111', 'hint', 'none', 'day', 2, [0, 1], 'Use date strings');
  });

  it('AX112 explains the missing time offset', () => {
    expectDiagnostic(line([{ day: '2026-02-24T12:34:56', value: 1 }])[0],
      'AX112', 'hint', 'none', 'day', 1, [0], 'Include a UTC offset or Z');
  });

  it('AX120 identifies negative donut values', () => {
    const diagnostic = check('donut', { data: [{ day: 'Mon', value: -1 }], label: 'day', value: 'value' }).diagnostics.inputs()[0];
    expectDiagnostic(diagnostic, 'AX120', 'error', 'chart-error', 'value', 1, [0], 'Supply non-negative values');
  });

  it('AX143 keeps general label-fitting advice and suggests horizontal bars for vertical category bars', () => {
    const details = { field: 'day', count: 4 };
    const diagnostic = (context = {}) => createDiagnostic('AX143', 'none', { ...details, ...context }, 'presentation').message;
    expect(diagnostic({ chartType: 'bar', xKind: 'category', horizontal: false })).toContain('try horizontal bars');
    for (const context of [{}, { chartType: 'line', xKind: 'category' }, { chartType: 'area', xKind: 'category' },
      { chartType: 'scatter', xKind: 'number' }, { chartType: 'bar', xKind: 'category', horizontal: true },
      { chartType: 'bar', xKind: 'number', horizontal: false }]) {
      expect(diagnostic(context)).toContain('Give the plot more room or shorten the labels.');
      expect(diagnostic(context)).not.toContain('try horizontal bars');
    }
  });

  it('AX150 identifies unknown and chart-specific option keys and suggests a fix', () => {
    const data = [{ day: 1, value: 3 }];
    expectDiagnostic(line(data, { legnd: 'right' })[0], 'AX150', 'warning', 'none', 'legnd', 1, undefined, 'Did you mean "legend"?');
    expectDiagnostic(line(data, { y: { field: 'value', lable: 'Value' } })[0],
      'AX150', 'warning', 'none', 'y.lable', 1, undefined, 'Did you mean "y.label"?');
    expect(line(data, { horizontal: true })[0]?.code).toBe('AX150');
    expectDiagnostic(line(data, { y: ['value'], series: 'day' })[0],
      'AX150', 'warning', 'none', 'series', 1, undefined, 'Use a single y field');
  });

  it.each(['line', 'area', 'bar'] as const)('AX150 reports the reference option once on compact %s', kind => {
    const options = {
      data: [{ day: 1, value: 2 }, { day: 2, value: 4 }], x: { field: 'day' }, y: { field: 'value' },
      reference: [{ y: 1_000, label: 'Target', typo: true }, { x: 20, label: 'Deadline' }],
    };
    const inputs = check(kind, { ...options, compact: true }).diagnostics.inputs();
    expect(inputs).toHaveLength(1);
    expectDiagnostic(inputs[0], 'AX150', 'warning', 'none', 'reference', 1, undefined, 'Compact charts draw no references.');
    expect(readerDisclosure(inputs)).toEqual({ omitted: 0, changed: 0 });
    expect(check(kind, { ...options, compact: false }).diagnostics.inputs()).toMatchObject([
      { code: 'AX150', field: 'reference[0].typo' },
    ]);
    expect(check(kind, { ...options, reference: [] }).diagnostics.inputs()).toEqual([]);
  });

  it('AX151 gives source indexes for out-of-order appends', () => {
    const { resolved } = aligned({ data: [{ day: 2, value: 3 }], x: 'day', y: 'value' });
    const store = new AlignedStore('line', resolved, utc, version);
    const diagnostics = new DiagnosticCollector();
    store.append([{ day: 1, value: 1 }], {}, diagnostics);
    expectDiagnostic(diagnostics.inputs()[0], 'AX151', 'warning', 'none', 'day', 1, [1], 'Append rows in x order');
  });
});

describe('diagnostic collector', () => {
  it('merges by code, field and effect in insertion order, caps samples, and builds public diagnostics', () => {
    const collector = new DiagnosticCollector();
    collector.add(createDiagnostic('AX102', 'omitted', { field: 'y', rows: [0, 1, 2, 3, 4, 5, 6], count: 7 }));
    collector.add(createDiagnostic('AX102', 'changed', { field: 'y', rows: [12], count: 1 }));
    collector.add(createDiagnostic('AX102', 'omitted', { field: 'z', rows: [13], count: 1 }));
    collector.add(createDiagnostic('AX102', 'omitted', { field: 'y', rows: [7, 8, 9, 10, 11], count: 5 }));
    collector.add(createDiagnostic('AX150', 'none', { field: 'width', count: 1 }));
    collector.add(createDiagnostic('AX108', 'series-disabled', { count: 2 }));
    collector.add(createDiagnostic('AX120', 'chart-error', { count: 1 }));
    const inputs = collector.inputs();
    expectDiagnostic(inputs[0], 'AX102', 'warning', 'omitted', 'y', 12, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'send null');
    expect(inputs.map(({ field }) => field)).toEqual(['y', 'y', 'z', 'width', undefined, undefined]);
    expect(readerDisclosure(inputs)).toEqual({ omitted: 13, changed: 1 });
    expect(collector.list('Traffic')[0]).toEqual({
      code: 'AX102', chart: 'Traffic', level: 'warning', field: 'y', count: 12,
      rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], message: expect.stringContaining('12 records'),
    });
  });

  it('retains call origin if a merged finding was also found synchronously', () => {
    const collector = new DiagnosticCollector();
    collector.add(createDiagnostic('AX160', 'none', { field: 'value' }, 'presentation'));
    collector.add(createDiagnostic('AX160', 'none', { field: 'value' }));
    expect(collector.inputs()[0]).toMatchObject({ origin: 'call', count: 2 });
  });
});

it('deduplicates example rows and counts all occurrences before capping samples', () => {
  const collector = new DiagnosticCollector();
  collector.add(createDiagnostic('AX103', 'omitted', { field: 'y', rows: [1, 1, ...Array.from({ length: 10 }, (_, i) => i + 2)] }));
  collector.add(createDiagnostic('AX103', 'omitted', { field: 'y', rows: [3, 12] }));
  expect(collector.inputs()).toMatchObject([{
    count: 14, rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], message: expect.stringContaining('14 non-finite values'),
  }]);
});

it('uses date positions and series names and ends messages with the drawing outcome', () => {
  const gaps = line([1, 2, 4, 5].map(day => ({ day: '2026-03-0' + day, value: 1, s: 'Revenue' })), { series: 's' });
  expect(gaps[0]?.message).toMatch(/"Revenue".*2026-03-03.*Shown as gaps\.$/);
  const duplicates = line([0, 1].map(() => ({ day: '2026-03-01', value: 1, s: 'Revenue' })), { series: 's' });
  expect(duplicates[0]?.message).toMatch(/"Revenue".*2026-03-01.*series is not drawn\.$/i);
});

it('does not suggest far-off names or a field name already present in the data', () => {
  const diagnostics = line([{ day: 1, value: 2, x: 1 }], { x: { field: 9 }, qqqqqqqqqqqq: true });
  expect(diagnostics).toHaveLength(2);
  expect(diagnostics.every(diagnostic => !diagnostic.message.includes('Did you mean'))).toBe(true);
});

describe('AX199 is true both for a defect and for author code that throws while the chart is built', () => {
  it('names both causes and keeps its level and outcome', () => {
    const diagnostic = createDiagnostic('AX199', 'chart-error', {}, 'presentation');
    expect(diagnostic.level).toBe('error');
    expect(diagnostic.message).toMatch(/^Axylo failed while building this chart/);
    expect(diagnostic.message).toMatch(/your code \(a row getter, a callback\), fix it there/);
    expect(diagnostic.message).toMatch(/otherwise it is a defect in Axylo: please report it/);
    expect(diagnostic.message).not.toMatch(/not in your data/);
    expect(diagnostic.message).toMatch(/The chart shows its error state\.$/);
  });

  it('is what a row getter that throws during reading produces', () => {
    const rows = [{ x: 1, y: 1 }, { x: 2, get y(): number { throw new Error('getter failed'); } }];
    const r = record('line', { title: 'T', data: rows, x: 'x', y: 'y' }, { console: false });
    r.frames();
    const ax199 = r.controller.handle.diagnostics.find(d => d.code === 'AX199');
    expect(ax199?.message).toMatch(/fix it there/);
  });
});

describe('AX143 suggests horizontal bars only for vertical bars with category labels, end to end', () => {
  const labels = Array.from({ length: 40 }, (_, i) => `A long category label ${i}`);
  function ax143(kind: 'bar' | 'line' | 'area', data: readonly object[], extra: Record<string, unknown> = {}) {
    const r = record(kind, { title: 'L', data, x: 'x', y: 'y', ...extra }, { container: { width: 300, height: 240 } });
    r.frames();
    return r.controller.handle.diagnostics.find(d => d.code === 'AX143')?.message ?? null;
  }
  const categories = labels.map((x, y) => ({ x, y }));
  it('vertical category bars: suggested', () => {
    expect(ax143('bar', categories)).toMatch(/try horizontal bars \(horizontal: true\)/);
  });
  it.each([
    ['horizontal category bars', 'bar', categories, { horizontal: true }],
    ['category line', 'line', categories, {}],
    ['category area', 'area', categories, {}],
  ] as const)('%s: the general advice without the suggestion', (_, kind, data, extra) => {
    expect(ax143(kind, data, extra)).toMatch(/could not fit\. Give the plot more room or shorten the labels\. The chart/);
    expect(ax143(kind, data, extra)).not.toMatch(/horizontal/);
  });
  it('date bars: never the suggestion (their labels thin instead of hiding)', () => {
    const days = Array.from({ length: 400 }, (_, i) => ({ x: new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10), y: i }));
    const message = ax143('bar', days);
    if (message !== null) expect(message).not.toMatch(/horizontal/);
  });
});

describe('AX150 for every supplied tick format that labels nothing (finding 13)', () => {
  const data = [{ day: 1, a: 2, b: 3 }];
  const tickFormat = () => 'tick';
  function reported(type: 'line' | 'area' | 'bar' | 'donut', options: Record<string, unknown>) {
    const sink = new DiagnosticCollector();
    resolveOptions(type, { data, ...options }, sink);
    return sink.inputs().filter(d => d.code === 'AX150').map(d => [d.field, d.message]);
  }
  const compactly = expect.stringContaining('Compact charts draw no axis ticks.');
  it.each(['line', 'area', 'bar'] as const)('compact %s: x and every y field', type => {
    expect(reported(type, {
      compact: true, x: { field: 'day', tickFormat }, y: [{ field: 'a', tickFormat }, { field: 'b', tickFormat }],
    })).toEqual([['x.tickFormat', compactly], ['y[0].tickFormat', compactly], ['y[1].tickFormat', compactly]]);
  });
  it('a full wide chart: only the fields past the first, whose axis is labelled by y[0]', () => {
    expect(reported('line', { x: { field: 'day', tickFormat }, y: [{ field: 'a', tickFormat }, { field: 'b', tickFormat }] }))
      .toEqual([['y[1].tickFormat', expect.stringContaining('labelled by y[0].tickFormat')]]);
    expect(reported('line', { x: 'day', y: [{ field: 'a', tickFormat }, 'b'] })).toEqual([]);
  });
  it('a donut, which has no axis', () => {
    expect(reported('donut', { label: 'day', value: { field: 'a', tickFormat } }))
      .toEqual([['value.tickFormat', expect.stringContaining('Donut charts draw no axis ticks.')]]);
  });
});
