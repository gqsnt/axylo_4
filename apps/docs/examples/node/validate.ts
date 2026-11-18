// Runs in Node, on a server or in a build step: validate() needs no DOM.
import { validate } from 'axylo';

const rows = [
  { day: '2026-03-02', orders: '182' },
  { day: '2026-03-03', orders: '205' },
  { day: '2026-03-04', orders: null },
];

const problems = validate('bar', {
  title: 'Orders per day',
  data: rows,
  x: 'day',
  y: { field: 'orders', parse: 'number' },
});

// Errors and warnings mean something will not be drawn as given; hints are advice.
const blocking = problems.filter(d => d.level !== 'hint');
if (blocking.length > 0) {
  throw new Error(blocking.map(d => `${d.code} ${d.chart}: ${d.message}`).join('\n'));
}
console.log(`Checked "Orders per day": ${problems.length} diagnostics, none blocking.`);
