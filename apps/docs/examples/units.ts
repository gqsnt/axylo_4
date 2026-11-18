import { line } from 'axylo';

const rows = [
  { month: '2026-01', conversion: 0.031, p95: 412 },
  { month: '2026-02', conversion: 0.034, p95: 388 },
  { month: '2026-03', conversion: 0.029, p95: 455 },
  { month: '2026-04', conversion: 0.038, p95: 1210 },
];

// A ratio (0–1) is declared, never guessed from the field name, and is written as a percentage.
// Its axis ends at the first tick above the data, not at 100%, because the data stays far below
// half of full scale.
line('#ratio', {
  title: 'Checkout conversion',
  data: rows,
  x: 'month',
  y: { field: 'conversion', label: 'Conversion', scale: 'ratio' },
});

// A unit follows each value in tooltip, table and announcements, and titles the axis.
// Ticks and readouts are formatted apart: ticks may be compact, readouts are exact.
line('#latency', {
  title: 'Checkout latency',
  data: rows,
  x: 'month',
  y: { field: 'p95', label: 'Latency (p95)', unit: 'ms', tickFormat: { notation: 'compact' } },
});
