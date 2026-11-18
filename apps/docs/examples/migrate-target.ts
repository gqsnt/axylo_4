import { bar } from 'axylo';
import { bars as d } from './_phase1-data';

const rows = d.categories.map((team, i) => ({ team, satisfied: d.values[i]! }));

bar('#chart', {
  title: d.title,
  data: rows,
  x: 'team',
  y: { field: 'satisfied', label: 'Satisfied', scale: 'percent' },
  reference: [{ y: 90, label: 'Target' }],
});
