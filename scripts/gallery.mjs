// Renders one page with every chart type from the built bundle and screenshots it, for a human look at the result.
// Usage: node scripts/gallery.mjs [light|dark] [canvas|svg]   → gallery-<scheme>-<renderer>.png in the scratch directory given by GALLERY_OUT (default: ./.gallery)
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd(), scheme = process.argv[2] ?? 'light', renderer = process.argv[3] ?? 'canvas';
const out = process.env.GALLERY_OUT ?? path.join(root, '.gallery');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1250 }, colorScheme: scheme, timezoneId: 'UTC', locale: 'en-US' });
const logs = [];
page.on('console', m => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
page.on('pageerror', e => logs.push('pageerror: ' + String(e).slice(0, 300)));
await page.setContent(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  :root { color-scheme: light dark; } body { margin: 16px; font: 14px/1.4 system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { display: grid; grid-template-columns: repeat(2, 720px); gap: 20px; } .tile { height: 380px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); padding: 8px; box-sizing: border-box; }
  .kpi { display: flex; gap: 16px; align-items: center; height: 60px } .kpi > div { width: 160px; height: 36px }
</style></head><body><main>
  <div class="tile" id="trend"></div><div class="tile" id="bars"></div>
  <div class="tile" id="area"></div><div class="tile" id="donut"></div>
  <div class="tile" id="scatter"></div><div class="tile" id="dirty"></div>
  <div class="tile" id="hbar"></div><div class="tile"><div class="kpi"><span id="k">Sessions</span><div id="kpi1"></div><div id="kpi2"></div></div><div id="empty" style="height:280px"></div></div>
</main><script src="${base}/packages/axylo/dist/axylo.iife.js"></script></body></html>`);
await page.evaluate(renderer => {
  const A = window.Axylo, r = { __renderer: renderer };
  let s = 7; const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const day = i => new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString().slice(0, 10);
  const mk = (base, g, n, sea) => Array.from({ length: 120 }, (_, i) => Math.round(base + g * i + sea * Math.sin(i / 7 * 2 * Math.PI) + (rnd() - 0.5) * n));
  const ser = { Direct: mk(31000, 120, 4000, 3000), 'Organic search': mk(18000, 60, 3000, 2500), Referral: mk(4200, -8, 1200, 400) };
  for (let i = 60; i < 67; i++) ser.Referral[i] = null;
  const trend = []; for (const [channel, v] of Object.entries(ser)) v.forEach((sessions, i) => trend.push({ day: day(i), channel, sessions }));
  A.line('#trend', { ...r, title: 'Daily sessions by channel', data: trend, x: 'day', y: { field: 'sessions', label: 'Sessions' }, series: 'channel' });
  const teams = ['Billing', 'Customer Success & Onboarding', 'Platform', 'Mobile', 'Data', 'Security', 'Sales Eng.'], sat = [94, 88, 97, 82, 91, 85, 90];
  A.bar('#bars', { ...r, title: 'Customer satisfaction by team', data: teams.map((team, i) => ({ team, satisfied: sat[i] })), x: 'team', y: { field: 'satisfied', label: 'Satisfied', scale: 'percent' }, reference: [{ y: 90, label: 'Target' }] });
  A.area('#area', { ...r, title: 'Sessions, stacked', data: trend, x: 'day', y: { field: 'sessions', label: 'Sessions' }, series: 'channel', stacked: true });
  const br = ['Chrome', 'Safari', 'Edge', 'Firefox', 'Samsung Internet', 'Other'], sh = [46.2, 27.5, 14.1, 8.9, 2.1, 1.2];
  A.donut('#donut', { ...r, title: 'Sessions by browser', data: br.map((browser, i) => ({ browser, share: sh[i] })), label: 'browser', value: { field: 'share', label: 'Share', scale: 'percent' } });
  const pts = Array.from({ length: 400 }, (_, i) => { const size = 10 + rnd() * 990; return { size, latency: 20 + size * 0.08 + (rnd() - 0.5) * 40, region: ['EU', 'US', 'APAC'][i % 3] }; });
  A.scatter('#scatter', { ...r, title: 'Latency by payload size', data: pts, x: { field: 'size', label: 'Payload', unit: 'kB' }, y: { field: 'latency', label: 'Latency', unit: 'ms' }, series: 'region' });
  A.line('#dirty', { ...r, title: 'Dirty input', data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({ d, value: [10, 20, null, NaN, '40', undefined, 70][i] })), x: 'd', y: 'value' });
  A.bar('#hbar', { ...r, title: 'Tickets by team and priority', data: teams.flatMap((team, i) => [{ team, p: 'High', n: 5 + i * 3 }, { team, p: 'Normal', n: 30 - i * 2 }, { team, p: 'Low', n: 12 + (i % 3) * 5 }]), x: 'team', y: { field: 'n', label: 'Tickets' }, series: 'p', layout: 'stacked', horizontal: true });
  A.line('#kpi1', { ...r, compact: true, labelledBy: 'k', data: ser.Direct.map((v, i) => ({ day: day(i), v })), x: 'day', y: 'v' });
  A.bar('#kpi2', { ...r, compact: true, labelledBy: 'k', data: ser.Referral.slice(0, 30).map((v, i) => ({ day: day(i), v })), x: 'day', y: 'v' });
  A.line('#empty', { ...r, title: 'No rows returned', data: [], x: 'day', y: 'sessions' });
}, renderer);
await page.waitForTimeout(700);
const file = path.join(out, `gallery-${scheme}-${renderer}.png`);
await page.screenshot({ path: file, fullPage: true });
console.log(file); console.log(logs.join('\n').slice(0, 1800));
await browser.close(); server.close();
