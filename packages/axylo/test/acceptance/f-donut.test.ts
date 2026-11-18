import { expect, it } from 'vitest';
import { sliceText } from '../../src/lookup/text';
import { chart, codes, committed, defaultMessages, message, expectGeometry, lastModel, marks, reading, rows, walk } from './model';

it('F8 donut: slices start at twelve and run clockwise in input order; zero and null are listed without arcs', () => {
  const r = chart('donut', [{ x: 'Retail', y: 3 }, { x: 'None', y: 0 }, { x: 'Unknown', y: null }, { x: 'Trade', y: 1 }]);
  r.frames();
  expect(codes(r)).toEqual([]);
  const arc = marks(r, 'arcs')[0]!;
  expectGeometry(Array.from(arc.angles), [0, 1.5 * Math.PI, 1.5 * Math.PI, 2 * Math.PI]);
  expect(arc.fills.every(paint => paint.kind === 'series')).toBe(true);
  expect(new Set(arc.fills.map(paint => JSON.stringify(paint))).size).toBe(2);
  const { lookup, view, formatters } = committed(r);
  if (view.kind !== 'donut') throw new Error('Expected a donut view');
  expect(view.slices.map(slice => {
    const { label, value, percent } = sliceText(view, slice, formatters);
    return [label, value, percent];
  })).toEqual([['Retail', '3', '75%'], ['None', '0', '0%'], ['Unknown', 'No data', null], ['Trade', '1', '25%']]);
  const legendReadouts = walk(r).map(ref => {
    if (ref.kind !== 'slice') throw new Error('Expected a donut slice');
    const tooltip = lookup.tooltip(ref);
    return [tooltip.title, tooltip.rows[0]?.value, tooltip.rows[0]?.percent];
  });
  expect(legendReadouts).toEqual([
    ['Retail', '3', '75%'], ['None', '0', '0%'], ['Unknown', 'No data', null], ['Trade', '1', '25%'],
  ]);
  expect(rows(r).map(row => row.slice(0, 2))).toEqual([['Retail', '3'], ['None', '0'], ['Unknown', 'No data'], ['Trade', '1']]);
  expect(reading(r, walk(r)[0]!)).toContain('3 (75%)');
  expect(lastModel(r).summary).toContain('Retail: 3 (75%).');
  expect(lastModel(r).summary).toContain('Trade: 1 (25%).');
  expect(lastModel(r).note).toBeNull();
});

it('F8 donut: seven largest categories and Other (3) are drawn; all ten categories remain individually readable in the table', () => {
  const data = [
    { x: 'A', y: 2 }, { x: 'B', y: 13 }, { x: 'C', y: 1 }, { x: 'D', y: 12 }, { x: 'E', y: 11 },
    { x: 'F', y: 10 }, { x: 'G', y: 9 }, { x: 'H', y: 8 }, { x: 'I', y: 7 }, { x: 'J', y: 3 },
  ];
  const r = chart('donut', data);
  r.frames();
  expect(codes(r)).toEqual(['AX121']);
  const { lookup } = committed(r);
  const labelAndValue = walk(r).map(ref => {
    const datum = lookup.datum(ref)!;
    return [datum.seriesLabel, datum.value];
  });
  expect(labelAndValue).toEqual([['B', '13'], ['D', '12'], ['E', '11'], ['F', '10'], ['G', '9'], ['H', '8'], ['I', '7'], ['Other (3)', '6']]);
  const fractions = [0, 13, 25, 36, 46, 55, 63, 70, 76].map(value => value / 76 * 2 * Math.PI);
  const arc = marks(r, 'arcs')[0]!;
  expectGeometry(Array.from(arc.angles), fractions.slice(0, -1).flatMap((start, i) => [start, fractions[i + 1]!]));
  expect(arc.fills.at(-1)).toEqual({ kind: 'token', name: 'muted' });
  expect(rows(r).map(row => row.slice(0, 2))).toEqual(data.map(row => [row.x, String(row.y)]));
  expect(reading(r, walk(r).at(-1)!)).toContain('Other (3)');
  expect(lastModel(r).summary).toContain('Other (3): 6');
});

