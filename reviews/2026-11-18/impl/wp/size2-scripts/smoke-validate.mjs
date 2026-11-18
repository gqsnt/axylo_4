// Compares validate() output of two production builds on dirty inputs (Node, no DOM).
const [a, b] = process.argv.slice(2);
const A = await import(new URL(`out/${a}/axylo.js`, import.meta.url));
const B = await import(new URL(`out/${b}/axylo.js`, import.meta.url));
const rows = [
  { d: '2026-01-01T00:00:00Z', v: '12', s: 'A', g: 'x' }, { d: '2026-01-03', v: null, s: 'A', g: 'y' }, { d: '2026-01-02', v: 7, s: 'B', g: 'z' },
  { d: 'nope', v: 3, s: 'B', g: 'x' }, { d: '2026-01-04', v: Infinity, s: 'A', g: 'y' }, { d: '2026-01-04', v: 5, s: 'A', g: 'y' },
];
const cases = [
  ['line', { data: rows, x: 'd', y: 'v', series: 's' }], ['line', { data: rows, x: 'd', y: 'vv', tittle: 'x' }],
  ['line', { data: rows, x: { field: 'd', type: 'time', timeZone: 'Mars/Base' }, y: { field: 'v', parse: 'number' }, messages: { viewAsTabel: 'x' } }],
  ['area', { data: rows, x: 'd', y: 'v', series: 's', stacked: true }], ['bar', { data: rows, x: 'g', y: 'v', layout: 'stacked', horizontal: true }],
  ['scatter', { data: rows, x: 'v', y: 'v', series: 's' }], ['scatter', { data: rows, x: 'g', y: 'v' }],
  ['donut', { data: rows, label: 'g', value: 'v' }], ['donut', { data: [{ g: 'a', v: -1 }, { g: 'a', v: 2 }], label: 'g', value: 'v' }],
  ['line', { data: { columns: { d: new Float64Array([3, 1, 2]), v: new Float64Array([1, NaN, 3]) } }, x: 'd', y: 'v', reference: [{ y: 2, label: 'r' }] }],
  ['bar', { data: rows, x: 'd', y: ['v', 'q'], zoom: 'touch', legend: 'side' }],
];
let same = 0;
for (const [k, o] of cases) {
  const x = JSON.stringify(A.validate(k, o)), y = JSON.stringify(B.validate(k, o));
  if (x === y) same++; else console.log('DIFF', k, '\n ', x, '\n ', y);
}
console.log(`${same}/${cases.length} validate outputs identical; codes seen: ${[...new Set(cases.flatMap(([k, o]) => A.validate(k, o).map(d => d.code)))].join(' ')}`);
