import { line } from 'axylo';

// Raises AX130 on purpose: twelve series. The palette has eight colours; past eight, colours repeat and
// each series keeps its own combination of colour and dash or marker, so no two look alike.
const regions = ['North', 'South', 'East', 'West', 'Central', 'Coast', 'Hills', 'Plains',
  'Lakes', 'Islands', 'Valley', 'Delta'];
const rows = regions.flatMap((region, r) => Array.from({ length: 8 }, (_, w) => ({
  week: `2026-W${String(w + 10).padStart(2, '0')}`,
  region,
  orders: 100 + r * 12 + Math.round(10 * Math.sin(w + r)),
})));

line('#chart', {
  title: 'Weekly orders by region',
  data: rows,
  x: { field: 'week', ordered: true },
  y: 'orders',
  series: 'region',
});
