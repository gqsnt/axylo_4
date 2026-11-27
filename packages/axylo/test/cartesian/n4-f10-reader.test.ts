/**
 * N4 repair: spec F10 "a missing component ... marks the stack 'incomplete' in tooltip, table and
 * announcements" for `axylo/cartesian`, read through the reader's real summary text, the table cells, the
 * tooltip total and the keyboard reading (lookup.datum) of the same pipeline.
 *
 * Expected wording comes from the default messages the spec's reader uses (messages/index.ts):
 * `incompleteAt` "{label}: incomplete at {positions}." (at most three positions), `incompleteCount`
 * "{label}: {count} incomplete stacks.", and the "(incomplete)" qualifier. A component is missing when its slot
 * holds no value for any reason (null, gap, no row); a real zero is a value and completes its stack.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SLOT_GAP, SLOT_NO_ROW, SLOT_NULL, type AlignedView } from '../../src/core/contracts';
import { cartesianStacks } from '../../src/cartesian/stacks';
import { run } from './n4-pipeline';

type Cell = number | null;

const stacked = (rows: readonly Record<string, Cell>[], mark: 'bar' | 'area' = 'bar', fields = ['a', 'b']) => ({
  title: 'Stack', data: rows, x: 'x', axes: { v: { position: 'left' } },
  layers: [{ type: mark, y: fields, yAxis: 'v', stacked: true }],
});

/** Series `s`' slot `i` replaced by a non-value state, as normalization would leave it. */
function slotState(s: number, i: number, state: number) {
  return (view: AlignedView): AlignedView => ({
    ...view,
    frame: {
      ...view.frame,
      series: view.frame.series.map((series, k) => {
        if (k !== s) return series;
        const slot = series.slot.slice();
        const y = series.y.slice();
        slot[i] = state as never;
        y[i] = NaN;
        return { ...series, slot, y };
      }),
    },
  });
}

const hide = (s: number) => (view: AlignedView): AlignedView => ({
  ...view, visible: view.visible.map((v, k) => (k === s ? false : v)),
});

const sentenceAt = (label: string, positions: readonly string[]) => `${label}: incomplete at ${positions.join(', ')}.`;

