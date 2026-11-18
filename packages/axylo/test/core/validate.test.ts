import { describe, expect, it } from 'vitest';
import * as Axylo from '../../src/index';

const days = ['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11'];
// The Phase 1 combined dirty fixture (research/harness/src/data.js).
const dirty = [10, 20, null, NaN, '40', undefined, 70];

describe('the package in Node (spec DX8)', () => {
  it('imports without a DOM and exports the five chart functions and validate', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    for (const name of ['line', 'area', 'bar', 'scatter', 'donut', 'validate'] as const) expect(typeof Axylo[name]).toBe('function');
  });

  it('validate reports the combined dirty fixture as AX102, AX103 and AX106, once each', () => {
    const data = days.map((day, i) => (dirty[i] === undefined ? { day } : { day, value: dirty[i] }));
    const options = { title: 'Dirty input', data: data as never, x: 'day', y: 'value' as never };
    for (const [type, diagnostics] of [['line', Axylo.validate('line', options as never)], ['area', Axylo.validate('area', options as never)], ['bar', Axylo.validate('bar', options as never)]] as const) {
      expect(diagnostics.map(d => d.code).sort(), type).toEqual(['AX102', 'AX103', 'AX106']);
    }
  });

  it('validate works for scatter and donut', () => {
    const points = [{ a: 1, b: 2 }, { a: 2, b: NaN }];
    expect(Axylo.validate('scatter', { title: 'S', data: points, x: 'a', y: 'b' }).map(d => d.code)).toEqual(['AX103']);
    const parts = [{ label: 'Chrome', share: 46.2 }, { label: 'Safari', share: -1 }];
    expect(Axylo.validate('donut', { title: 'D', data: parts, label: 'label', value: 'share' }).map(d => d.code)).toEqual(['AX120']);
  });

  it('validate raises AX140 without a title or labelledBy, and AX101 for a misspelled field', () => {
    const codes = Axylo.validate('line', { data: [{ day: '2026-01-01', value: 1 }], x: 'day', y: 'valeu' as never }).map(d => d.code).sort();
    expect(codes).toEqual(['AX101', 'AX140']);
  });

  it('a chart function without a DOM fails with a message, not a crash at import', () => {
    expect(() => Axylo.line('#nowhere', { data: [], x: 'a' as never, y: 'b' as never })).toThrow(/#nowhere/);
  });
});
