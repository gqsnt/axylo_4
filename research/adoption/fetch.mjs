// Collects dated adoption evidence. Run: node fetch.mjs > adoption.json
const pkgs = {
  'chart.js':'chartjs/Chart.js','recharts':'recharts/recharts','d3':'d3/d3','echarts':'apache/echarts',
  'highcharts':'highcharts/highcharts','apexcharts':'apexcharts/apexcharts.js','plotly.js':'plotly/plotly.js',
  'plotly.js-dist-min':null,'uplot':'leeoniya/uPlot','victory':'FormidableLabs/victory','@nivo/core':'plouc/nivo',
  '@visx/shape':'airbnb/visx','@mui/x-charts':'mui/mui-x','lightweight-charts':'tradingview/lightweight-charts',
  'vega-lite':'vega/vega-lite','vega':'vega/vega','@observablehq/plot':'observablehq/plot','@amcharts/amcharts5':'amcharts/amcharts5',
  'ag-charts-community':'ag-grid/ag-charts','chartist':'chartist-js/chartist','c3':'c3js/c3','billboard.js':'naver/billboard.js',
  'react-chartjs-2':'reactchartjs/react-chartjs-2','echarts-for-react':null,'highcharts-react-official':null,'react-apexcharts':null,
  'vue-chartjs':null,'ng2-charts':null,'react-plotly.js':null,'@tremor/react':'tremorlabs/tremor','frappe-charts':'frappe/charts',
  'fusioncharts':null,'@antv/g2':'antvis/G2','@antv/g2plot':null,'d3-scale':null,'d3-shape':null,'canvasjs':null,'@syncfusion/ej2-charts':null,
  '@kendo/kendo-charts':null,'@progress/kendo-charts':null,'devextreme':null,'zingchart':null,'@carbon/charts':'carbon-design-system/carbon-charts',
  'roughviz':null,'chart.xkcd':null,'react-google-charts':null,'@unovis/ts':'f5/unovis','lightningchart':null,'@lcjs/core':null,'scichart':null,
  'layerchart':'techniq/layerchart','@swimlane/ngx-charts':'swimlane/ngx-charts'
};
const j = async (u, h={}) => { try { const r = await fetch(u,{headers:{'user-agent':'adoption-survey-script',...h}}); if(!r.ok) return {error:r.status}; return await r.json(); } catch(e){ return {error:String(e)} } };
const out = { fetchedAt: new Date().toISOString(), packages:{} };
for (const [p, repo] of Object.entries(pkgs)) {
  const enc = p.replace('/','%2F');
  const [wk, yr, reg, jsd] = await Promise.all([
    j(`https://api.npmjs.org/downloads/point/last-week/${p}`),
    j(`https://api.npmjs.org/downloads/point/last-year/${p}`),
    j(`https://registry.npmjs.org/${enc}`),
    j(`https://data.jsdelivr.com/v1/stats/packages/npm/${p}?period=month`),
  ]);
  const latest = reg['dist-tags']?.latest; const v = reg.versions?.[latest] ?? {};
  const times = reg.time ?? {}; const now = Date.now();
  const rel12 = Object.entries(times).filter(([k,t])=>!['created','modified'].includes(k) && !/-/.test(k) && now-Date.parse(t) < 365*864e5).length;
  let gh = null;
  if (repo) { const g = await j(`https://api.github.com/repos/${repo}`); gh = g.error ? g : {stars:g.stargazers_count, openIssues:g.open_issues_count, pushedAt:g.pushed_at, archived:g.archived, license:g.license?.spdx_id}; }
  out.packages[p] = { weekly: wk.downloads, weekRange:[wk.start,wk.end], yearly: yr.downloads, latest, latestPublished: times[latest], created: times.created,
    stableReleasesLast12mo: rel12, license: v.license ?? reg.license, types: !!(v.types||v.typings), deps: Object.keys(v.dependencies??{}).length,
    peerDeps: Object.keys(v.peerDependencies??{}), unpackedSize: v.dist?.unpackedSize, jsdelivrMonthHits: jsd.hits?.total, jsdelivrRank: jsd.hits?.rank, repo, gh };
}
console.log(JSON.stringify(out,null,1));
