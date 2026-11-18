import { donut } from 'axylo';

// Raises AX121 on purpose: eleven countries. The seven largest are drawn, the rest are grouped as
// "Other (n)", and the table still lists every country. Iceland has zero (listed, no arc);
// Malta has no value (listed as "No data").
const rows = [
  { country: 'United States', orders: 4210 }, { country: 'Germany', orders: 1830 },
  { country: 'France', orders: 1290 }, { country: 'Japan', orders: 1120 },
  { country: 'Brazil', orders: 760 }, { country: 'India', orders: 655 },
  { country: 'Canada', orders: 610 }, { country: 'Spain', orders: 340 },
  { country: 'Norway', orders: 120 }, { country: 'Iceland', orders: 0 },
  { country: 'Malta', orders: null },
];

donut('#chart', { title: 'Orders by country', data: rows, label: 'country', value: 'orders' });
