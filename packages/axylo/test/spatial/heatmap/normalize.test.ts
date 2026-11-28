/**
 * Heatmap normalization and its call-time diagnostics, through `validateHeatmap` (Node, no DOM) and the pure
 * stage. Expected values are written from the fixtures and the policy in docs/progress/n8a-heatmap-ledger.md:
 * first-seen category order, first row of a duplicate cell wins (AX182), non-finite or non-numeric values are
 * invalid (AX183), null / absent / empty values are missing, and missing ≠ invalid ≠ 0.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SLOT_INVALID, SLOT_NULL, SLOT_VALUE } from '../../../src/core/contracts';
import { resolveOptions } from '../../../src/data/options';
import { DiagnosticCollector } from '../../../src/diagnostics/collector';
import { heatmap, validateHeatmap } from '../../../src/spatial/heatmap/index';
import { DENSE_CELLS, matrixOf, NO_BIN, normalizeHeatmap, parseHeatmapInput } from '../../../src/spatial/heatmap/core';

type Row = { day: string; hour: string; v: unknown };

function build(options: Record<string, unknown>) {
  const parsed = parseHeatmapInput(options);
  const sink = new DiagnosticCollector();
  const resolved = resolveOptions('line', parsed.translated, sink);
  const frame = normalizeHeatmap(parsed.meta, resolved, sink, { epoch: 1, revision: 1 });
  return { frame, m: matrixOf(frame)!, diagnostics: sink.inputs(), parsed };
}

const SMALL: Row[] = [
  { day: 'Mon', hour: '09', v: 0 },
  { day: 'Mon', hour: '10', v: null },
  { day: 'Tue', hour: '09', v: Number.NaN },
  { day: 'Tue', hour: '10', v: 5 },
  // Wed 09 has no row at all; Wed 10 is a string.
  { day: 'Wed', hour: '10', v: 'n/a' },
];

describe('cells: missing, invalid and zero are three different things', () => {
  it('keeps first-seen order and gives each cell its own state, value and source row', () => {
    const { m, frame } = build({ title: 't', data: SMALL, x: 'hour', y: 'day', value: 'v' });
    expect(m.yKeys).toEqual(['Mon', 'Tue', 'Wed']);
    expect(m.xKeys).toEqual(['09', '10']);
    expect([m.rows, m.cols]).toEqual([3, 2]);
    expect([...m.state]).toEqual([SLOT_VALUE, SLOT_NULL, SLOT_INVALID, SLOT_VALUE, SLOT_NULL, SLOT_INVALID]);
    expect(m.values[0]).toBe(0);
    expect(m.values[3]).toBe(5);
    expect([...m.source]).toEqual([0, 1, 2, 3, -1, 4]);
    // A zero gets a color bin; missing and invalid cells get none.
    expect(m.bin[0]).not.toBe(NO_BIN);
    expect([m.bin[1], m.bin[2], m.bin[4], m.bin[5]]).toEqual([NO_BIN, NO_BIN, NO_BIN, NO_BIN]);
    expect([m.valueCount, m.missingCount, m.invalidCount]).toEqual([2, 2, 2]);
    // The controller's shell: one series over the cell indexes, the very arrays of the matrix (no copy).
    expect(frame.length).toBe(6);
    expect(frame.series).toHaveLength(1);
    expect(frame.series[0]!.y).toBe(m.values);
    expect(frame.series[0]!.slot).toBe(m.state);
    expect(frame.series[0]!.row).toBe(m.source);
    expect([...frame.x.values]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('for any matrix, a finite value is never missing or invalid, and null never becomes 0', () => {
    const cell = fc.oneof(
      fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constant(null), fc.constant(undefined), fc.constant(Number.NaN),
      fc.constant(Infinity), fc.constant(-Infinity), fc.constant('x'), fc.constant(0),
    );
    fc.assert(fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 6 }), fc.array(cell, { minLength: 36, maxLength: 36 }), (rows, cols, cells) => {
      const data: Row[] = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data.push({ day: `r${r}`, hour: `c${c}`, v: cells[r * cols + c] });
      const { m } = build({ title: 't', data, x: 'hour', y: 'day', value: 'v' });
      for (let i = 0; i < rows * cols; i++) {
        const v = data[i]!.v;
        const expected = typeof v === 'number' && Number.isFinite(v) ? SLOT_VALUE : v === null || v === undefined ? SLOT_NULL : SLOT_INVALID;
        expect(m.state[i]).toBe(expected);
        if (expected === SLOT_VALUE) expect(Object.is(m.values[i], v)).toBe(true);
        else expect(Number.isNaN(m.values[i])).toBe(true);
        expect(m.bin[i] === NO_BIN).toBe(expected !== SLOT_VALUE);
      }
    }));
  });

  it('reads columns too: NaN in a typed column is missing (contract SLOT_NULL), Infinity is invalid', () => {
    const { m, diagnostics } = build({
      title: 't', x: 'c' as const, y: 'r' as const, value: 'v' as const,
      data: { columns: { r: ['a', 'a', 'b', 'b'], c: ['x', 'y', 'x', 'y'], v: Float64Array.of(1, Number.NaN, Infinity, -2) } },
    });
    expect([...m.state]).toEqual([SLOT_VALUE, SLOT_NULL, SLOT_INVALID, SLOT_VALUE]);
    expect(diagnostics.filter(d => d.code === 'AX183').map(d => d.count)).toEqual([1]);
  });

  it('uses given categories as the order and extent; rows outside them are reported, not drawn', () => {
    const { m, diagnostics } = build({
      title: 't', data: SMALL, value: 'v',
      x: { field: 'hour', categories: ['10', '09', '11'] }, y: { field: 'day', categories: ['Wed', 'Mon'] },
    });
    expect(m.xKeys).toEqual(['10', '09', '11']);
    expect(m.yKeys).toEqual(['Wed', 'Mon']);
    // Wed/10 is the string (invalid), Mon/10 null, Mon/09 zero; Tue rows are outside.
    expect([...m.state]).toEqual([SLOT_INVALID, SLOT_NULL, SLOT_NULL, SLOT_NULL, SLOT_VALUE, SLOT_NULL]);
    const outside = diagnostics.find(d => d.code === 'AX183' && d.message.includes('outside the given categories'))!;
    expect(outside.rows).toEqual([2, 3]);
    expect(outside.effect).toBe('omitted');
  });
});

describe('diagnostics AX182–AX186', () => {
  it('AX182: duplicate cells keep the first row, count every later one, sample their rows (capped at 10)', () => {
    const data: Row[] = [{ day: 'a', hour: 'x', v: 1 }];
    for (let i = 0; i < 12; i++) data.push({ day: 'a', hour: 'x', v: 100 + i });
    const out = validateHeatmap({ title: 't', data, x: 'hour', y: 'day', value: 'v' });
    const d = out.find(x => x.code === 'AX182')!;
    expect(d.level).toBe('warning');
    expect(d.count).toBe(12);
    expect(d.rows).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(build({ title: 't', data, x: 'hour', y: 'day', value: 'v' }).m.values[0]).toBe(1);
  });

  it('AX183: invalid values with count and rows; rows with an unusable key separately', () => {
    const data = [
      { day: 'a', hour: 'x', v: Infinity }, { day: 'a', hour: 'y', v: '3' }, { day: null, hour: 'y', v: 3 },
      { day: 'b', hour: {}, v: 4 }, { day: 'b', hour: 'x', v: 2 },
    ];
    const out = validateHeatmap({ title: 't', data: data as never, x: 'hour', y: 'day', value: 'v' });
    const ax183 = out.filter(x => x.code === 'AX183');
    expect(ax183.map(d => [d.count, d.rows])).toEqual([[2, [0, 1]], [2, [2, 3]]]);
    expect(ax183.every(d => d.level === 'warning')).toBe(true);
  });

  it('AX184: an unusable domain or midpoint is a warning; the data range is used instead', () => {
    const data = [{ day: 'a', hour: 'x', v: 1 }, { day: 'a', hour: 'y', v: 3 }];
    const codes = (color: unknown) => validateHeatmap({ title: 't', data, x: 'hour', y: 'day', value: 'v', color: color as never })
      .filter(d => d.code === 'AX184').map(d => d.field);
    expect(codes({ domain: [5, 5] })).toEqual(['color.domain']);
    expect(codes({ domain: [5, 1] })).toEqual(['color.domain']);
    expect(codes({ domain: [0, Infinity] })).toEqual(['color.domain']);
    expect(codes({ scheme: 'diverging', mid: Number.NaN })).toEqual(['color.mid']);
    expect(codes({ scheme: 'diverging', domain: [0, 10], mid: 20 })).toEqual(['color.mid']);
    // A domain the data does not reach: drawn in end colors, and said.
    expect(codes({ domain: [10, 20] })).toEqual(['color.domain']);
    expect(codes({ domain: [0, 10] })).toEqual([]);
    expect(codes({ scheme: 'diverging', domain: [-10, 10], mid: 0 })).toEqual([]);
    const { m } = build({ title: 't', data, x: 'hour', y: 'day', value: 'v', color: { domain: [5, 5] } });
    expect([m.domain!.lo, m.domain!.hi, m.explicitDomain]).toEqual([1, 3, false]);
  });

  it('an inferred constant domain is not a finding: every value takes the middle bin', () => {
    const data = [{ day: 'a', hour: 'x', v: 7 }, { day: 'a', hour: 'y', v: 7 }];
    const out = validateHeatmap({ title: 't', data, x: 'hour', y: 'day', value: 'v' });
    expect(out.filter(d => d.code.startsWith('AX18'))).toEqual([]);
    const { m } = build({ title: 't', data, x: 'hour', y: 'day', value: 'v' });
    expect(m.domain!.degenerate).toBe(true);
    expect([...m.bin]).toEqual([16, 16]);
  });

  it('AX186: more than 50,000 cells is a hint; exactly 50,000 is not', () => {
    const grid = (rows: number, cols: number) => ({
      title: 't', x: 'c' as const, y: 'r' as const, value: 'v' as const,
      data: { columns: {
        r: Array.from({ length: rows * cols }, (_, i) => `r${Math.floor(i / cols)}`),
        c: Array.from({ length: rows * cols }, (_, i) => `c${i % cols}`),
        v: Float64Array.from({ length: rows * cols }, (_, i) => i),
      } },
    });
    expect(validateHeatmap(grid(250, 200)).filter(d => d.code === 'AX186')).toEqual([]);
    expect(250 * 200).toBe(DENSE_CELLS);
    const dense = validateHeatmap(grid(251, 200)).find(d => d.code === 'AX186')!;
    expect([dense.level, dense.count]).toEqual(['hint', 50_200]);
  });

  it('unknown options and bad color options are AX150; a missing field is AX101 (error)', () => {
    const data = [{ day: 'a', hour: 'x', v: 1 }];
    const out = validateHeatmap({ title: 't', data, x: 'hour', y: 'day', value: 'v', zoom: true, colors: {}, color: { bins: 1, shade: 2 } } as never);
    expect(out.filter(d => d.code === 'AX150').map(d => d.field).sort()).toEqual(['color.bins', 'color.shade', 'colors', 'zoom']);
    const missing = validateHeatmap({ title: 't', data, x: 'hour', y: 'dya' as never, value: 'v' });
    expect(missing.find(d => d.code === 'AX101')?.level).toBe('error');
  });

  it('a clean matrix with a title has no findings', () => {
    expect(validateHeatmap({ title: 't', data: [{ day: 'a', hour: 'x', v: 1 }], x: 'hour', y: 'day', value: 'v' })).toEqual([]);
  });
});

describe('Node / SSR', () => {
  it('validates without a DOM; creating a chart needs a target', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    expect(() => heatmap('#nowhere', { data: [], x: 'a', y: 'b', value: 'c' } as never)).toThrow(/no document/);
  });
});
