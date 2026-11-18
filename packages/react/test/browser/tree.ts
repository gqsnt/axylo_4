/**
 * The tree the hydration test renders twice: to a string in Node, and with hydrateRoot in the browser.
 */
import { createElement, StrictMode, type ReactElement } from 'react';
import { Donut, Line } from '../../src/index';

const rows = [
  { day: '2026-01-01', channel: 'Direct', sessions: 31 },
  { day: '2026-01-02', channel: 'Direct', sessions: 35 },
  { day: '2026-01-03', channel: 'Direct', sessions: 29 },
];
const slices = [{ channel: 'Direct', sessions: 30 }, { channel: 'Organic', sessions: 20 }];

export function hydrationTree(): ReactElement {
  return createElement(StrictMode, null,
    createElement('section', { className: 'cards' },
      createElement('h2', null, 'Report'),
      createElement(Line<(typeof rows)[number]>, { data: rows, x: 'day', y: 'sessions', title: 'Hydrated line', className: 'card', style: { height: 260 } }),
      createElement(Donut<(typeof slices)[number]>, { data: slices, label: 'channel', value: 'sessions', title: 'Hydrated donut', style: { height: 260 } })));
}
