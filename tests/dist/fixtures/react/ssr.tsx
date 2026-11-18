// Server rendering from the packed files, in plain Node with no DOM globals (spec DX8). Bundled by the test
// with every package left external, into .out/ inside this fixture, so `@axylo/react`, `axylo` and React are
// resolved by Node from this fixture's node_modules. Prints one JSON line.
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Area, Bar, Donut, Line, Scatter } from '@axylo/react';
import { MonthlyVisitors } from './example/react';

const rows = [
  { day: '2026-01-01', channel: 'Direct', sessions: 10, visits: 4 },
  { day: '2026-01-02', channel: 'Direct', sessions: 12, visits: 5 },
];
type Row = (typeof rows)[number];
const domGlobals = ['window', 'document', 'navigator', 'HTMLElement', 'ResizeObserver'].filter(name => name in globalThis);

const markup: Record<string, string> = {
  MonthlyVisitors: renderToString(<MonthlyVisitors />),
  Line: renderToString(createElement(Line<Row>, { data: rows, x: 'day', y: 'sessions', series: 'channel', title: 'Sessions' })),
  Area: renderToString(createElement(Area<Row>, { data: rows, x: 'day', y: 'sessions', stacked: true, title: 'Sessions' })),
  Bar: renderToString(createElement(Bar<Row>, { data: rows, x: 'channel', y: 'sessions', title: 'Sessions' })),
  Scatter: renderToString(createElement(Scatter<Row>, { data: rows, x: 'visits', y: 'sessions', title: 'Sessions' })),
  Donut: renderToString(createElement(Donut<Row>, { data: rows, label: 'channel', value: 'sessions', title: 'Sessions' })),
};
console.log(JSON.stringify({ domGlobals, markup }));
