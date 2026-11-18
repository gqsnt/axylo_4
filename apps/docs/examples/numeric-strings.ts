import { bar } from 'axylo';

// Postgres returns `count(*)` as a string (bigint). Declaring the parse says that is expected.
const rows = [
  { day: '2026-03-02', orders: '182' },
  { day: '2026-03-03', orders: '205' },
  { day: '2026-03-04', orders: '199' },
  { day: '2026-03-05', orders: '231' },
];

bar('#chart', {
  title: 'Orders per day',
  data: rows,
  x: 'day',
  y: { field: 'orders', parse: 'number', label: 'Orders' },
});
