// Small checks whose results the report quotes; kept so they can be rerun. Output: spot-checks.json
import { chromium } from 'playwright-core';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import { axyloDirectory } from './packed-axylo.mjs';
const out = { date: new Date().toISOString() };
const b = await chromium.launch({ channel: 'chrome', headless: true });
out.chrome = b.version();
const open = async (q, ms = 1800) => { const p = await b.newPage({ viewport: { width: 800, height: 520 } }); await p.goto('http://localhost:4173/?' + q); await p.waitForFunction(() => window.__result); await p.waitForTimeout(ms); return p; };
{ const p = await open('lib=d3&task=trend'); out.webglRenderer = await p.evaluate(() => { const g = document.createElement('canvas').getContext('webgl'); const e = g?.getExtension('WEBGL_debug_renderer_info'); return g ? g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER) : 'no webgl'; }); await p.close(); }
{ const p = await open('lib=echarts-aria&task=trend'); out.echartsAria = await p.evaluate(() => { const c = document.getElementById('chart'); const pick = n => ({ tag: n.tagName, role: n.getAttribute('role'), ariaLabel: n.getAttribute('aria-label')?.slice(0, 400) ?? null }); return [pick(c), ...[...c.querySelectorAll('[role],[aria-label]')].map(pick)]; }); await p.close(); }
{ const p = await open('lib=mui&task=trend'); out.muiTitle = await p.evaluate(() => [...document.querySelectorAll('#chart [aria-label]')].map(n => ({ tag: n.tagName, role: n.getAttribute('role'), ariaLabel: n.getAttribute('aria-label') }))); await p.close(); }
{ const p = await open('lib=recharts&task=trend'); out.rechartsFocusable = await p.evaluate(() => [...document.querySelectorAll('#chart [tabindex]')].map(n => ({ tag: n.tagName, tabindex: n.getAttribute('tabindex'), role: n.getAttribute('role') }))); await p.close(); }
{ const p = await open('lib=recharts&task=parts', 4000); out.rechartsDonutTextAfter4s = await p.evaluate(() => [...document.querySelectorAll('#chart svg text')].map(t => t.textContent)); await p.close(); }
// The table is available by default but its rows are built only when a reader opens it.
{
  const p = await open('lib=axylo&task=trend');
  const table = p.locator('#chart').getByRole('table');
  const closedCount = await table.count();
  await p.getByRole('button', { name: 'View as table', exact: true }).click();
  await table.waitFor();
  out.axyloTable = { closedCount, rows: await table.locator('tbody tr').count(), aria: (await table.ariaSnapshot()).slice(0, 1200) };
  await p.close();
}
// which packages mention the reduced-motion media query anywhere in what they ship
out.reducedMotionMentions = {};
for (const pkg of ['chart.js', 'recharts', 'd3', 'echarts', 'highcharts', 'apexcharts', 'plotly.js-dist-min', '@nivo/core', '@nivo/line', '@react-spring/shared', '@mui/x-charts', 'uplot']) {
  let n = 0; try { n = execSync(`grep -rl "prefers-reduced-motion" node_modules/${pkg} | wc -l`).toString().trim() | 0; } catch {}
  out.reducedMotionMentions[pkg] = n;
}
try {
  const matches = execFileSync('grep', ['-rl', 'prefers-reduced-motion', axyloDirectory], { encoding: 'utf8' });
  out.reducedMotionMentions.axylo = matches.trimEnd().split('\n').length;
} catch (error) {
  if (error.status !== 1) throw error;
  out.reducedMotionMentions.axylo = 0;
}
await b.close();
fs.writeFileSync('spot-checks.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1).slice(0, 2600));
