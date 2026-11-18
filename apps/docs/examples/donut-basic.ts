import { donut } from 'axylo';

// The Phase 1 "parts" task. Slices keep this order, start at 12 o'clock and run clockwise; the
// legend shows each value and its percentage as text.
const rows = [
  { browser: 'Chrome', share: 46.2 },
  { browser: 'Safari', share: 27.5 },
  { browser: 'Edge', share: 14.1 },
  { browser: 'Firefox', share: 8.9 },
  { browser: 'Samsung Internet', share: 2.1 },
  { browser: 'Other', share: 1.2 },
];

donut('#chart', {
  title: 'Sessions by browser',
  data: rows,
  label: 'browser',
  value: { field: 'share', label: 'Share', scale: 'percent' },
});
