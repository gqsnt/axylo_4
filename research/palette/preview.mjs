// Standalone preview of a light and a dark categorical palette: swatches with hex, contrast and nearest
// neighbour, then mock charts (lines with 3, 5 and 8 series at 2 px, overlapping areas at 25%, stacked areas at
// 80%, a donut with 1 px separators, grouped bars) under normal vision, simulated protanopia, deuteranopia,
// tritanopia (Machado 2009, severity 1.0, as SVG color matrices in linear RGB) and grayscale (WCAG luminance).
// No library build needed. Writes the HTML and, with --shot, a PNG per scheme via playwright-core and system Chrome.
//
//   node research/palette/preview.mjs [--palette=file.json] [--out=dir] [--name=preview] [--shot]
//   node research/palette/preview.mjs --compare=b.json --name=compare --shot     (two palettes, normal vision)
//
// With --shot and one palette it also writes <name>-pixels.json: the donut slice colors read back from each row of
// the PNG, which score.mjs folds into the record.
//
// The palette file is { light: [8 hex], dark: [8 hex] } (a solver candidate works); without one, the colors are
// read from packages/axylo/src/theme/palette.ts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CVD, VISIONS, contrast, labUnder, dist } from './color.mjs';
import { readThemeFile } from './theme-file.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));

const theme = readThemeFile();
const load = file => { const p = JSON.parse(fs.readFileSync(file, 'utf8')); return { light: p.light, dark: p.dark }; };
let palette = { light: theme.light.series, dark: theme.dark.series };
if (args.palette) palette = load(args.palette);
// --compare=b.json renders this palette and b.json one above the other, normal vision only, for a side-by-side look.
const labels = (args.labels ?? 'shipped,candidate B').split(',');
const sets = args.compare ? [{ label: labels[0], palette }, { label: labels[1], palette: load(args.compare) }] : [{ label: null, palette }];
const outDir = path.resolve(args.out ?? here), name = args.name ?? 'preview';

function stats(scheme, palette) {
  const t = theme[scheme], cols = palette[scheme];
  return cols.map((c, i) => {
    const near = Object.fromEntries(VISIONS.map(v => {
      let m = Infinity, k = -1;
      cols.forEach((o, j) => { if (j !== i) { const d = dist(labUnder(c, v), labUnder(o, v)); if (d < m) { m = d; k = j; } } });
      return [v, { d: m, k }];
    }));
    return { hex: c, contrast: contrast(c, t.background), near };
  });
}

