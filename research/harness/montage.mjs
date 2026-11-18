// Builds one side-by-side sheet per screenshot prefix: node montage.mjs trend bars ...
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const LIBS = ['chartjs', 'recharts', 'd3', 'echarts', 'highcharts', 'apexcharts', 'plotly', 'nivo', 'mui', 'uplot'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const cols = Number(process.env.COLS ?? 2), w = Number(process.env.W ?? 720);
for (const prefix of process.argv.slice(2)) {
  const dark = prefix.startsWith('dark');
  const cells = LIBS.filter(l => fs.existsSync(`shots/${prefix}-${l}.png`)).map(l =>
    `<figure><figcaption>${l}</figcaption><img src="data:image/png;base64,${fs.readFileSync(`shots/${prefix}-${l}.png`).toString('base64')}"></figure>`).join('');
  const page = await browser.newPage({ viewport: { width: cols * (w + 16) + 16, height: 800 } });
  await page.setContent(`<style>body{margin:8px;font:600 15px system-ui;background:${dark ? '#121212' : '#fff'};color:${dark ? '#fff' : '#000'}}main{display:grid;grid-template-columns:repeat(${cols},${w}px);gap:12px 16px}figure{margin:0;border:1px solid #8884}figcaption{padding:2px 6px;background:#8883}img{display:block;max-width:${w}px}</style><main>${cells}</main>`);
  await page.screenshot({ path: `shots/_sheet-${prefix}.png`, fullPage: true });
  await page.close();
}
await browser.close();
