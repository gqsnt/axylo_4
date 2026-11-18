// Sensitivity of the ten-library selection: rank of every candidate on each adoption channel,
// and the top ten each channel alone would pick. Chart-level, general-purpose libraries only
// (D3 is kept because the brief's question is "most widely used"; wrappers and finance-only libraries are flagged).
import fs from 'node:fs';
const ad = JSON.parse(fs.readFileSync(new URL('adoption.json', import.meta.url))).packages;
const ha = JSON.parse(fs.readFileSync(new URL('httparchive.json', import.meta.url)));
const C = [ // name, npm package, HTTP Archive technology name (null = no entry returned), note
  ['Chart.js', 'chart.js', 'Chart.js'], ['Recharts', 'recharts', 'Recharts'], ['D3', 'd3', 'D3', 'toolkit, no chart-level API'], ['ECharts', 'echarts', 'ECharts'],
  ['Highcharts', 'highcharts', 'Highcharts'], ['ApexCharts', 'apexcharts', 'ApexCharts.js'], ['Plotly.js', 'plotly.js', 'Plotly', 'npm = plotly.js + plotly.js-dist-min'],
  ['Nivo', '@nivo/core', null], ['MUI X Charts', '@mui/x-charts', null], ['uPlot', 'uplot', 'uPlot'], ['visx', '@visx/shape', null, 'React primitives, no chart-level API'],
  ['AG Charts', 'ag-charts-community', null], ['Vega-Lite', 'vega-lite', null], ['Observable Plot', '@observablehq/plot', null], ['Lightweight Charts', 'lightweight-charts', 'TradingView', 'financial; detection is the TradingView family'],
  ['Victory', 'victory', null], ['amCharts 5', '@amcharts/amcharts5', 'amCharts', 'detection is the amCharts family, all versions'], ['Chartist', 'chartist', null], ['C3', 'c3', null], ['billboard.js', 'billboard.js', null],
  ['CanvasJS', 'canvasjs', 'CanvasJS', 'commercial; own CDN'], ['FusionCharts', 'fusioncharts', 'FusionCharts', 'commercial'], ['Google Charts', null, 'Google Charts', 'no npm package; loaded from Google'],
];
const rows = C.map(([name, pkg, tech, note]) => ({ name, note: note ?? '',
  npmWeek: pkg ? ad[pkg].weekly + (pkg === 'plotly.js' ? ad['plotly.js-dist-min'].weekly : 0) : null,
  npmYear: pkg ? ad[pkg].yearly + (pkg === 'plotly.js' ? ad['plotly.js-dist-min'].yearly : 0) : null,
  jsdelivr: pkg ? ad[pkg].jsdelivrMonthHits + (pkg === 'plotly.js' ? ad['plotly.js-dist-min'].jsdelivrMonthHits : 0) : null,
  origins: tech && ha[tech] ? ha[tech].mobile : null, stars: pkg ? ad[pkg].gh?.stars ?? null : null }));
const channels = ['npmWeek', 'npmYear', 'jsdelivr', 'origins', 'stars'];
for (const ch of channels) [...rows].filter(r => r[ch] != null).sort((a, b) => b[ch] - a[ch]).forEach((r, i) => { r[ch + 'Rank'] = i + 1; });
const picked = ['Chart.js', 'Recharts', 'D3', 'ECharts', 'Highcharts', 'ApexCharts', 'Plotly.js', 'Nivo', 'MUI X Charts', 'uPlot'];
const rk = (r, ch) => r[ch + 'Rank'] ?? '–';
console.log('| Library | In the ten | npm week | npm 12 mo | jsDelivr | Detected origins | Stars | Note |\n|---|---|---|---|---|---|---|---|');
for (const r of [...rows].sort((a, b) => (a.npmWeekRank ?? 99) - (b.npmWeekRank ?? 99))) console.log(`| ${r.name} | ${picked.includes(r.name) ? 'yes' : ''} | ${rk(r, 'npmWeek')} | ${rk(r, 'npmYear')} | ${rk(r, 'jsdelivr')} | ${rk(r, 'origins')} | ${rk(r, 'stars')} | ${r.note} |`);
console.log();
for (const ch of ['npmYear', 'jsdelivr', 'origins']) { const top = [...rows].filter(r => r[ch] != null).sort((a, b) => b[ch] - a[ch]).slice(0, 10).map(r => r.name); console.log(`top ten by ${ch}: ${top.join(', ')}\n   picked but not in it: ${picked.filter(p => !top.includes(p)).join(', ') || 'none'}\n   in it but not picked: ${top.filter(p => !picked.includes(p)).join(', ') || 'none'}`); }
fs.writeFileSync(new URL('ranks.json', import.meta.url), JSON.stringify(rows, null, 1));
