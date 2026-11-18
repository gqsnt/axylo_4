import { bar } from 'axylo';

// Long category names read best on horizontal bars. Two fields give grouped bars.
// "Partner integrations" has no value for 2026: a "no data" mark, distinct from a zero bar.
const rows = [
  { area: 'Account settings and profile', y2025: 42, y2026: 51 },
  { area: 'Billing, invoices and refunds', y2025: 77, y2026: 64 },
  { area: 'Partner integrations', y2025: 18, y2026: null },
  { area: 'Data export and reporting', y2025: 35, y2026: 39 },
  { area: 'Mobile app', y2025: 0, y2026: 12 },
];

bar('#chart', {
  title: 'Support tickets by product area',
  data: rows,
  x: 'area',
  y: [{ field: 'y2025', label: '2025' }, { field: 'y2026', label: '2026' }],
  horizontal: true,
});
