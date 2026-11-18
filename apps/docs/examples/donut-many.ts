import { donut } from 'axylo';

// Raises AX121 on purpose: nine countries have orders. Once more than eight slices have a positive value,
// the seven largest stay separate and the remaining positive ones (Spain and Norway) are grouped as
// "Other (2)". Iceland (zero orders) and Malta (no value) never count toward the limit: each is listed on
// its own, Iceland without an arc and Malta as "No data". The table lists all eleven.
const rows = [
  { country: 'United States', orders: 4210 }, { country: 'Germany', orders: 1830 },
  { country: 'France', orders: 1290 }, { country: 'Japan', orders: 1120 },
  { country: 'Brazil', orders: 760 }, { country: 'India', orders: 655 },
  { country: 'Canada', orders: 610 }, { country: 'Spain', orders: 340 },
  { country: 'Norway', orders: 120 }, { country: 'Iceland', orders: 0 },
  { country: 'Malta', orders: null },
];

donut('#chart', { title: 'Orders by country', data: rows, label: 'country', value: 'orders' });