describe('N4 F10 announcements: the Cartesian summary says where a stack is incomplete', () => {
  it('names the x of a null component and not the x of a real zero', () => {
    const res = run(stacked([{ x: 1, a: 5, b: 3 }, { x: 2, a: null, b: 4 }, { x: 3, a: 0, b: 2 }]));
    const f = res.formatters;
    const label = res.frame.xLabel;
    expect(res.reader.summary).toContain(sentenceAt(label, [f.x(2)]));
    // The same slot in the table, the tooltip total and the keyboard reading of the missing component.
    expect(res.reader.table!.row(1)![0]).toBe(`${f.x(2)} (incomplete)`);
    expect(res.reader.table!.row(2)![0]).toBe(f.x(3));
    expect(res.lookup.tooltip({ kind: 'x', x: 2 }).total).toBe(`${f.value(0, 4)} (incomplete)`);
    expect(res.lookup.tooltip({ kind: 'x', x: 3 }).total).toBe(f.value(0, 2));
    const a = res.frame.series[0]!.key;
    expect(res.lookup.datum({ kind: 'aligned', seriesKey: a, x: 2 })!.value).toBe(`${f.missing(SLOT_NULL)} (incomplete)`);
    expect(res.lookup.datum({ kind: 'aligned', seriesKey: a, x: 3 })!.value).toBe(f.value(0, 0));
  });

  it('treats an explicit gap and a slot with no row as missing components, in every channel', () => {
    for (const state of [SLOT_GAP, SLOT_NO_ROW]) {
      const res = run(stacked([{ x: 1, a: 5, b: 3 }, { x: 2, a: 1, b: 4 }, { x: 3, a: 2, b: 1 }]), { edit: slotState(1, 0, state) });
      const f = res.formatters;
      expect(res.reader.summary).toContain(sentenceAt(res.frame.xLabel, [f.x(1)]));
      expect(res.reader.table!.row(0)![0]).toBe(`${f.x(1)} (incomplete)`);
      expect(res.lookup.tooltip({ kind: 'x', x: 1 }).total).toBe(`${f.value(0, 5)} (incomplete)`);
      expect(res.lookup.datum({ kind: 'aligned', seriesKey: res.frame.series[1]!.key, x: 1 })!.value)
        .toBe(`${f.missing(state as never)} (incomplete)`);
    }
  });

  it('a slot where every component is missing reads "no data" as its total, incomplete in tooltip, table and summary', () => {
    const res = run(stacked([{ x: 1, a: 5, b: 3 }, { x: 2, a: null, b: null }, { x: 3, a: 2, b: 1 }]));
    const f = res.formatters;
    // F10: a missing component marks the stack incomplete in the tooltip too, even when no component has a value.
    expect(res.lookup.tooltip({ kind: 'x', x: 2 }).total).toBe(`${f.missing(SLOT_NULL)} (incomplete)`);
    expect(res.reader.table!.row(1)![0]).toBe(`${f.x(2)} (incomplete)`);
    expect(res.reader.summary).toContain(sentenceAt(res.frame.xLabel, [f.x(2)]));
    for (const series of res.frame.series) {
      expect(res.lookup.datum({ kind: 'aligned', seriesKey: series.key, x: 2 })!.value).toBe(`${f.missing(SLOT_NULL)} (incomplete)`);
    }
  });

  it('lists up to three positions and counts beyond them, and covers stacked areas the same way', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(x => ({ x, a: x % 2 ? null : x, b: 1 }));
    const res = run(stacked(rows, 'area'));
    expect(res.reader.summary).toContain(sentenceAt(res.frame.xLabel, [1, 3, 5].map(x => res.formatters.x(x))));
    const four = run(stacked([1, 2, 3, 4, 5].map(x => ({ x, a: x < 5 ? null : 1, b: 1 })), 'area'));
    expect(four.reader.summary).toContain(`${four.frame.xLabel}: ${four.formatters.count(4)} incomplete stacks.`);
    expect(four.reader.summary).not.toContain('incomplete at');
  });

  it('follows visibility: hiding the component that is missing makes the stack complete', () => {
    const rows = [{ x: 1, a: 5, b: 3 }, { x: 2, a: null, b: 4 }];
    const shown = run(stacked(rows));
    expect(shown.reader.summary).toContain('incomplete at');
    const hidden = run(stacked(rows), { edit: hide(0) });
    expect(hidden.reader.summary).not.toContain('incomplete');
    expect(hidden.reader.table!.row(1)![0]).toBe(hidden.formatters.x(2));
    expect(hidden.lookup.tooltip({ kind: 'x', x: 2 }).total).toBe(hidden.formatters.value(1, 4));
  });

  it('follows the zoom window: an incomplete slot outside it is not announced', () => {
    const rows = [1, 2, 3, 4, 5, 6].map(x => ({ x, a: x === 2 ? null : x, b: 1 }));
    const all = run(stacked(rows));
    expect(all.reader.summary).toContain(sentenceAt(all.frame.xLabel, [all.formatters.x(2)]));
    const right = run(stacked(rows), { zoom: [4, 6] });
    expect(right.view.visibleSlots.start).toBeGreaterThan(1);
    expect(right.reader.summary).not.toContain('incomplete');
  });

  it('follows updates: the stacks are read from each new view, never from a stale cache', () => {
    const before = run(stacked([{ x: 1, a: null, b: 3 }, { x: 2, a: 1, b: 4 }]));
    const after = run(stacked([{ x: 1, a: 2, b: 3 }, { x: 2, a: 1, b: 4 }]));
    expect(before.reader.summary).toContain('incomplete at');
    expect(after.reader.summary).not.toContain('incomplete');
    expect(cartesianStacks(after.view, after.stateRef.meta).incomplete).toBeNull();
  });

  it('keeps an entirely missing but visible linear component in its stack: every slot is incomplete', () => {
    // A field with no value anywhere is still a declared, visible series (core normalization only disables a
    // series for duplicate x, AX108); hiding is what removes a component, not missing data.
    const rows = [1, 2, 3, 4].map(x => ({ x, a: x, b: null }));
    const res = run(stacked(rows));
    const b = res.frame.series[1]!;
    expect(res.view.visible[1]).toBe(true);
    expect(b.drawable).toBe(true);
    const stacks = cartesianStacks(res.view, res.stateRef.meta);
    expect(stacks.groups[0]!.order).toEqual([0, 1]);
    expect(Array.from(stacks.incomplete!)).toEqual([1, 1, 1, 1]);
    expect(res.reader.summary).toContain(`${res.frame.xLabel}: ${res.formatters.count(4)} incomplete stacks.`);
    expect(res.lookup.tooltip({ kind: 'x', x: 3 }).total).toBe(`${res.formatters.value(0, 3)} (incomplete)`);
  });

  it('property: the announced positions are exactly the visible slots with a missing visible component', () => {
    const cell = fc.oneof(fc.integer({ min: -9, max: 9 }), fc.constant(null));
    fc.assert(fc.property(fc.array(fc.tuple(cell, cell), { minLength: 1, maxLength: 12 }), fc.boolean(), (cells, hideA) => {
      const rows = cells.map(([a, b], i) => ({ x: i + 1, a, b }));
      const res = run(stacked(rows), hideA ? { edit: hide(0) } : {});
      const f = res.formatters;
      const missing = rows.filter(r => (!hideA && r.a === null) || r.b === null).map(r => r.x);
      const summary = res.reader.summary;
      if (!missing.length) expect(summary).not.toContain('incomplete');
      else if (missing.length <= 3) expect(summary).toContain(sentenceAt(res.frame.xLabel, missing.map(x => f.x(x))));
      else expect(summary).toContain(`${res.frame.xLabel}: ${f.count(missing.length)} incomplete stacks.`);
      rows.forEach((r, i) => {
        expect(res.reader.table!.row(i)![0]!.endsWith('(incomplete)')).toBe(missing.includes(r.x));
      });
    }), { numRuns: 60 });
  });
});
