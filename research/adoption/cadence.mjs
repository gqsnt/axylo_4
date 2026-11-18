// Release cadence: first-publish date of each major version, and stable releases in the last 12 months.
const pkgs = ['chart.js', 'recharts', 'd3', 'echarts', 'highcharts', 'apexcharts', 'plotly.js', '@nivo/core', '@mui/x-charts', 'uplot'];
const out = {};
for (const p of pkgs) {
  const reg = await (await fetch(`https://registry.npmjs.org/${p.replace('/', '%2F')}`)).json();
  const stable = Object.entries(reg.time).filter(([v]) => /^\d+\.\d+\.\d+$/.test(v)).map(([v, t]) => [v, t.slice(0, 10)]).sort((a, b) => a[1].localeCompare(b[1]));
  const majors = {};
  for (const [v, t] of stable) { const m = v.split('.')[0]; majors[m] ??= t; }
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  out[p] = { latest: reg['dist-tags'].latest, latestDate: reg.time[reg['dist-tags'].latest].slice(0, 10), stableLast12mo: stable.filter(([, t]) => t >= yearAgo).length,
    majorsLast24mo: Object.entries(majors).filter(([, t]) => t >= new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10)).map(([m, t]) => `v${m} ${t}`) };
  console.log(p.padEnd(15), out[p].latest.padEnd(8), out[p].latestDate, String(out[p].stableLast12mo).padStart(3), out[p].majorsLast24mo.join(', '));
}
import('node:fs').then(fs => fs.writeFileSync('cadence.json', JSON.stringify({ fetchedAt: new Date().toISOString(), packages: out }, null, 1)));
