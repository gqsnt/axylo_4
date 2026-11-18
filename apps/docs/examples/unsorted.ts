import { line } from 'axylo';

// Rows in any order: a line is drawn in x order. Nothing is reported, because nothing is wrong.
const rows = [
  { week: '2026-03-16', tickets: 42 },
  { week: '2026-03-02', tickets: 51 },
  { week: '2026-03-23', tickets: 38 },
  { week: '2026-03-09', tickets: 47 },
];

line('#chart', { title: 'Open tickets per week', data: rows, x: 'week', y: 'tickets' });
