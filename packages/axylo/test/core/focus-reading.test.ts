/**
 * The keyboard reading's text assembly (src/core/focus.ts) against findings of the final interaction review
 * (reviews/2026-11-18/impl/wp/core-final.interaction.review.md): C2-7 (an incomplete stack qualified once)
 * and finding 14 (whether the reading changed is decided on the datum's identity and values, not by
 * subtracting one translated sentence from another). Views come from the real controller (test/core/host.ts).
 */
import { describe, expect, it } from 'vitest';
import type { AlignedView, DatumRef } from '../../src/core/contracts';
import { alignedRows, datumReading, groupRefs, valueText } from '../../src/core/focus';
import { defaultMessages } from '../../src/messages';
import { record } from './host';

describe('review C2-7: ten stacked series with one gap say "incomplete" once', () => {
  it('the reading of all series at that x qualifies the total only, not each series past the tooltip\'s eight', () => {
    const series = Array.from({ length: 10 }, (_, i) => `S${i}`);
    // S9 has no row at x = 1: that stack is incomplete.
    const data = [0, 1, 2].flatMap(x => series.filter(s => !(x === 1 && s === 'S9')).map((s, i) => ({ x, s, y: i + 1 })));
    const r = record('area', { title: 'T', stacked: true, data, x: 'x', y: 'y', series: 's' });
    r.frames();
    const { view, lookup, formatters } = r.committed!;
    const text = valueText(view, lookup, { kind: 'aligned', seriesKey: 'S0', x: 1 }, 'all', formatters, defaultMessages)!;
    expect(text.match(/incomplete/g)).toHaveLength(1);
    expect(text).toMatch(/Total [^;.]*\(incomplete\)/);
    // All ten series are read, S8 and S9 (past the tooltip's eight) included, as plain values.
    for (const s of series) expect(text).toContain(`${s} `);
    const rows = alignedRows(view as AlignedView, formatters, 1, lookup.tooltip({ kind: 'x', x: 1 }));
    expect(rows.map(row => row.seriesLabel)).toEqual(series);
    expect(rows.filter(row => /incomplete/.test(row.value))).toEqual([]);
  });
});

describe('review finding 14: the reading changes with the datum, not with its place', () => {
  it('a translated point template with the position inside it: an idle append leaves the reading as it was', () => {
    const messages = { ...defaultMessages, pointOf: '{series} {x} {value} [{index}/{count}]' };
    const r = record('scatter', { title: 'T', data: [{ x: 0, y: 2 }], x: 'x', y: 'y', messages: { pointOf: messages.pointOf } });
    r.frames();
    const first = r.committed!;
    const ref = first.lookup.step(null, 'first')!;
    const before = { text: valueText(first.view, first.lookup, ref, 'all', first.formatters, messages), reading: datumReading(first.view, first.lookup, ref, 'all', first.formatters, messages) };
    r.controller.handle.append([{ x: 5, y: 3 }]);
    r.frames();
    const next = r.committed!;
    const after = { text: valueText(next.view, next.lookup, ref, 'all', next.formatters, messages), reading: datumReading(next.view, next.lookup, ref, 'all', next.formatters, messages) };
    // The text's position changed ("[1/1]" to "[1/2]"); what it says about the datum did not.
    expect(before.text).not.toBe(after.text);
    expect(after.reading).toBe(before.reading);
  });

  it('the datum\'s own value changing changes the reading', () => {
    const r = record('line', { title: 'T', data: [{ x: 0, y: 2 }, { x: 1, y: 3 }], x: 'x', y: 'y' });
    r.frames();
    const a = r.committed!;
    const ref: DatumRef = { kind: 'aligned', seriesKey: a.view.kind === 'line' ? a.view.frame.series[0]!.key : '', x: 0 };
    const before = datumReading(a.view, a.lookup, ref, 'all', a.formatters, defaultMessages);
    r.controller.handle.update({ data: [{ x: 0, y: 7 }, { x: 1, y: 3 }] });
    r.frames();
    const b = r.committed!;
    expect(datumReading(b.view, b.lookup, ref, 'all', b.formatters, defaultMessages)).not.toBe(before);
  });
});

