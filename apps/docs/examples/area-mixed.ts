import { area } from 'axylo';

// A stack with both signs: inflows stack up from zero, outflows down from it. The top edge is the total of
// the inflows and the bottom edge the total of the outflows; the tooltip names both: for the week of 9 March, "12 k USD and -7 k USD".
const rows = [
  { week: '2026-03-02', sales: 9, refunds: 3, returns: -4, chargebacks: -1 },
  { week: '2026-03-09', sales: 10, refunds: 2, returns: -5, chargebacks: -2 },
  { week: '2026-03-16', sales: 8, refunds: 4, returns: -6, chargebacks: -1 },
  { week: '2026-03-23', sales: 11, refunds: 3, returns: -4, chargebacks: -3 },
];

area('#chart', {
  title: 'Cash movements per week',
  data: rows,
  x: 'week',
  y: [
    { field: 'sales', label: 'Sales', unit: 'k USD' },
    { field: 'refunds', label: 'Refunds received', unit: 'k USD' },
    { field: 'returns', label: 'Returns paid', unit: 'k USD' },
    { field: 'chargebacks', label: 'Chargebacks', unit: 'k USD' },
  ],
  stacked: true,
});
