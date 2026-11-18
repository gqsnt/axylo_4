import { area } from 'axylo';

const channels = ['Direct', 'Organic search', 'Referral'];
const rows = Array.from({ length: 12 }, (_, m) => channels.map((channel, c) => ({
  month: `2025-${String(m + 1).padStart(2, '0')}`,
  channel,
  sessions: Math.round([42000, 27000, 6000][c]! * (1 + 0.03 * m) + 3000 * Math.cos(m / 2 + c)),
}))).flat();

// Stacked: each band sits on the ones before it; the tooltip adds the stack total.
area('#chart', {
  title: 'Monthly sessions by channel',
  data: rows,
  x: 'month',
  y: { field: 'sessions', label: 'Sessions' },
  series: 'channel',
  stacked: true,
});
