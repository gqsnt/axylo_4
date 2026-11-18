// Extracts the colors each library actually used for the 6-slice donut,
// then scores them: contrast against white (WCAG 1.4.11 asks 3:1 for graphical objects) and
// the smallest pairwise color difference under normal vision and simulated color-vision deficiencies.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIBS = ['chartjs', 'recharts', 'd3', 'echarts', 'highcharts', 'apexcharts', 'plotly', 'nivo', 'mui', 'uplot'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const grab = async (lib, task) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
  await page.goto(`http://localhost:4173/?lib=${lib}&task=${task}`);
  await page.waitForFunction(() => window.__result); await page.waitForTimeout(1800);
  const colors = await page.evaluate(task => {
    const h = window.__handle, el = document.getElementById('chart');
    const norm = c => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; return x.fillStyle; };
    if (h?.chart?.data?.datasets) { const d = h.chart.data.datasets; return (task === 'parts' ? d[0].backgroundColor : d.map(s => s.borderColor)).map(norm); }
    if (h?.chart?.getOption) return h.chart.getOption().color.slice(0, task === 'parts' ? 6 : 3).map(norm); // ECharts draws on canvas: its option palette, in slice order
    if (h?.u) return h.u.series.slice(1).map(s => norm(s._stroke ?? s.stroke(h.u)));
    // SVG: big filled shapes for the donut, long stroked paths for lines; keep first-seen order
    const seen = [];
    for (const p of el.querySelectorAll('svg path, svg circle')) {
      const cs = getComputedStyle(p), b = p.getBBox?.() ?? { width: 0, height: 0 };
      if (p.closest('[class*=legend]')) continue;
      const c = task === 'parts' ? cs.fill : cs.stroke;
      if (!c || c === 'none' || c.includes('rgba(0, 0, 0, 0)')) continue;
      if (/rgba\(/.test(c) || c === 'rgb(255, 255, 255)') continue; // skip translucent overlays and white separators
      if (task === 'parts' ? (p.tagName !== 'path' || b.width < 3 || b.height < 3) : (p.tagName !== 'path' || b.width < 200 || cs.fill !== 'none')) continue;
      seen.push(norm(c)); // keep repeats: two slices with the same fill are a pair with zero difference
    }
    return seen;
  }, task);
  await page.close();
  return colors;
};
// --- color math
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Machado et al. 2009, severity 1.0, applied in linear RGB
const CVD = { normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]] };
const oklab = ([r, g, b]) => { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const sim = (h, M) => oklab(M.map(row => Math.min(1, Math.max(0, row.reduce((a, k, i) => a + k * rgb(h).map(lin)[i], 0)))));
const minDelta = (cols, M) => { let m = Infinity, pair = null; for (let i = 0; i < cols.length; i++) for (let j = i + 1; j < cols.length; j++) { const a = sim(cols[i], M), b = sim(cols[j], M), d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); if (d < m) { m = d; pair = [cols[i], cols[j]]; } } return { min: +m.toFixed(4), pair }; };
const out = {};
for (const lib of LIBS) {
  // the donut has six slices, so this is the library's first six categorical colors (fewer if it repeats)
  const parts = lib === 'uplot' ? [] : (await grab(lib, 'parts')).slice(0, 6);
  const score = cols => cols.length < 2 ? null : { slices: cols.length, distinct: new Set(cols).size, contrastOnWhite: cols.map(c => +contrast(c, '#ffffff').toFixed(2)), below3to1: cols.filter(c => contrast(c, '#ffffff') < 3).length,
    minDeltaOK: Object.fromEntries(Object.entries(CVD).map(([k, M]) => [k, minDelta(cols, M)])) };
  out[lib] = { donut6: parts, score: score(parts) };
  console.log(lib, JSON.stringify(out[lib]));
}
fs.writeFileSync('palette.json', JSON.stringify(out, null, 1));
await browser.close();
