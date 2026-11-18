import { line } from 'axylo';

const rows = [
  { month: '2026-01', visitors: 4210 },
  { month: '2026-02', visitors: 4685 },
  { month: '2026-03', visitors: 5302 },
  { month: '2026-04', visitors: 5127 },
];

line('#chart', { title: 'Monthly visitors', data: rows, x: 'month', y: 'visitors' });