function filterDefs() {
  const row = M => `${M[0][0]} ${M[0][1]} ${M[0][2]} 0 0  ${M[1][0]} ${M[1][1]} ${M[1][2]} 0 0  ${M[2][0]} ${M[2][1]} ${M[2][2]} 0 0  0 0 0 1 0`;
  const gray = '0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0';
  return `<svg width="0" height="0" style="position:absolute"><defs>
${['protan', 'deutan', 'tritan'].map(v => `<filter id="f-${v}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${row(CVD[v])}"/></filter>`).join('\n')}
<filter id="f-gray" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${gray}"/></filter>
</defs></svg>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Axylo palette preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; background: #888; }
  .scheme { padding: 14px 16px 10px; width: 1440px; }
  .scheme h1 { font-size: 15px; margin: 0 0 8px; font-weight: 600; }
  .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-bottom: 10px; }
  .sw { display: flex; flex-direction: column; gap: 3px; }
  .chip { height: 34px; border-radius: 4px; }
  .sw code { font: 12px ui-monospace, Menlo, Consolas, monospace; }
  .meta { font-size: 11px; opacity: 0.85; }
  .row { display: grid; grid-template-columns: 88px repeat(7, 1fr); gap: 8px; align-items: center; margin-top: 6px; }
  .row .label { font-weight: 600; font-size: 12px; }
  .cell svg { display: block; width: 100%; height: auto; }
  .heads { display: grid; grid-template-columns: 88px repeat(7, 1fr); gap: 8px; font-size: 11px; opacity: 0.8; }
</style></head><body>
${filterDefs()}
<div id="root"></div>
<script>
const SETS = ${JSON.stringify(sets.map(x => ({ label: x.label, palette: x.palette, stats: { light: stats('light', x.palette), dark: stats('dark', x.palette) } })))};
const THEME = ${JSON.stringify(theme)};
const ALL_ROWS = [['normal', ''], ['protanopia', 'url(#f-protan)'], ['deuteranopia', 'url(#f-deutan)'], ['tritanopia', 'url(#f-tritan)'], ['grayscale', 'url(#f-gray)']];
const VISION_ROWS = SETS.length > 1 ? ALL_ROWS.slice(0, 1) : ALL_ROWS;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const W = 190, H = 120, P = 8;
const svg = (body, t) => '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">'
  + '<rect width="' + W + '" height="' + H + '" fill="' + t.background + '"/>'
  + [0.25, 0.5, 0.75].map(f => '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + (P + f * (H - 2 * P)) + '" y2="' + (P + f * (H - 2 * P)) + '" stroke="' + t.grid + '" stroke-width="1"/>').join('')
  + '<line x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P + 0.5) + '" y2="' + (H - P + 0.5) + '" stroke="' + t.axis + '" stroke-width="1"/>'
  + body + '</svg>';
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'triangle-down', 'star'];
function marker(shape, x, y, c, bg) {
  const r = 3.2, s = 'fill="' + c + '" stroke="' + bg + '" stroke-width="1"';
  switch (shape) {
    case 'circle': return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + s + '/>';
    case 'square': return '<rect x="' + (x - r) + '" y="' + (y - r) + '" width="' + 2 * r + '" height="' + 2 * r + '" ' + s + '/>';
    case 'triangle': return '<path d="M' + x + ' ' + (y - r - 0.6) + 'L' + (x + r + 0.4) + ' ' + (y + r) + 'L' + (x - r - 0.4) + ' ' + (y + r) + 'Z" ' + s + '/>';
    case 'triangle-down': return '<path d="M' + x + ' ' + (y + r + 0.6) + 'L' + (x + r + 0.4) + ' ' + (y - r) + 'L' + (x - r - 0.4) + ' ' + (y - r) + 'Z" ' + s + '/>';
    case 'diamond': return '<path d="M' + x + ' ' + (y - r - 1) + 'L' + (x + r + 1) + ' ' + y + 'L' + x + ' ' + (y + r + 1) + 'L' + (x - r - 1) + ' ' + y + 'Z" ' + s + '/>';
    case 'cross': return '<path d="M' + (x - r) + ' ' + (y - r) + 'L' + (x + r) + ' ' + (y + r) + 'M' + (x + r) + ' ' + (y - r) + 'L' + (x - r) + ' ' + (y + r) + '" stroke="' + c + '" stroke-width="2"/>';
    case 'plus': return '<path d="M' + x + ' ' + (y - r - 0.5) + 'V' + (y + r + 0.5) + 'M' + (x - r - 0.5) + ' ' + y + 'H' + (x + r + 0.5) + '" stroke="' + c + '" stroke-width="2"/>';
    default: { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.5 : r + 1; d += (i ? 'L' : 'M') + (x + rr * Math.cos(a)).toFixed(2) + ' ' + (y + rr * Math.sin(a)).toFixed(2); } return '<path d="' + d + 'Z" ' + s + '/>'; }
  }
}
function walks(n, len, seed) {
  const r = rng(seed); const out = [];
  for (let s = 0; s < n; s++) { let v = 0.2 + 0.6 * r(); const pts = []; for (let i = 0; i < len; i++) { v += (r() - 0.5) * 0.12; v = Math.min(0.95, Math.max(0.05, v)); pts.push(v); } out.push(pts); }
  return out;
}
function lines(n, t, cols) {
  const data = walks(n, 40, 11 + n), X = i => P + i * (W - 2 * P - 6) / 39, Y = v => P + (1 - v) * (H - 2 * P);
  return svg(data.map((pts, s) => '<path d="' + pts.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('') + '" fill="none" stroke="' + cols[s] + '" stroke-width="2" stroke-linejoin="round"/>'
    + marker(SHAPES[s], X(39), Y(pts[39]), cols[s], t.background)).join(''), t);
}
function overlap(t, cols) {
  const data = walks(3, 30, 5), X = i => P + i * (W - 2 * P) / 29, Y = v => P + (1 - v) * (H - 2 * P);
  return svg(data.map((pts, s) => '<path d="M' + X(0) + ' ' + Y(0) + pts.map((v, i) => 'L' + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('') + 'L' + X(29) + ' ' + Y(0) + 'Z" fill="' + cols[s] + '" fill-opacity="0.25"/>'
    + '<path d="' + pts.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('') + '" fill="none" stroke="' + cols[s] + '" stroke-width="2"/>').join(''), t);
}
function stacked(t, cols) {
  const n = 8, len = 30, r = rng(3), vals = [];
  for (let s = 0; s < n; s++) { let v = 0.5 + r(); const a = []; for (let i = 0; i < len; i++) { v = Math.max(0.2, v + (r() - 0.5) * 0.3); a.push(v); } vals.push(a); }
  const tot = Array.from({ length: len }, (_, i) => vals.reduce((a, s) => a + s[i], 0)), max = Math.max(...tot) * 1.05;
  const X = i => P + i * (W - 2 * P) / (len - 1), Y = v => P + (1 - v / max) * (H - 2 * P);
  let lower = Array(len).fill(0), out = '';
  for (let s = 0; s < n; s++) {
    const upper = lower.map((l, i) => l + vals[s][i]);
    out += '<path d="' + upper.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('') + lower.map((v, i) => 'L' + X(len - 1 - i).toFixed(1) + ' ' + Y(lower[len - 1 - i]).toFixed(1)).join('') + 'Z" fill="' + cols[s] + '" fill-opacity="0.8"/>';
    out += '<path d="' + upper.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1)).join('') + '" fill="none" stroke="' + t.background + '" stroke-width="1"/>';
    lower = upper;
  }
  return svg(out, t);
}
function donut(t, cols) {
  const v = [30, 22, 16, 12, 9, 7, 6, 5], tot = v.reduce((a, b) => a + b, 0), cx = W / 2, cy = H / 2, R = 52, r0 = 31;
  let a = -Math.PI / 2, out = '';
  v.forEach((x, i) => {
    const b = a + 2 * Math.PI * x / tot, large = b - a > Math.PI ? 1 : 0, p = (rr, t) => (cx + rr * Math.cos(t)).toFixed(2) + ' ' + (cy + rr * Math.sin(t)).toFixed(2);
    out += '<path d="M' + p(R, a) + 'A' + R + ' ' + R + ' 0 ' + large + ' 1 ' + p(R, b) + 'L' + p(r0, b) + 'A' + r0 + ' ' + r0 + ' 0 ' + large + ' 0 ' + p(r0, a) + 'Z" fill="' + cols[i] + '" stroke="' + t.background + '" stroke-width="1"/>';
    a = b;
  });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg"><rect width="' + W + '" height="' + H + '" fill="' + t.background + '"/>' + out + '</svg>';
}
function bars(t, cols) {
  const r = rng(9), groups = 3, n = 6, gw = (W - 2 * P) / groups, bw = (gw - 10) / n;
  let out = '';
  for (let g = 0; g < groups; g++) for (let s = 0; s < n; s++) { const h = (0.3 + 0.65 * r()) * (H - 2 * P); out += '<rect x="' + (P + g * gw + 5 + s * bw).toFixed(1) + '" y="' + (H - P - h).toFixed(1) + '" width="' + (bw - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + cols[s] + '"/>'; }
  return svg(out, t);
}
const fmt = x => x.toFixed(3);
const root = document.getElementById('root');
for (const scheme of (new URLSearchParams(location.search).get('scheme') || 'light,dark').split(',')) {
  const t = THEME[scheme];
  const ink = scheme === 'light' ? '#1d2129' : '#e6e8ec';
  const el = document.createElement('section'); el.className = 'scheme'; el.id = scheme;
  el.style.background = t.background; el.style.color = ink;
  el.innerHTML = '<h1>' + scheme + ' scheme, background ' + t.background + '</h1>';
  for (const set of SETS) {
    const cols = set.palette[scheme], st = set.stats[scheme];
    el.insertAdjacentHTML('beforeend', (set.label ? '<h1 style="font-size:13px;margin:12px 0 6px">' + set.label + '</h1>' : '')
      + '<div class="swatches">' + st.map((s, i) => '<div class="sw"><div class="chip" style="background:' + s.hex + '"></div><code>' + (i + 1) + ' ' + s.hex + '</code>'
        + '<span class="meta">' + s.contrast.toFixed(2) + ':1 · nearest ' + fmt(s.near.normal.d) + ' (' + (s.near.normal.k + 1) + ')</span>'
        + '<span class="meta">worst CVD ' + fmt(Math.min(s.near.protan.d, s.near.deutan.d, s.near.tritan.d)) + '</span></div>').join('') + '</div>'
      + '<div class="heads"><span></span><span>3 lines, 2 px</span><span>5 lines</span><span>8 lines</span><span>3 areas, 25%</span><span>8 stacked, 80%</span><span>donut, 8 slices</span><span>grouped bars, 6</span></div>');
    for (const [label, filter] of VISION_ROWS) {
      const row = document.createElement('div'); row.className = 'row'; row.dataset.vision = label;
      row.innerHTML = '<span class="label">' + label + '</span>' + [lines(3, t, cols), lines(5, t, cols), lines(8, t, cols), overlap(t, cols), stacked(t, cols), donut(t, cols), bars(t, cols)].map(s => '<div class="cell" style="filter:' + (filter || 'none') + '">' + s + '</div>').join('');
      el.appendChild(row);
    }
  }
  root.appendChild(el);
}
</script></body></html>
`;

fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, `${name}.html`);
fs.writeFileSync(htmlPath, html);
console.log('wrote', htmlPath);