it('F8 donut: a negative value shows the error state and clears all arcs', () => {
  const r = chart('donut', [{ x: 'A', y: 2 }, { x: 'B', y: 1 }]);
  r.frames();
  r.controller.handle.update({ data: [{ x: 'A', y: 2 }, { x: 'B', y: -1 }] });
  r.frames();
  expect(codes(r)).toEqual(['AX120']);
  expect(marks(r, 'arcs')).toEqual([]);
  expect(lastModel(r).message).toBe(defaultMessages.error);
  expect(r.announcements).toEqual([defaultMessages.error]);
});

it('F8 donut: all-zero values show the empty state while the table retains both zero values', () => {
  const r = chart('donut', [{ x: 'A', y: 0 }, { x: 'B', y: 0 }]);
  r.frames();
  expect(codes(r)).toEqual([]);
  expect(marks(r, 'arcs')).toEqual([]);
  expect(lastModel(r).message).toBe(defaultMessages.empty);
  expect(lastModel(r).summary).toContain(defaultMessages.empty);
  expect(rows(r).map(row => row.slice(0, 2))).toEqual([['A', '0'], ['B', '0']]);
});

it('F8 donut: exactly eight slices including zero and null keep both arcless categories readable', () => {
  const r = chart('donut', [
    ...Array.from({ length: 6 }, (_, i) => ({ x: 'Positive ' + i, y: i + 1 })),
    { x: 'Zero', y: 0 }, { x: 'Missing', y: null },
  ]);
  r.frames();
  expect(codes(r)).toEqual([]);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(12);
  expect(rows(r).slice(-2).map(row => row.slice(0, 2))).toEqual([['Zero', '0'], ['Missing', 'No data']]);
  expect(walk(r).slice(-2).map(ref => committed(r).lookup.datum(ref)?.seriesLabel)).toEqual(['Zero', 'Missing']);
});

// F8 was amended so only slices with an arc count toward the limit.
it('F8 donut: zero and null slices stay separate and only positive slices count toward the limit', () => {
  const positives = Array.from({ length: 9 }, (_, i) => ({ x: 'Slice ' + i, y: i + 1 }));
  const zero = { x: 'Zero', y: 0 };
  const missing = { x: 'Unknown', y: null };
  const r = chart('donut', [...positives.slice(0, 7), zero, missing]);
  r.frames();
  expect(codes(r)).toEqual([]);
  expect(marks(r, 'arcs')[0]?.angles).toHaveLength(14);
  expect(rows(r)).toHaveLength(9);
  expect(rows(r).slice(-2).map(row => row.slice(0, 2))).toEqual([['Zero', '0'], ['Unknown', 'No data']]);
  expect(walk(r).slice(-2).map(ref => committed(r).lookup.datum(ref)?.seriesLabel)).toEqual(['Zero', 'Unknown']);

  const grouped = chart('donut', [...positives, zero]);
  grouped.frames();
  expect(codes(grouped)).toEqual(['AX121']);
  expect(grouped.controller.handle.diagnostics[0]?.count).toBe(2);
  // Seven individual arcs and the grouped arc are drawn. Zero remains an individual legend entry.
  expect(marks(grouped, 'arcs')[0]?.angles).toHaveLength(16);
  const labels = walk(grouped).map(ref => committed(grouped).lookup.datum(ref)?.seriesLabel);
  expect(labels).toEqual([...positives.slice(2).map(row => row.x), 'Zero', message('otherSlices', { count: 2 })]);
  expect(rows(grouped).map(row => row.slice(0, 2))).toEqual([...positives, zero].map(row => [row.x, String(row.y)]));
});
