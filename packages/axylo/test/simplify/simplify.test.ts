import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SLOT_ABSENT_FIELD, SLOT_GAP, SLOT_INVALID, SLOT_NO_ROW, SLOT_NULL, SLOT_VALUE,
} from '../../src/core/contracts';
import { buildPath, buildPoints, joinRuns, simplifyArea, simplifyLine } from '../../src/simplify';
import type { LineInput } from '../../src/simplify';

const identity = (value: number) => value;
const range = (end: number, start = 0) => ({ start, end });
const indexes = (start: number, end: number) => Array.from({ length: end - start }, (_, i) => start + i);

function line(y: readonly number[], slot: readonly number[] = y.map(() => SLOT_VALUE)): LineInput {
  return {
    x: Float64Array.from(y, (_, i) => i / 32),
    y: Float64Array.from(y),
    slot: Uint8Array.from(slot),
    range: range(y.length),
    mapX: identity,
    left: 0,
    width: 1,
    devicePixelRatio: 1,
  };
}

describe('joining and drawing lines', () => {
  it('bridges only no-row slots and reports isolated values in the draw range', () => {
    const slot = Uint8Array.of(
      SLOT_VALUE, SLOT_VALUE, SLOT_NO_ROW, SLOT_VALUE, SLOT_NULL, SLOT_VALUE,
      SLOT_INVALID, SLOT_VALUE, SLOT_GAP, SLOT_VALUE, SLOT_ABSENT_FIELD, SLOT_VALUE,
      SLOT_NO_ROW, SLOT_VALUE, SLOT_NULL, SLOT_VALUE, SLOT_NO_ROW, SLOT_VALUE, SLOT_VALUE,
    );
    const joined = joinRuns(slot, range(18, 1));
    expect([...joined.indexes]).toEqual([1, 3, 11, 13, 15, 17]);
    expect([...joined.breaks]).toEqual([2, 4]);
    expect([...joined.isolated]).toEqual([5, 7, 9]);
    expect(joinRuns(slot, range(4, 4))).toEqual({
      indexes: new Uint32Array(), breaks: new Uint32Array(), isolated: new Uint32Array(),
    });
  });

  it('keeps both peaks, breaks the path in the same column, and packs the isolated point', () => {
    const input = line(
      [0, 1, 12, 2, 2, 0, NaN, 0, 2, 20, 1, 0, NaN, 8],
      [0, 0, 0, 0, 0, 0, SLOT_GAP, 0, 0, 0, 0, 0, SLOT_NULL, 0],
    );
    const kept = simplifyLine(input);
    expect([...kept.indexes]).toEqual([0, 2, 5, 7, 9, 11]);
    expect([...kept.breaks]).toEqual([3]);
    expect([...kept.isolated]).toEqual([13]);

    const projection = { ...input, mapX: (x: number) => x * 32, mapY: (y: number) => 100 - y };
    expect(buildPath(kept.indexes, kept.breaks, projection)).toEqual(Float32Array.of(
      0, 100, 2, 88, 5, 100, NaN, NaN, 7, 100, 9, 80, 11, 100,
    ));
    expect(buildPoints(kept.isolated, projection)).toEqual(Float32Array.of(13, 92));
  });

  it('keeps every alternating value as an isolated point in a single column', () => {
    const input = line(indexes(0, 32), indexes(0, 32).map(i => i % 2 ? SLOT_NULL : SLOT_VALUE));
    const kept = simplifyLine(input);
    expect([...kept.indexes]).toEqual([]);
    expect([...kept.breaks]).toEqual([]);
    expect([...kept.isolated]).toEqual(indexes(0, 16).map(i => 2 * i));
  });

  it('keeps every value at the density threshold and simplifies just above it', () => {
    const input = line(indexes(0, 9));
    const highDpi = { ...input, y: Float32Array.from(input.y), devicePixelRatio: 2 };
    expect([...simplifyLine({ ...highDpi, range: range(8) }).indexes]).toEqual(indexes(0, 8));
    expect([...simplifyLine(highDpi).indexes]).toEqual([0, 8]);
  });

  it('counts value slots instead of no-row slots when deciding whether to simplify', () => {
    const y = indexes(0, 25);
    const input = line(y, y.map(i => i % 8 ? SLOT_NO_ROW : SLOT_VALUE));
    const kept = simplifyLine(input);
    expect([...kept.indexes]).toEqual([0, 8, 16, 24]);
    expect([...kept.breaks]).toEqual([]);
  });

  it('counts the device columns touched by a fractional plot range', () => {
    const input = line(indexes(0, 9));
    const shifted = { ...input, left: 0.75, mapX: (x: number) => x + 0.75 };
    expect([...simplifyLine({ ...shifted, range: range(8) }).indexes]).toEqual(indexes(0, 8));
    expect([...simplifyLine(shifted).indexes]).toEqual([0, 7, 8]);
  });

  it('keeps the earlier extremes and both endpoints with irregular x and a partial draw range', () => {
    const input = {
      ...line([-100, 4, -2, -2, 8, 8, 3, 5, 9, 9, -1, -1, 2, 6, 100]),
      x: Float64Array.of(-2, -0.99, -0.91, -0.9, -0.89, -0.85, -0.21, 0.01, 0.12, 0.25, 0.27, 0.43, 0.65, 0.99, 1.3),
      range: range(14, 1),
      left: -1,
      width: 2,
    };
    expect([...simplifyLine(input).indexes]).toEqual([1, 2, 4, 6, 7, 8, 10, 13]);
  });

  it('keeps a million-slot outlier at multiple plot widths and device ratios', () => {
    const count = 1_000_000;
    const outlier = 701_337;
    const x = Float64Array.from({ length: count }, (_, index) => index / count);
    const y = new Float64Array(count).fill(3);
    y[outlier] = 1000;
    const slot = new Uint8Array(count);
    for (const width of [97, 320, 877]) {
      for (const devicePixelRatio of [1, 2]) {
        const mapX = (sample: number) => sample * width;
        const column = (index: number) => Math.floor(mapX(x[index]!) * devicePixelRatio);
        expect(column(outlier - 1)).toBe(column(outlier + 1));

        const before = performance.now();
        const kept = simplifyLine({ x, y, slot, range: range(count), mapX, left: 0, width, devicePixelRatio });
        const ms = performance.now() - before;
        console.info(`Simplified ${count} slots at ${width}px and DPR ${devicePixelRatio} in ${ms.toFixed(1)} ms`);
        expect(ms).toBeLessThan(200);
        expect(kept.indexes).toContain(outlier);
        expect(kept.indexes.length).toBe(2 * width * devicePixelRatio + 1);
      }
    }
  });

  it('preserves column extrema and endpoints, never crosses a break, and is idempotent', () => {
    const state = fc.oneof(
      { weight: 6, arbitrary: fc.constant(SLOT_VALUE) },
      { weight: 2, arbitrary: fc.constant(SLOT_NO_ROW) },
      { weight: 1, arbitrary: fc.constantFrom(SLOT_NULL, SLOT_INVALID, SLOT_GAP, SLOT_ABSENT_FIELD) },
    );
    const row = fc.record({ state, y: fc.integer({ min: -20, max: 20 }), dx: fc.integer({ min: 1, max: 10 }) });
    fc.assert(fc.property(
      fc.array(row, { maxLength: 180, size: 'large' }), fc.integer({ min: 1, max: 40 }), fc.constantFrom(0.75, 1, 1.5, 2),
      fc.nat(10), fc.nat(10),
      (rows, width, ratio, skipStart, skipEnd) => {
        let current = 0;
        const x = Float64Array.from(rows, row => current += row.dx);
        const y = Float64Array.from(rows, row => row.y);
        const slot = Uint8Array.from(rows, row => row.state);
        const start = Math.min(skipStart, rows.length);
        const end = Math.max(start, rows.length - skipEnd);
        const left = -0.25;
        const mapX = (p: number) => left + p * width / (current + 1);
        const input = { x, y, slot, range: range(end, start), mapX, left, width, devicePixelRatio: ratio };
        const kept = simplifyLine(input);

        const values = indexes(start, end).filter(i => slot[i] === SLOT_VALUE);
        const runs: number[][] = [];
        for (const [offset, index] of values.entries()) {
          const previous = values[offset - 1];
          if (previous === undefined || !slot.slice(previous + 1, index).every(state => state === SLOT_NO_ROW)) {
            runs.push([index]);
          } else {
            runs[runs.length - 1]!.push(index);
          }
        }
        const dense = values.length > 4 * (Math.ceil((left + width) * ratio) - Math.floor(left * ratio));
        const expected: number[] = [];
        const breaks: number[] = [];
        const isolated: number[] = [];
        let columns = 0;
        for (const run of runs) {
          if (run.length === 1) {
            isolated.push(run[0]!);
            columns++;
            continue;
          }
          if (expected.length) breaks.push(expected.length);
          const byColumn = new Map<number, number[]>();
          for (const index of run) {
            const column = Math.floor(mapX(x[index]!) * ratio);
            const group = byColumn.get(column);
            if (group) group.push(index);
            else byColumn.set(column, [index]);
          }
          columns += byColumn.size;
          for (const group of byColumn.values()) {
            const samples = group.map(i => y[i]!);
            const targets = new Set([
              group[0]!, group[group.length - 1]!,
              group[samples.indexOf(Math.min(...samples))]!, group[samples.indexOf(Math.max(...samples))]!,
            ]);
            expected.push(...group.filter(i => !dense || targets.has(i)));
          }
        }

        expect([...kept.indexes]).toEqual(expected);
        expect([...kept.breaks]).toEqual(breaks);
        expect([...kept.isolated]).toEqual(isolated);
        expect(kept.indexes.every((index, i) => slot[index] === SLOT_VALUE && (i === 0 || index > kept.indexes[i - 1]!))).toBe(true);
        if (dense) expect(kept.indexes.length + kept.isolated.length).toBeLessThanOrEqual(4 * columns);

        const selection = new Set([...kept.indexes, ...kept.isolated]);
        const thinned = Uint8Array.from(slot, (state, i) => state === SLOT_VALUE && !selection.has(i) ? SLOT_NO_ROW : state);
        expect(simplifyLine({ ...input, slot: thinned })).toEqual(kept);
      },
    ), { numRuns: 300 });
  });
});

