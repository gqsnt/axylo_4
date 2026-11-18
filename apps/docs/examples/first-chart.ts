import { line } from 'axylo';

// Rows as an API returns them: one row per day and channel.
const channels = ['Direct', 'Organic search', 'Referral'];
const rows = Array.from({ length: 30 }, (_, i) => channels.map((channel, c) => ({
  day: `2026-03-${String(i + 1).padStart(2, '0')}`,
  channel,
  sessions: Math.round([31000, 18000, 4200][c]! * (1 + 0.004 * i) + 2500 * Math.sin(i / 1.1 + c)),
}))).flat();

line('#chart', {
  title: 'Daily sessions by channel',
  data: rows,
  x: 'day',
  y: 'sessions',
  series: 'channel',
});