if (args.shot) {
  const pixels = { method: 'one pixel at the middle of each donut slice (radius 41.5 of the 190×120 cell), per vision row, read from the PNG', schemes: {} };
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await page.goto('file://' + htmlPath + '?scheme=' + scheme);
    const box = await page.locator('#' + scheme).boundingBox();
    const png = path.join(outDir, `${name}-${scheme}.png`);
    const buffer = await page.screenshot({ path: png, clip: box });
    console.log('wrote', png);
    if (sets.length === 1) {
      // Read back the middle of every donut slice in every row of the PNG just written, so the record can score
      // the image itself (simulated rows included), not only the rounding model of it.
      pixels.schemes[scheme] = await page.evaluate(async ({ b64, box }) => {
        const values = [30, 22, 16, 12, 9, 7, 6, 5], total = values.reduce((a, v) => a + v, 0);
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const rows = {};
        for (const row of document.querySelectorAll('#' + box.id + ' .row')) {
          const svg = row.querySelectorAll('.cell svg')[5], r = svg.getBoundingClientRect(), k = r.width / 190;
          let a = -Math.PI / 2;
          rows[row.dataset.vision] = values.map(v => {
            const b = a + 2 * Math.PI * v / total, m = (a + b) / 2; a = b;
            const x = Math.round(r.left - box.x + (95 + 41.5 * Math.cos(m)) * k), y = Math.round(r.top - box.y + (60 + 41.5 * Math.sin(m)) * k);
            const d = g.getImageData(x, y, 1, 1).data;
            return '#' + [d[0], d[1], d[2]].map(n => n.toString(16).padStart(2, '0')).join('');
          });
        }
        return rows;
      }, { b64: buffer.toString('base64'), box: { ...box, id: scheme } });
      pixels.schemes[scheme].background = theme[scheme].background;
      pixels.schemes[scheme].series = palette[scheme];
    }
    await page.close();
  }
  await browser.close();
  if (sets.length === 1) {
    const file = path.join(outDir, `${name}-pixels.json`);
    fs.writeFileSync(file, JSON.stringify(pixels, null, 1) + '\n');
    console.log('wrote', file);
  }
}
