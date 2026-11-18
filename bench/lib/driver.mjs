// Browser side of the runner: a file server that lives only as long as the calling script, system Chrome through
// Playwright, and one run in a fresh browser context.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { BENCH, DIST, REPO, sha256 } from '../build.mjs';
import { workloadData, expectedView, checksum } from '../src/fixtures.js';
import { checkViews } from '../src/admission.js';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };

export function startServer() {
  const roots = { '/axylo/': path.join(REPO, 'packages/axylo/dist'), '/': DIST };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = null;
    for (const [prefix, root] of Object.entries(roots)) {
      if (!url.pathname.startsWith(prefix)) continue;
      const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
      const p = path.resolve(root, rel);
      if (p.startsWith(root + path.sep)) file = p;
      break;
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) })));
}

export async function launchBrowser({ headed = false } = {}) {
  return chromium.launch({ channel: 'chrome', headless: !headed });
}

const tryRead = (p, fallback) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return fallback; } };
const fileHash = p => { try { return sha256(fs.readFileSync(p)); } catch { return 'not available: file missing'; } };

/** The machine and software record (plan 3.2). Per-run page facts (refresh rate, WebGL, pixel ratio) are added per run. */
export function machineRecord(browser, { headed }) {
  const cpus = os.cpus();
  let commit;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { commit = 'not available: the checkout is not a git repository (or git failed)'; }
  const osRelease = tryRead('/etc/os-release', '').split('\n').find(l => l.startsWith('PRETTY_NAME='))?.slice(13).replace(/"/g, '');
  const axyloIife = path.join(REPO, 'packages/axylo/dist/axylo.iife.js');
  return {
    browser: { name: 'Google Chrome (system, via Playwright channel "chrome")', version: browser.version(), headless: !headed },
    playwright: JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/playwright-core/package.json'), 'utf8')).version,
    node: process.version,
    cpu: { model: cpus[0]?.model ?? 'not available', logicalCores: cpus.length, governor: tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'not available: no cpufreq governor file') },
    memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
    os: { type: os.type(), release: os.release(), name: osRelease ?? 'not available', arch: os.arch() },
    loadAverageAtStart: os.loadavg(),
    hostIdle: 'not controlled: other processes (including other agents) may run on this machine during the session',
    power: 'not available: power settings are not read by this harness',
    commit,
    lockfiles: { 'bench/package-lock.json': fileHash(path.join(BENCH, 'package-lock.json')), 'package-lock.json': fileHash(path.join(REPO, 'package-lock.json')) },
    axyloBundle: { file: 'packages/axylo/dist/axylo.iife.js', sha256: fileHash(axyloIife), note: 'scripts/build.mjs builds this file with __DEV__=true; the production script-tag build is axylo.iife.min.js' },
  };
}

const expectations = new Map();
/** Fixture facts the admission check compares against, computed in Node from the same generator as the page. */
export function expectedFor(workload, params) {
  const key = JSON.stringify([workload, params]);
  if (!expectations.has(key)) {
    const fixtures = workloadData(workload, params);
    expectations.set(key, { views: fixtures.map(expectedView), checksum: checksum(fixtures) });
  }
  return expectations.get(key);
}

export function admit(spec, result, floor) {
  if (floor) return { admitted: true, reasons: ['not applicable: measurement floor, draws nothing'] };
  const exp = expectedFor(spec.workload, spec.params);
  if (result.checksum !== exp.checksum) return { admitted: false, reasons: [`page fixture checksum ${result.checksum} differs from the runner's ${exp.checksum}`] };
  return checkViews(exp.views, result.describe);
}

const DURATIONS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'DevToolsCommandDuration', 'V8CompileDuration', 'TaskOtherDuration', 'ThreadTime'];
const COUNTS = ['LayoutCount', 'RecalcStyleCount', 'Nodes', 'JSEventListeners', 'JSHeapUsedSize', 'JSHeapTotalSize'];

function deltas(snaps) {
  const out = {};
  for (const [from, to] of [['create:start', 'create:end'], ['stream:start', 'stream:end']]) {
    if (!snaps[from] || !snaps[to]) continue;
    const d = {};
    for (const k of [...DURATIONS, ...COUNTS]) if (k in snaps[from] && k in snaps[to]) d[k] = snaps[to][k] - snaps[from][k];
    d.endNodes = snaps[to].Nodes;
    d.endJSHeapUsedSize = snaps[to].JSHeapUsedSize;
    out[`${from}->${to}`] = d;
  }
  return out;
}

/**
 * One run in a fresh context. Returns { outcome, ... } where outcome is one of
 * ok | not-admitted | not-available | error | timeout | crash.
 */
export async function runOnce(browser, base, spec) {
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: spec.dpr ?? 1, timezoneId: 'UTC', locale: 'en-US' });
  const logs = [], pageErrors = [], snaps = {};
  let settle;
  const finished = new Promise(r => { settle = r; });
  let timer;
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    await page.exposeBinding('__benchMetrics', async (_src, label) => {
      const { metrics } = await cdp.send('Performance.getMetrics');
      snaps[label] = Object.fromEntries(metrics.map(m => [m.name, m.value]));
    });
    await page.exposeBinding('__benchDone', (_src, result) => settle({ kind: 'done', result }));
    page.on('crash', () => settle({ kind: 'crash' }));
    page.on('pageerror', e => pageErrors.push(String(e?.stack ?? e).slice(0, 600)));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    timer = setTimeout(() => settle({ kind: 'timeout' }), spec.timeoutMs);
    const q = new URLSearchParams({ adapter: spec.adapter, workload: spec.workload, params: JSON.stringify(spec.params), settle: String(spec.settleMs) });
    page.goto(`${base}?${q}`).catch(e => settle({ kind: 'error', error: `navigation: ${e.message}` }));
    // Test hook only (test/admission.test.mjs): crash the renderer to check that a crash is its own outcome.
    if (spec.testCrashAfterMs) setTimeout(() => cdp.send('Page.crash').catch(() => {}), spec.testCrashAfterMs);
    const end = await finished;
    const rec = { adapter: spec.adapter, durationMs: Date.now() - started, logs: logs.slice(0, 20), pageErrors: pageErrors.slice(0, 10) };
    if (end.kind === 'timeout') return { ...rec, outcome: 'timeout', reason: `no result within ${spec.timeoutMs} ms`, snapshots: Object.keys(snaps) };
    if (end.kind === 'crash') return { ...rec, outcome: 'crash', reason: 'renderer process crashed' };
    if (end.kind === 'error') return { ...rec, outcome: 'error', error: end.error };
    const result = end.result;
    if (result.outcome !== 'ok') return { ...rec, outcome: result.outcome, reason: result.reason, error: result.error, result: { env: result.env, adapter: result.adapter } };
    if (pageErrors.length) return { ...rec, outcome: 'error', error: `uncaught page error(s): ${pageErrors[0]}`, result: { env: result.env, adapter: result.adapter } };
    const admission = admit(spec, result, result.adapter.floor);
    const run = { ...rec, outcome: admission.admitted ? 'ok' : 'not-admitted', admission, result, deltas: deltas(snaps) };
    if (!admission.admitted) {
      // A timing that failed admission is not kept; only what the chart reported and why it was rejected.
      run.reason = admission.reasons.slice(0, 5).join('; ');
      delete run.deltas;
      run.result = { env: result.env, adapter: result.adapter, checksum: result.checksum, describe: result.describe };
    }
    return run;
  } catch (e) {
    return { adapter: spec.adapter, outcome: 'error', error: String(e?.stack ?? e).slice(0, 1000), durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
    await ctx.close().catch(() => {});
  }
}
