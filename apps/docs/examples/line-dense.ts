import { line } from 'axylo';

// 100,000 readings, one per second, as typed columns. The drawing keeps, in every device-pixel column,
// the lowest and highest reading of each run of valid samples, so the one spike at reading 61,234 stays
// visible. Tooltip, keyboard and table read the data itself, so every one of the 100,000 is reachable.
const n = 100_000;
const t = new Float64Array(n);
const load = new Float64Array(n);
const start = Date.UTC(2026, 2, 10, 0, 0, 0);
for (let i = 0; i < n; i++) {
  t[i] = start + i * 1000;
  load[i] = 40 + 10 * Math.sin(i / 3000) + ((i * 7919) % 13) / 2;
}
load[61_234] = 97;

line('#chart', {
  title: 'CPU load, one reading per second',
  data: { columns: { t, load } },
  x: { field: 't', type: 'time', timeZone: 'UTC' },
  y: { field: 'load', label: 'Load', unit: '%' },
});
