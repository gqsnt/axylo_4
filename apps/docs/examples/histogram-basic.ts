import { histogram } from 'axylo';

histogram('#chart', {
  title: 'Request latency',
  data: { columns: { latency: new Float64Array([18, 24, 41, 49, 50, 63, 81, 112, 190, 250]) } },
  x: { field: 'latency', label: 'Response time', unit: 'ms' },
  bins: [0, 50, 100, 150, 200, 250],
});
