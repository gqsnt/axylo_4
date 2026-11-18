import { scatter } from 'axylo';

// Two measures per request, coloured by region. Hover picks the nearest point within 24 px.
const regions = ['eu-west', 'us-east', 'ap-south'];
const rows = Array.from({ length: 150 }, (_, i) => {
  const region = regions[i % 3]!;
  const size = 5 + ((i * 37) % 95);
  const ms = Math.round(40 + size * (1.2 + (i % 3) * 0.5) + 30 * Math.sin(i * 1.7));
  return { size, ms, region };
});

scatter('#chart', {
  title: 'Latency by payload size',
  data: rows,
  x: { field: 'size', label: 'Payload', unit: 'KB' },
  y: { field: 'ms', label: 'Latency', unit: 'ms' },
  series: 'region',
});
