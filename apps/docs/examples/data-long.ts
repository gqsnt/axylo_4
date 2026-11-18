import { line } from 'axylo';

// Long rows: one row per x and series. `series` names the field that says which series a row is.
const rows = [
  { day: '2026-03-02', channel: 'Direct', sessions: 3120 },
  { day: '2026-03-02', channel: 'Referral', sessions: 410 },
  { day: '2026-03-03', channel: 'Direct', sessions: 3380 },
  { day: '2026-03-03', channel: 'Referral', sessions: 455 },
  { day: '2026-03-04', channel: 'Direct', sessions: 3290 },
  { day: '2026-03-04', channel: 'Referral', sessions: 390 },
  { day: '2026-03-05', channel: 'Direct', sessions: 3510 },
  { day: '2026-03-05', channel: 'Referral', sessions: 520 },
];

line('#chart', {
  title: 'Sessions by channel',
  data: rows,
  x: 'day',
  y: 'sessions',
  series: 'channel',
});
