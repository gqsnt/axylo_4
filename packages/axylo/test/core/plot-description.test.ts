import { expect, it } from 'vitest';
import { plotDescription } from '../../src/dom/interaction';
import { record, type Recording } from './host';

const POINTS = 'Left and right arrows move between points along x. Enter selects.';
const SLICES = 'Arrow keys move between slices. Enter selects.';
const SERIES = 'Up and down arrows move between series.';
const ZOOM = 'Plus and minus zoom. Press 0 to reset. Hold Shift with left or right to pan the zoomed view.';
const line = { title: 'Trend', x: 'x', y: 'y', data: [{ x: 1, y: 2 }, { x: 2, y: 4 }] };
const twoSeries = { ...line, series: 's', data: line.data.flatMap(row => [{ ...row, s: 'A' }, { ...row, s: 'B', y: row.y + 1 }]) };
const donut = { title: 'Slices', label: 'label', value: 'y', data: [{ label: 'A', y: 2 }, { label: 'B', y: 4 }] };

function description(chart: Recording): string {
  chart.frames();
  return plotDescription(chart.committed!).map(part => part.text).join(' ');
}

it('describes the navigation and zoom that apply to the chart type (A2, I3)', () => {
  expect(description(record('line', twoSeries))).toBe(`${POINTS} ${SERIES} ${ZOOM}`);
  expect(description(record('line', line))).toBe(`${POINTS} ${ZOOM}`);
  expect(description(record('bar', line))).toBe(`${POINTS} ${ZOOM}`);
  expect(description(record('bar', { ...line, data: line.data.map(row => ({ ...row, x: `Q${row.x}` })) }))).toBe(POINTS);
  expect(description(record('donut', donut))).toBe(SLICES);
});

it('follows committed zoom and visibility changes', () => {
  const chart = record('line', twoSeries);
  expect(description(chart)).toBe(`${POINTS} ${SERIES} ${ZOOM}`);
  chart.controller.handle.update({ zoom: false });
  expect(description(chart)).toBe(`${POINTS} ${SERIES}`);
  chart.controller.actions.toggle('B');
  expect(description(chart)).toBe(POINTS);
  chart.controller.actions.toggle('A');
  expect(description(chart)).toBe('');
  chart.controller.actions.toggle('B');
  chart.controller.actions.toggle('A');
  expect(description(chart)).toBe(`${POINTS} ${SERIES}`);
  chart.controller.handle.update({ zoom: true });
  expect(description(chart)).toBe(`${POINTS} ${SERIES} ${ZOOM}`);
});

it('describes switching scatter series only while both have points in the window', () => {
  const chart = record('scatter', { ...twoSeries, data: twoSeries.data.map(r => ({ ...r, x: r.s === 'A' ? r.x : r.x + 10 })) });
  expect(description(chart)).toBe(`${POINTS} ${SERIES} ${ZOOM}`);
  chart.controller.handle.zoom([1, 3]);
  expect(description(chart)).toBe(`${POINTS} ${ZOOM}`);
});

it('keeps a legacy override whole, with explicit new overrides available on the charts they describe (A10)', () => {
  const messages = { plotInstructions: 'Eigene Tastaturhilfe.' };
  expect(description(record('line', { ...twoSeries, messages }))).toBe('Eigene Tastaturhilfe.');
  expect(description(record('donut', { ...donut, messages }))).toBe('Eigene Tastaturhilfe.');

  const translated = { ...messages, donutInstructions: 'Mit den Pfeiltasten zwischen Segmenten wechseln.', zoomInstructions: 'Mit Plus vergrößern.' };
  expect(description(record('line', { ...twoSeries, messages: translated }))).toBe('Eigene Tastaturhilfe. Mit Plus vergrößern.');
  expect(description(record('donut', { ...donut, messages: translated }))).toBe('Mit den Pfeiltasten zwischen Segmenten wechseln.');

  // Authorship still counts if the supplied base text happens to match the new English default.
  expect(description(record('line', { ...twoSeries, messages: { plotInstructions: POINTS } }))).toBe(POINTS);
});
