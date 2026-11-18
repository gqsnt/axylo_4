import { scatter } from 'axylo';

// The second request timed out, so it has a size but no latency. It cannot be a point, but it is still
// an observation: the table lists it, with "No data" as its latency.
const rows = [
  { size: 12, ms: 84 },
  { size: 48, ms: null },
  { size: 30, ms: 131 },
  { size: 75, ms: 210 },
];

scatter('#chart', {
  title: 'Latency by payload size',
  data: rows,
  x: { field: 'size', label: 'Payload', unit: 'KB' },
  y: { field: 'ms', label: 'Latency', unit: 'ms' },
});
