/**
 * Exact lookup of the heatmap: O(1) picking, the 2D keyboard grid (non-wrapping), and readings that are the
 * frame's exact values (never a bin), identical in tooltip, announcement and table. Expected cells come from
 * arithmetic on the fixture grid (cell = row × cols + col).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DatumRef, StepDirection } from '../../../src/core/contracts';
import { heatmapTable, MATRIX_COLUMNS, tableLayoutOf } from '../../../src/spatial/heatmap/reader';
import { cellOf, PAGE_ROWS, stepCell } from '../../../src/spatial/heatmap/render';
import { grid, stage } from './fixtures';

const cellAt = (ref: DatumRef | null) => (ref && ref.kind === 'point' ? ref.x : -1);

describe('picking', () => {
  it('the centre (and every interior point) of any cell picks that cell, by arithmetic', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 30 }), fc.integer({ min: 1, max: 30 }), fc.double({ min: 0.01, max: 0.99, noNaN: true }), fc.double({ min: 0.01, max: 0.99, noNaN: true }), (rows, cols, fx, fy) => {
      const s = stage({ data: grid(rows, cols, (r, c) => r * 100 + c) });
      expect(s.layout.kind).toBe('plot');
      if (s.layout.kind !== 'plot') return;
      const { plot } = s.layout;
      const cw = plot.width / cols, ch = plot.height / rows;
      for (const [r, c] of [[0, 0], [rows - 1, cols - 1], [rows >> 1, cols >> 1]] as const) {
        const target = s.lookup.pick(plot.x + (c + fx) * cw, plot.y + (r + fy) * ch);
        expect(target?.kind).toBe('point');
        const ref = target!.kind === 'point' ? target!.refs[0]! : null;
        expect(cellAt(ref)).toBe(r * cols + c);
        // The tooltip reads the exact value of that cell from the frame.
        expect(s.lookup.tooltip(target!).rows[0]!.value).toBe(s.formatters.value(0, r * 100 + c));
      }
    }), { numRuns: 60 });
  });

  it('picks nothing more than 1 px outside the plot, and the edge cell within 1 px', () => {
    const s = stage({ data: grid(3, 4, () => 1) });
    if (s.layout.kind !== 'plot') throw new Error('no plot');
    const { plot } = s.layout;
    expect(s.lookup.pick(plot.x - 1.5, plot.y + 1)).toBeNull();
    expect(cellAt((s.lookup.pick(plot.x - 0.5, plot.y + 1) as unknown as { refs: DatumRef[] }).refs[0]!)).toBe(0);
    expect(s.lookup.pick(plot.x + plot.width + 2, plot.y + plot.height + 2)).toBeNull();
    expect(cellAt((s.lookup.pick(plot.x + plot.width + 1, plot.y + plot.height + 1) as unknown as { refs: DatumRef[] }).refs[0]!)).toBe(11);
  });
});

describe('2D keyboard grid', () => {
  const directions: StepDirection[] = ['next', 'previous', 'series-next', 'series-previous', 'first', 'last', 'page-next', 'page-previous'];

  it('moves by one column or row, never wraps, and stays inside the grid (property)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 40 }), fc.integer({ min: 1, max: 40 }), fc.nat(), fc.constantFrom(...directions), (rows, cols, seed, dir) => {
      const cell = seed % (rows * cols);
      const r = Math.floor(cell / cols), c = cell % cols;
      const to = stepCell(rows, cols, cell, dir);
      const expected = (nr: number, nc: number) => (nr < 0 || nr >= rows || nc < 0 || nc >= cols || (nr === r && nc === c) ? null : nr * cols + nc);
      const want = {
        next: expected(r, c + 1), previous: expected(r, c - 1), 'series-next': expected(r + 1, c), 'series-previous': expected(r - 1, c),
        first: expected(r, 0), last: expected(r, cols - 1),
        'page-next': expected(Math.max(0, r - PAGE_ROWS), c), 'page-previous': expected(Math.min(rows - 1, r + PAGE_ROWS), c),
      }[dir];
      expect(to).toBe(want);
    }));
  });

  it('through the lookup: first focus is the top-left cell, missing cells are reachable and read "No data"', () => {
    const s = stage({ data: grid(3, 4, (r, c) => (r === 1 && c === 1 ? null : r * 10 + c)) });
    const first = s.lookup.step(null, 'first')!;
    expect(cellAt(first)).toBe(0);
    const right = s.lookup.step(first, 'next')!;
    const down = s.lookup.step(right, 'series-next')!;
    expect(cellAt(down)).toBe(5);
    expect(s.lookup.datum(down)!.value).toBe('No data');
    // At the right edge ArrowRight does nothing (null: focus stays), at the bottom ArrowDown does nothing.
    const end = s.lookup.step(first, 'last')!;
    expect(cellAt(end)).toBe(3);
    expect(s.lookup.step(end, 'next')).toBeNull();
    let bottom = first;
    for (let i = 0; i < 2; i++) bottom = s.lookup.step(bottom, 'series-next')!;
    expect(s.lookup.step(bottom, 'series-next')).toBeNull();
    expect(s.lookup.step(first, 'previous')).toBeNull();
    expect(s.lookup.step(first, 'series-previous')).toBeNull();
    // Ordinals are row-major cell indexes, so "Cell 6 of 12" for row 2, column 2.
    expect(s.lookup.ordinal(down)).toBe(5);
    expect(s.lookup.count).toBe(12);
  });

  it('reads the row and column with their positions, and the exact value', () => {
    const s = stage({ data: grid(3, 4, (r, c) => r * 10 + c + 0.125) });
    const ref = s.lookup.step(s.lookup.step(s.lookup.step(null, 'first')!, 'series-next')!, 'next')!;
    const d = s.lookup.datum(ref)!;
    expect(d.seriesLabel).toBe('r r1 (row 2 of 3)');
    expect(d.x).toBe('c c1 (column 2 of 4)');
    expect(d.value).toBe('11.125');
    expect(s.lookup.anchor(ref)).toEqual(s.layout.kind === 'plot'
      ? { x: s.layout.plot.x + s.layout.plot.width / 4, y: s.layout.plot.y + s.layout.plot.height / 3, width: s.layout.plot.width / 4, height: s.layout.plot.height / 3 }
      : null);
  });

  it('resolves a ref of the same epoch to the canonical cell, and rejects a ref whose row does not match', () => {
    const s = stage({ data: grid(2, 2, () => 1) });
    expect(cellAt(s.lookup.resolve({ kind: 'point', seriesKey: 'v', row: 3, x: 3 }))).toBe(3);
    expect(s.lookup.resolve({ kind: 'point', seriesKey: 'v', row: 0, x: 9 })).toBeNull();
    expect(cellOf(s.m, { kind: 'point', seriesKey: 'v', row: 2, x: 3 })).toBe(-1);
  });
});

describe('readings agree everywhere and are exact', () => {
  it('tooltip, announcement and table show the same unquantized text for every cell (property, wide finite range)', () => {
    const value = fc.oneof(fc.double({ noNaN: true, noDefaultInfinity: true }), fc.constant(null), fc.constant(0), fc.constant(-0));
    fc.assert(fc.property(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 30 }), fc.array(value, { minLength: 150, maxLength: 150 }), (rows, cols, values) => {
      const s = stage({ data: grid(rows, cols, (r, c) => values[r * cols + c]!) });
      const table = heatmapTable(s.m, 'caption', s.formatters);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cell = r * cols + c;
        const ref = { kind: 'point', seriesKey: 'v', row: cell, x: cell } as const;
        const v = values[cell]!;
        const want = v === null ? 'No data' : s.formatters.value(0, v);
        expect(s.lookup.tooltip({ kind: 'point', refs: [ref], count: 1 }).rows[0]!.value).toBe(want);
        expect(s.lookup.datum(ref)!.value).toBe(want);
        const tableText = cols <= MATRIX_COLUMNS ? table.row(r)![c + 1] : table.row(cell)![2];
        expect(tableText).toBe(want);
      }
    }), { numRuns: 40 });
  });

  it('a zero reads 0, missing reads No data, invalid reads Invalid value with its raw text', () => {
    const s = stage({ data: grid(1, 3, (_r, c) => [0, null, 'n/a'][c]) });
    const read = (cell: number) => s.lookup.datum({ kind: 'point', seriesKey: 'v', row: cell, x: cell })!.value;
    expect([read(0), read(1), read(2)]).toEqual(['0', 'No data', 'Invalid value ("n/a")']);
  });
});

describe('duplicate cells (AX182) are disclosed in every reading', () => {
  it('the kept first value, then the rows not drawn (first three, then a count), alike in tooltip, keyboard and table', () => {
    const data = { columns: {
      r: ['a', 'a', 'a', 'a', 'a', 'a', 'b'], c: ['x', 'x', 'x', 'x', 'x', 'y', 'x'], v: [1, 2.5, null, 'n/a', 7, 3, 4],
    } };
    const s = stage({ data });
    const ref = { kind: 'point', seriesKey: 'v', row: 0, x: 0 } as const;
    const want = '1 (duplicate rows not drawn: 2.5, No data, "n/a", +1)';
    expect(s.lookup.datum(ref)!.value).toBe(want);
    expect(s.lookup.tooltip({ kind: 'point', refs: [ref], count: 1 }).rows[0]!.value).toBe(want);
    expect(heatmapTable(s.m, 'cap', s.formatters).row(0)).toEqual(['a', want, '3']);
    // A cell without duplicates reads its value alone.
    expect(s.lookup.datum({ kind: 'point', seriesKey: 'v', row: 6, x: 2 })!.value).toBe('4');
  });
});

describe('table layout', () => {
  it('is the matrix up to 24 columns (column headers, row header first) and long from 25', () => {
    const at24 = stage({ data: grid(2, 24, (r, c) => r + c) });
    const t24 = heatmapTable(at24.m, 'cap', at24.formatters);
    expect(tableLayoutOf(at24.m)).toBe('matrix');
    expect(t24.headers).toEqual(['r', ...Array.from({ length: 24 }, (_, c) => `c${c}`)]);
    expect(t24.rowCount).toBe(2);
    expect(t24.row(1)!.slice(0, 3)).toEqual(['r1', '1', '2']);
    expect(t24.row(2)).toBeNull();
    const at25 = stage({ data: grid(2, 25, (r, c) => r + c) });
    const t25 = heatmapTable(at25.m, 'cap', at25.formatters);
    expect(tableLayoutOf(at25.m)).toBe('long');
    expect(t25.headers).toEqual(['r', 'c', 'v']);
    expect(t25.rowCount).toBe(50);
    expect(t25.row(26)).toEqual(['r1', 'c1', '2']);
    expect(t25.row(50)).toBeNull();
  });

  it('finds the page of a row by its name', () => {
    const s = stage({ data: grid(120, 25, () => 1) });
    const t = heatmapTable(s.m, 'cap', s.formatters);
    // Row r4 starts at long row 4 × 25 = 100: page floor(100 / 50) = 2.
    expect(t.pageForX('r4')).toBe(2);
    expect(t.pageForX('nope')).toBeNull();
    const narrow = stage({ data: grid(120, 3, () => 1) });
    expect(heatmapTable(narrow.m, 'cap', narrow.formatters).pageForX('r60')).toBe(1);
  });

  it('is lazy: rows are made when asked for, so a 50,000-cell table costs nothing up front', () => {
    const s = stage({ data: grid(250, 200, () => 1) });
    let made = 0;
    const counting = { ...s.formatters, value: (i: number, v: number) => { made++; return s.formatters.value(i, v); } };
    const t = heatmapTable(s.m, 'cap', counting);
    expect(made).toBe(0);
    expect(t.rowCount).toBe(50_000);
    t.row(49_999);
    expect(made).toBe(1);
  });
});
