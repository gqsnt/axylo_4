import { line } from 'axylo';

// Rows as many APIs send a daily metric: each day as a UTC midnight, the count as a string, in no
// particular order, and one day known to have no data.
const rows = [
  { day: '2026-02-26T00:00:00Z', sessions: null },   // no data that day: sent as null, not left out
  { day: '2026-02-24T00:00:00Z', sessions: '3120' },
  { day: '2026-02-27T00:00:00Z', sessions: '3510' },
  { day: '2026-02-25T00:00:00Z', sessions: '3380' },
  { day: '2026-02-28T00:00:00Z', sessions: '3460' },
];

line('#chart', {
  title: 'Daily sessions',
  data: rows,
  // Calendar days, not moments: each UTC midnight is read as its UTC date, the same in every time zone.
  x: { field: 'day', type: 'date' },
  // Decimal strings, converted to JavaScript numbers. Exact only up to 9,007,199,254,740,991.
  y: { field: 'sessions', parse: 'number' },
});
