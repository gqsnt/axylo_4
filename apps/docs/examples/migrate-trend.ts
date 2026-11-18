import { line } from 'axylo';
import { trend as d } from './_phase1-data';

// Long rows from the fixture's columns. The fixture's x values are epoch milliseconds of UTC
// midnights: `type: 'date'` reads each one as its calendar day, the same in every time zone.
const rows = d.series.flatMap(s => s.values.map((sessions, i) => ({ day: d.t[i]!, channel: s.name, sessions })));

line('#chart', {
  title: d.title,
  data: rows,
  x: { field: 'day', type: 'date' },
  y: { field: 'sessions', label: d.yTitle },
  series: 'channel',
});
