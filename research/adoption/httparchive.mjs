// Site-level detections from the HTTP Archive technology report (Wappalyzer fingerprints over the CrUX origin list).
const names = ['ALL','Chart.js','Highcharts','D3','ECharts','ApexCharts.js','ApexCharts','Google Charts','amCharts','Plotly','Plotly.js','Recharts','Chartist.js','Chartist','C3.js','Lightweight Charts','TradingView','uPlot','FusionCharts','CanvasJS','ZingChart','Vega','Vega-Lite','Nivo','Victory','visx','AG Charts','AnyChart','Easy Pie Chart','Morris.js','Flot','jqPlot','NVD3','Rickshaw','Frappe Charts','billboard.js','AntV G2','Observable Plot','MUI','Kendo UI','Syncfusion','DevExtreme','Datawrapper','Flourish','Infogram','Tableau','Power BI'];
const out = {};
for (const t of names) {
  const r = await fetch(`https://cdn.httparchive.org/v1/adoption?technology=${encodeURIComponent(t)}&geo=ALL&rank=ALL&start=latest`,{headers:{'user-agent':'adoption-survey-script'}});
  let j=[]; try { j = await r.json(); } catch {}
  if (j[0]) out[t] = {date:j[0].date, ...j[0].adoption};
}
console.log(JSON.stringify(out,null,1));
