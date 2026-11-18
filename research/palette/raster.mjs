// What a translucent fill becomes on an 8-bit raster in Chrome. For every series color of the shipped palette
// (packages/axylo/src/theme/palette.ts), this fills a rectangle at 25% and at 80% opacity over the scheme's
// background, the way Axylo's renderers do it (2D canvas: globalAlpha; SVG: fill-opacity, rasterized by drawing
// the SVG into a canvas), reads one interior pixel back, and records the bytes. score.mjs folds the record into
// palette.json; the unit test checks the recorded bytes against the palette and the 0.06 neighbour limit, and
// checks that the byte model in color.mjs (rasterFill) predicts every recorded pixel.
//
//   node research/palette/raster.mjs [--out=research/palette/raster.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { readThemeFile } from './theme-file.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const theme = readThemeFile();
const ALPHAS = [0.25, 0.8];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.setContent('<!doctype html><html><body></body></html>');
const record = { chrome: browser.version(), method: 'one 40x40 rectangle per color and opacity over the scheme background; pixel (20, 20) read with getImageData', schemes: {} };
for (const scheme of ['light', 'dark']) {
  const t = theme[scheme];
  const pixels = await page.evaluate(async ({ colors, bg, alphas }) => {
    const out = {};
    for (const via of ['canvas', 'svg']) {
      out[via] = {};
      for (const a of alphas) {
        out[via][a] = [];
        for (const color of colors) {
          const c = document.createElement('canvas'); c.width = 40; c.height = 40;
          const g = c.getContext('2d');
          g.fillStyle = bg; g.fillRect(0, 0, 40, 40);
          if (via === 'canvas') { g.globalAlpha = a; g.fillStyle = color; g.fillRect(0, 0, 40, 40); g.globalAlpha = 1; }
          else {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="' + color + '" fill-opacity="' + a + '"/></svg>';
            const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await img.decode();
            g.drawImage(img, 0, 0);
          }
          const d = g.getImageData(20, 20, 1, 1).data;
          out[via][a].push('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
        }
      }
    }
    return out;
  }, { colors: t.series, bg: t.background, alphas: ALPHAS });
  record.schemes[scheme] = { background: t.background, series: t.series, pixels };
  console.log(scheme, JSON.stringify(pixels));
}
await browser.close();
fs.writeFileSync(args.out ?? path.join(here, 'raster.json'), JSON.stringify(record, null, 1) + '\n');
