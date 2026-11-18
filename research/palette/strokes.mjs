// Effective contrast of a 2 px line as Chrome renders it. Antialiasing blends a thin stroke's edge pixels with
// the background, so a line reads lighter (on white) or darker (on dark) than its swatch. For each series color
// this draws a random-walk polyline like a real data line (every angle, sub-pixel positions) at 2 CSS px through
// the 2D canvas and through SVG (rasterized by drawing the SVG into a canvas), at device pixel ratios 1 and 2,
// and reads the pixels back. Per pixel column it derives each pixel's coverage (how far the pixel moved from the
// background toward the stroke color) and reports two colors for the cross-section:
//   core      the most covered pixel (the darkest one on white);
//   weighted  the coverage-weighted mean of the pixels the stroke touches, bg + (Σc² / Σc)(ink − bg), which is
//             what the eye averages when the line is too thin to resolve its edge.
// For each, the 10th percentile and the median contrast over all columns.
//
//   node research/palette/strokes.mjs [--out=research/palette/strokes.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { contrast, srgb, toHex } from './color.mjs';
import { readThemeFile } from './theme-file.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const theme = readThemeFile();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
const result = {
  method: 'random-walk polyline (120 points over 600 CSS px, steps up to ±9 px), stroke width 2, round joins; per pixel column, '
    + 'core = most covered pixel, weighted = coverage-weighted mean of touched pixels (coverage > 0.02); p10 and median over columns',
  chrome: browser.version(), schemes: {},
};

for (const scheme of ['light', 'dark']) {
  const t = theme[scheme], rows = [];
  for (const color of t.series) {
    const columns = await page.evaluate(async ({ color, bg }) => {
      const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      const ink = hex(color), back = hex(bg);
      const ch = [0, 1, 2].reduce((m, i) => (Math.abs(ink[i] - back[i]) > Math.abs(ink[m] - back[m]) ? i : m), 0);
      const Wd = 600, Ht = 140, N = 120;
      let s = 12345; const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      const pts = []; let y = 70.37;
      for (let i = 0; i < N; i++) { y = Math.min(Ht - 12, Math.max(12, y + (r() - 0.5) * 18)); pts.push([10.21 + i * (Wd - 20) / (N - 1), y]); }
      const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(3) + ' ' + p[1].toFixed(3)).join('');
      const out = {};
      for (const dpr of [1, 2]) for (const via of ['canvas', 'svg']) {
        const c = document.createElement('canvas'); c.width = Wd * dpr; c.height = Ht * dpr;
        const g = c.getContext('2d');
        g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
        if (via === 'canvas') {
          g.scale(dpr, dpr); g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round';
          g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        } else {
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Wd * dpr + '" height="' + Ht * dpr + '" viewBox="0 0 ' + Wd + ' ' + Ht + '"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round"/></svg>';
          const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
          g.drawImage(img, 0, 0);
        }
        const px = g.getImageData(0, 0, c.width, c.height).data, cols = [];
        for (let x = 12 * dpr; x < (Wd - 12) * dpr; x++) {
          const cov = [];
          for (let yy = 0; yy < c.height; yy++) { const v = (px[(yy * c.width + x) * 4 + ch] - back[ch]) / (ink[ch] - back[ch]); if (v > 0.02) cov.push(Math.min(1, v)); }
          cols.push(cov);
        }
        out[via + '@' + dpr] = cols;
      }
      return out;
    }, { color, bg: t.background });
    const ink = srgb(color), bg = srgb(t.background);
    const at = k => contrast(toHex(ink.map((v, i) => bg[i] + k * (v - bg[i]))), t.background);
    const stats = xs => { xs.sort((a, b) => a - b); return { p10: +xs[Math.floor(xs.length * 0.1)].toFixed(2), median: +xs[Math.floor(xs.length / 2)].toFixed(2) }; };
    const row = { color, swatch: +contrast(color, t.background).toFixed(2) };
    for (const [k, cols] of Object.entries(columns)) {
      const used = cols.filter(cv => cv.length);
      row[k] = {
        core: stats(used.map(cv => at(Math.max(...cv)))),
        weighted: stats(used.map(cv => at(cv.reduce((a, x) => a + x * x, 0) / cv.reduce((a, x) => a + x, 0)))),
      };
    }
    rows.push(row);
    console.log(scheme, color, JSON.stringify(row));
  }
  result.schemes[scheme] = { background: t.background, rows };
}
await browser.close();
fs.writeFileSync(args.out ?? path.join(here, 'strokes.json'), JSON.stringify(result, null, 1) + '\n');
