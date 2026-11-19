import { validate } from 'axylo';

const rows = [
  { day: '2026-03-02', orders: 182 },
  { day: '2026-03-03', orders: 205 },
  { day: '2026-03-05', orders: 231 },
  { day: '2026-03-06', orders: 210 },
];

const findings = validate('bar', {
  title: 'Orders per day',
  data: rows,
  x: 'day',
  y: 'orders',
});

for (const finding of findings) {
  console.log(`${finding.code} ${finding.level}: ${finding.message}`);
}
if (findings.some(finding => finding.level !== 'hint')) {
  throw new Error('Review the chart data.');
}
