import { area } from 'axylo';

// Week 3 has no value for "Mobile". The stack there is drawn with that part at zero height, and
// the tooltip, table and announcements mark the total for that week as incomplete.
const rows = [
  { week: '2026-03-02', web: 410, mobile: 220 },
  { week: '2026-03-09', web: 430, mobile: 240 },
  { week: '2026-03-16', web: 455, mobile: null },
  { week: '2026-03-23', web: 470, mobile: 260 },
  { week: '2026-03-30', web: 480, mobile: 275 },
];

area('#chart', {
  title: 'Weekly orders by platform',
  data: rows,
  x: 'week',
  y: [{ field: 'web', label: 'Web' }, { field: 'mobile', label: 'Mobile' }],
  stacked: true,
});
