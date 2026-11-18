import { line, bar } from 'axylo';

// Raises AX105 on purpose: 2026-03-04 has no row in either chart.
const rows = [
  { day: '2026-03-01', signups: 12 },
  { day: '2026-03-02', signups: 0 },     // a real zero: drawn at zero
  { day: '2026-03-03', signups: null },  // null: no data, drawn as a gap
  { day: '2026-03-05', signups: 9 },     // 2026-03-04 is absent: also a gap
  { day: '2026-03-06', signups: 14 },
  { day: '2026-03-07', signups: 11 },
];

line('#gaps', { title: 'Missing means no data', data: rows, x: 'day', y: 'signups' });

// For counts, a day without a row had no events: `missing: 'zero'` draws null and absent as zero.
bar('#zeros', {
  title: 'Missing means zero',
  data: rows,
  x: 'day',
  y: { field: 'signups', missing: 'zero' },
});