describe('rule 8 and finding 6: a coincident group past eight points is listed in full', () => {
  it('groupRefs lists every one of ten coincident points, the pick\'s eight first', () => {
    const data = Array.from({ length: 10 }, (_, i) => ({ x: 5, y: 5, s: 'A', id: i }));
    const r = record('scatter', { title: 'T', data: [...data, { x: 1, y: 1, s: 'A' }, { x: 9, y: 9, s: 'A' }], x: 'x', y: 'y', series: 's' });
    r.frames();
    const { lookup } = r.committed!;
    const anchor = lookup.anchor(lookup.step(null, 'first')!)!;
    void anchor;
    const someRef = (() => {
      let at = lookup.step(null, 'first');
      for (let k = 0; at && k < 12; k++) {
        const box = lookup.anchor(at)!;
        const picked = lookup.pick(box.x + box.width / 2, box.y + box.height / 2);
        if (picked?.kind === 'point' && picked.count === 10) return picked;
        at = lookup.step(at, 'next');
      }
      return null;
    })();
    expect(someRef).not.toBeNull();
    const refs = groupRefs(lookup, someRef!);
    expect(refs).toHaveLength(10);
    expect(refs.slice(0, someRef!.refs.length)).toEqual(someRef!.refs);
    expect(new Set(refs.map(ref => ref.kind === 'point' ? ref.row : -1)).size).toBe(10);
  });
});

describe('review verification, item 8: the group is enumerated by the lookup\'s own coincidence, not by adjacency', () => {
  it('twelve near-coincident points interleaved in x order with distant ones: all twelve, and only they', () => {
    // A_i at x = 5 + i·1e-6, y = 5; between each two, a distant point at y = 95 (a slightly larger x, so it
    // comes between them in the lookup's x-then-y order).
    const data = Array.from({ length: 12 }, (_, i) => [{ x: 5 + i * 1e-6, y: 5, s: 'A', id: i }, { x: 5 + i * 1e-6 + 5e-7, y: 95, s: 'A', id: 100 + i }]).flat();
    const r = record('scatter', { title: 'T', data: [...data, { x: 0, y: 0, s: 'A', id: 200 }, { x: 10, y: 100, s: 'A', id: 201 }], x: 'x', y: 'y', series: 's' });
    r.frames();
    const { lookup } = r.committed!;
    const first: DatumRef = { kind: 'point', seriesKey: 'A', row: 0, x: 5 };
    const box = lookup.anchor(first)!;
    const picked = lookup.pick(box.x + box.width / 2, box.y + box.height / 2);
    expect(picked?.kind).toBe('point');
    if (picked?.kind !== 'point') return;
    expect(picked.count).toBe(12);
    const refs = groupRefs(lookup, picked);
    expect(refs).toHaveLength(12);
    const rows = new Set(refs.map(ref => ref.kind === 'point' ? ref.row : -1));
    // Source rows of the A_i are the even ones (0, 2, …, 22).
    expect([...rows].sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => 2 * i));
  });
});

describe('review verification, item 10: a narrowed category that slides keeps its reading', () => {
  it('narrowed to Q3 in Q1–Q4, Q5 appended with keep 4: the single-series reading of Q3 is the same', () => {
    const r = record('bar', { title: 'T', data: ['Q1', 'Q2', 'Q3', 'Q4'].map((x, i) => ({ x, y: i + 1 })), x: 'x', y: 'y' });
    r.frames();
    const a = r.committed!;
    const key = a.view.kind === 'bar' ? a.view.frame.series[0]!.key : '';
    const before = datumReading(a.view, a.lookup, { kind: 'aligned', seriesKey: key, x: 2 }, 'single', a.formatters, defaultMessages);
    r.controller.handle.append([{ x: 'Q5', y: 5 }], { keep: 4 });
    r.frames();
    const b = r.committed!;
    // Q3 is now at index 1.
    expect(datumReading(b.view, b.lookup, { kind: 'aligned', seriesKey: key, x: 1 }, 'single', b.formatters, defaultMessages)).toBe(before);
  });
});
