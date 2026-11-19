// Prints the Markdown tables used in docs/01-landscape.md from the collected JSON.
import fs from 'node:fs';
const J = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const ad = J('adoption/adoption.json').packages, ha = J('adoption/httparchive.json'), cad = J('adoption/cadence.json').packages;
const res = J('harness/results.json'), sizes = J('harness/sizes.json'), pal = J('harness/palette.json');
const M = n => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
const row = a => `| ${a.join(' | ')} |`;
const which = process.argv[2];

if (!which || which === 'adoption') {
  const pick = [['Recharts', 'recharts', 'Recharts'], ['D3', 'd3', 'D3'], ['Chart.js', 'chart.js', 'Chart.js'], ['visx', '@visx/shape', null], ['Apache ECharts', 'echarts', 'ECharts'], ['Highcharts', 'highcharts', 'Highcharts'],
    ['ApexCharts', 'apexcharts', 'ApexCharts.js'], ['AG Charts', 'ag-charts-community', null], ['Vega-Lite', 'vega-lite', null], ['Nivo', '@nivo/core', null], ['Lightweight Charts', 'lightweight-charts', 'TradingView'],
    ['MUI X Charts', '@mui/x-charts', null], ['Observable Plot', '@observablehq/plot', null], ['uPlot', 'uplot', 'uPlot'], ['Plotly.js', 'plotly.js', 'Plotly'], ['Victory', 'victory', null], ['amCharts 5', '@amcharts/amcharts5', 'amCharts'],
    ['Chartist', 'chartist', null], ['C3', 'c3', null], ['billboard.js', 'billboard.js', null]];
  console.log(row(['Library', 'npm package', 'npm downloads, week of 10–16 Nov 2026', 'npm downloads, 12 months', 'jsDelivr requests, 30 days', 'Origins detected (mobile crawl, Oct 2026)', 'GitHub stars']));
  console.log(row(Array(7).fill('---')));
  for (const [name, p, h] of pick) { const x = ad[p]; const extra = p === 'plotly.js' ? ad['plotly.js-dist-min'] : null;
    console.log(row([name, '`' + p + '`' + (extra ? ' + `-dist-min`' : ''), M(x.weekly + (extra?.weekly ?? 0)), M(x.yearly + (extra?.yearly ?? 0)), M(x.jsdelivrMonthHits + (extra?.jsdelivrMonthHits ?? 0)), h && ha[h] ? ha[h].mobile.toLocaleString('en-US') : 'not fingerprinted', x.gh?.stars ? M(x.gh.stars) : '–'])); }
  console.log('\nALL origins', ha.ALL, '\nfetched', J('adoption/adoption.json').fetchedAt);
  console.log('wrappers', ['react-chartjs-2', 'echarts-for-react', 'highcharts-react-official', 'react-apexcharts', 'vue-chartjs', 'react-plotly.js', 'ng2-charts', 'd3-shape', 'd3-scale', 'Google Charts'].map(p => `${p} ${M(ad[p]?.weekly)}`).join(', '), 'Google Charts origins', ha['Google Charts']);
}
const LIBS = [['chartjs', 'Chart.js', 'chart.js'], ['recharts', 'Recharts', 'recharts'], ['d3', 'D3', 'd3'], ['echarts', 'ECharts', 'echarts'], ['highcharts', 'Highcharts', 'highcharts'], ['apexcharts', 'ApexCharts', 'apexcharts'], ['plotly', 'Plotly.js', 'plotly.js'], ['nivo', 'Nivo', '@nivo/core'], ['mui', 'MUI X Charts', '@mui/x-charts'], ['uplot', 'uPlot', 'uplot'], ['axylo', 'Axylo', 'axylo']];
if (!which || which === 'meta') {
  console.log(row(['Library', 'Version tested', 'Published', 'Stable releases, 12 months', 'Major versions since Nov 2024', 'License', 'Min + gzip for the three tasks', 'Harness lines']));
  console.log(row(Array(8).fill('---')));
  for (const [k, name, p] of LIBS) {
    if (k === 'axylo') {
      const s = sizes[k];
      if (s) console.log(row([name, s.version, '–', '–', '–', s.license, s.gzipKB + ' kB', s.harnessLoc]));
      continue;
    }
    console.log(row([name, cad[p].latest, cad[p].latestDate, cad[p].stableLast12mo, cad[p].majorsLast24mo.join(', ') || 'none', String(ad[p].license).replace(/^https?:.*|SEE LICENSE.*/, 'commercial terms'), sizes[k].gzipKB + ' kB', sizes[k].harnessLoc]));
  }
}
if (!which || which === 'perf') {
  const ms = v => v == null ? '–' : v >= 1000 ? (v / 1000).toFixed(1) + ' s' : Math.round(v) + ' ms';
  const sc = (r, n, k) => { const x = r?.scale?.[n]; return !x ? '–' : x.noResultWithinMs ? 'no result in 45 s' : x.skipped ? 'not run' : x.error ? 'error' : ms(x[k]); };
  console.log(row(['Library and configuration', '10,000 points', '100,000 points', '1,000,000 points', 'Streaming: main-thread time per update', 'Synchronous part of the update call, p95', 'Frame callbacks later than 20 ms (of 300)']));
  console.log(row(Array(7).fill('---')));
  for (const [k, name] of [['noop', 'No chart (measurement floor)'], ...LIBS.map(([k, n]) => [k, n + ', defaults']), ['chartjs-tuned', 'Chart.js, tuned configuration'], ['echarts-tuned', 'ECharts, tuned configuration'], ['recharts-tuned', 'Recharts, tuned configuration'], ['highcharts-tuned', 'Highcharts, Boost module (WebGL, software-rendered here)'], ['plotly-tuned', 'Plotly.js, `scattergl` (WebGL, software-rendered here)']]) {
    const r = res[k]; if (!r?.scale) continue; const s = r.stream ?? {};
    console.log(row([name, sc(r, 10000, 'taskMs'), sc(r, 100000, 'taskMs'), sc(r, 1000000, 'taskMs'), s.taskMsPerUpdate != null ? s.taskMsPerUpdate.toFixed(1) + ' ms' : '–', s.pushP95 != null ? s.pushP95 + ' ms' : '–', s.framesOver20ms ?? '–'])); }
}
if (!which || which === 'palette') {
  console.log(row(['Library', 'Colors of the six slices, in order', 'Distinct', 'Below 3:1 on white', 'Closest pair: normal vision', 'protanopia', 'deuteranopia', 'tritanopia']));
  console.log(row(Array(8).fill('---')));
  for (const [k, name] of LIBS) { const p = pal[k]; if (!p) continue; if (!p.score) { console.log(row([name, k === 'axylo' ? '–' : 'no palette, no donut', '–', '–', '–', '–', '–', '–'])); continue; } const s = p.score;
    console.log(row([name, p.donut6.map(c => '`' + c + '`').join(' '), s.distinct, s.below3to1, ...['normal', 'protan', 'deutan', 'tritan'].map(m => s.minDeltaOK[m].min.toFixed(3))])); }
  console.log('closest pairs:', LIBS.filter(([k]) => pal[k]?.score).map(([k, n]) => `${n} protan ${pal[k].score.minDeltaOK.protan.pair.join('/')} deutan ${pal[k].score.minDeltaOK.deutan.pair.join('/')}`).join('; '));
}
if (!which || which === 'dates') {
  const txt = (l, task, z) => { const x = res[l]?.dates?.[task]?.[z]; if (!x || x.res !== 'ok') return '–'; if (l === 'axylo') return x.readoutTitle ?? '(no date in readout)'; return (x.tooltipForIndex54?.title?.[0] ?? x.hoverText?.find(s => /20\d\d|Feb|Mar|\d\/\d/.test(s)) ?? '(no date in readout)').replace(/ GMT.*/, '').replace(/—.*/, '').replace(/​●.*/, '').replace(/^x: /, '').replace(/^Time/, '').replace(/(am|pm)Direct.*/, '$1').trim(); };
  for (const task of ['trend', 'dates']) { console.log('\n' + (task === 'trend' ? 'Given instants (epoch ms at UTC midnight)' : 'Given date strings'));
    console.log(row(['Library', 'Reader in UTC', 'Los Angeles', 'Kolkata', 'Same day everywhere'])); console.log(row(Array(5).fill('---')));
    for (const [k, name] of LIBS) {
      if (k === 'axylo' && !res[k]?.dates?.[task]) continue;
      const v = ['utc', 'la', 'kolkata'].map(z => txt(k, task, z));
      const day = t => (t.match(/(Feb|Mar) ?\d+|\d+ (Feb|Mar)|\d{4}-\d\d-\d\d|\d+\/\d+\/\d+/) ?? [t])[0];
      const missing = k === 'axylo' && v.some(t => t === '–' || t === '(no date in readout)');
      console.log(row([name, ...v, missing ? '–' : new Set(v.map(day)).size === 1 ? 'yes' : '**no**']));
    } }
}
if (!which || which === 'motion') for (const [k, name] of LIBS) {
  const r = res[k];
  if (k === 'axylo' && !r?.resize && !r?.keyboard) continue;
  console.log(name, r['motion_no-preference'], r.motion_reduce, 'widest graphic after resize', r.resize?.widestGraphic ?? '–', 'tab stops', r.keyboard?.stops.length ?? '–');
}
