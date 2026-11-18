import { line } from 'axylo';

// Wide rows: one row per x, one field per series. `y` lists the fields; there is no `series`.
const rows = [
  { day: '2026-03-02', direct: 3120, referral: 410 },
  { day: '2026-03-03', direct: 3380, referral: 455 },
  { day: '2026-03-04', direct: 3290, referral: 390 },
  { day: '2026-03-05', direct: 3510, referral: 520 },
];

line('#chart', {
  title: 'Sessions by channel',
  data: rows,
  x: 'day',
  // A field object gives a series its display name.
  y: [{ field: 'direct', label: 'Direct' }, { field: 'referral', label: 'Referral' }],
});
