import { line } from 'axylo';
import { stream } from './_phase1-data';

const d = stream();
const rows = d.t.map((t, i) => ({ t, value: d.y[i]! }));

const chart = line('#chart', {
  title: d.title,
  data: rows,
  x: { field: 't', type: 'time', timeZone: 'UTC' },
  y: 'value',
});

// One call per new point; the window keeps the latest 600 x values.
setInterval(() => {
  const [t, value] = d.next();
  chart.append([{ t, value }], { keep: 600 });
}, 250);
