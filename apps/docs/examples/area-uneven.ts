import { area } from 'axylo';

// Web orders arrive every day; the call centre reports once a week, on Mondays. Stacked, the days between the
// call centre's rows have no value for it, so the stack there is incomplete: its band has zero height and its
// line follows the band down rather than being joined across, and the total is marked "incomplete", because
// a total made of values the data does not contain would be invented.
const days = Array.from({ length: 14 }, (_, i) => `2026-03-${String(i + 2).padStart(2, '0')}`);
const rows = [
  ...days.map((day, i) => ({ day, channel: 'Web', orders: 120 + 5 * i })),
  { day: '2026-03-02', channel: 'Call centre', orders: 300 },
  { day: '2026-03-09', channel: 'Call centre', orders: 280 },
];

area('#chart', {
  title: 'Orders by channel',
  data: rows,
  x: 'day',
  y: { field: 'orders', label: 'Orders' },
  series: 'channel',
  stacked: true,
});