describe('drawing areas', () => {
  const upper = [3, 8, 1, 8, 2, 4, NaN, 4, 4, 4, 11, 4, 4, 2, NaN, 5];
  const bottom = [0, 0, 0, -4, 0, 0, NaN, -1, -4, 0, -4, 0, 0, -1, NaN, 0];
  const base = line(upper, upper.map(y => Number.isNaN(y) ? SLOT_GAP : SLOT_VALUE));
  const input = { ...base, upper: Float64Array.from(upper), lower: Float64Array.from(bottom), mapY: identity };
  const sourceIndexes = (xy: Float32Array) => Array.from(xy.filter((_, i) => i % 2 === 0), x => x * 32);

  it('preserves each boundary’s own extremes and pairs matching endpoints across breaks', () => {
    const area = simplifyArea(input);
    expect(sourceIndexes(area.upper)).toEqual([0, 1, 2, 5, 7, 10, 13]);
    expect(sourceIndexes(area.lower)).toEqual([0, 3, 5, 7, 8, 9, 13]);
    expect([...area.runs]).toEqual([0, 4, 0, 3, 4, 3, 3, 4]);
    expect([...area.isolated]).toEqual([15]);
  });

  it('shares an exact packed edge between adjacent bands and recalculates it for a new range', () => {
    const area = simplifyArea(input);
    const adjacent = { ...input, slot: input.slot.slice(), upper: Float64Array.from(input.upper, y => y + 10), lower: area.upperBoundary };
    const next = simplifyArea(adjacent);
    expect(next.lower).toBe(area.upper);
    expect([...next.runs]).toEqual([0, 4, 0, 4, 4, 3, 4, 3]);
    const zoomed = simplifyArea({ ...adjacent, range: range(14, 1) });
    expect(zoomed.lower).not.toBe(area.upper);
    expect(sourceIndexes(zoomed.lower)).toEqual([1, 2, 5, 7, 10, 13]);
  });

  it('recalculates a shared edge if the adjacent band has a different gap', () => {
    const area = simplifyArea(input);
    const slot = input.slot.slice();
    slot[3] = SLOT_NULL;
    const next = simplifyArea({ ...input, slot, lower: area.upperBoundary });
    expect(next.lower).not.toBe(area.upper);
    expect(sourceIndexes(next.lower)).toEqual([0, 1, 2, 4, 5, 7, 10, 13]);
    expect([...next.runs]).toEqual([0, 3, 0, 3, 3, 2, 3, 2, 5, 3, 5, 3]);
  });

  it('supports an unstacked zero baseline without a full lower data column', () => {
    const area = simplifyArea({ ...input, lower: 0, mapY: y => 100 - y });
    expect(sourceIndexes(area.lower)).toEqual([0, 5, 7, 13]);
    expect([...area.lower.filter((_, i) => i % 2 === 1)]).toEqual([100, 100, 100, 100]);
    expect([...area.runs]).toEqual([0, 4, 0, 2, 4, 3, 2, 2]);
  });
});
