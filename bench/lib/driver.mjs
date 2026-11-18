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
  // /axylo/ is the snapshot build.mjs took of packages/axylo/dist (inside DIST).
  const roots = { '/': DIST };
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
    axyloBundles: {
      'axylo.iife.min.js': { sha256: fileHash(path.join(DIST, 'axylo/axylo.iife.min.js')), role: 'production build (__DEV__ = false), snapshot of packages/axylo/dist taken by bench/build.mjs; used by the axylo adapters by default' },
      'axylo.iife.js': { sha256: fileHash(path.join(DIST, 'axylo/axylo.iife.js')), role: 'development build (__DEV__ = true), same snapshot; used only with build=dev' },
      gitStatusOfLibrarySources: (() => { try { return execFileSync('git', ['status', '--short', 'packages/axylo/src'], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'clean'; } catch { return 'not available'; } })(),
    },
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
  if (!Array.isArray(result.describe)) return { admitted: false, reasons: ['no readback'] };
  const exp = expectedFor(spec.workload, spec.params);
  if (result.checksum !== exp.checksum) return { admitted: false, reasons: [`page fixture checksum ${result.checksum} differs from the runner's ${exp.checksum}`] };
  const view = checkViews(exp.views, result.describe);
  // Workload-specific end states, checked in the page: the marks changed color (theme), the charts follow their
  // container's width (resize).
  const extra = [...(result.themeCheck && !result.themeCheck.ok ? result.themeCheck.reasons.map(r => `theme: ${r}`) : []),
    ...(result.resizeCheck && !result.resizeCheck.ok ? result.resizeCheck.reasons.map(r => `resize: ${r}`) : [])];
  return { admitted: view.admitted && extra.length === 0, reasons: [...view.reasons, ...extra] };
}

const DURATIONS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'DevToolsCommandDuration', 'V8CompileDuration', 'TaskOtherDuration', 'ThreadTime'];
const COUNTS = ['LayoutCount', 'RecalcStyleCount', 'Nodes', 'JSEventListeners', 'JSHeapUsedSize', 'JSHeapTotalSize'];

/** Every "<name>:start" / "<name>:end" snapshot pair -> metric deltas, keyed "<name>:start-><name>:end". */
function deltas(snaps, cpu, pagePid, gpuPid) {
  const out = {};
  for (const from of Object.keys(snaps)) {
    if (!from.endsWith(':start')) continue;
    const to = `${from.slice(0, -6)}:end`;
    if (!snaps[to]) continue;
    const d = {};
    for (const k of [...DURATIONS, ...COUNTS]) if (k in snaps[from] && k in snaps[to]) d[k] = snaps[to][k] - snaps[from][k];
    d.endNodes = snaps[to].Nodes;
    d.endJSHeapUsedSize = snaps[to].JSHeapUsedSize;
    // CPU time of whole processes (all threads), from the browser: the page's renderer and the GPU process.
    const c0 = cpu[from], c1 = cpu[to];
    if (c0 && c1) {
      if (pagePid && pagePid in c0 && pagePid in c1) d.rendererCpu = c1[pagePid] - c0[pagePid];
      if (gpuPid && gpuPid in c0 && gpuPid in c1) d.gpuCpu = c1[gpuPid] - c0[gpuPid];
    }
    out[`${from}->${to}`] = d;
  }
  return out;
}

/** Linux only: proportional set size and resident size of a process, in bytes, from /proc. */
function procMemory(pid) {
  try {
    const t = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const kb = name => Number((new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(t) ?? [])[1]) * 1024;
    return { pss: kb('Pss'), rss: kb('Rss') };
  } catch (e) { return { na: `not available: ${e.code ?? e.message}` }; }
}

/**
 * One run in a fresh context. Returns { outcome, ... } where outcome is one of
 * ok | not-admitted | not-available | error | timeout | crash.
 * spec: { adapter, adapterParams?, workload, params, settleMs, timeoutMs, dpr?, profile?: { file } }
 */
export async function runOnce(browser, base, spec) {
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: spec.dpr ?? 1, timezoneId: 'UTC', locale: 'en-US' });
  const logs = [], pageErrors = [], snaps = {}, cpu = {}, mem = {};
  let settle;
  const finished = new Promise(r => { settle = r; });
  let timer, bcdp;
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    bcdp = await browser.newBrowserCDPSession();
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    const processes = async () => (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
    const cpuSample = async label => { cpu[label] = Object.fromEntries((await processes()).map(p => [p.id, p.cpuTime])); };
    let profiling = false;
    await page.exposeBinding('__benchMetrics', async (_src, label) => {
      // Order keeps the browser-side process sample outside the window: before the start, after the end.
      if (label.endsWith(':start')) await cpuSample(label);
      if (spec.profile && label === 'create:end' && profiling) { const { profile } = await cdp.send('Profiler.stop'); fs.writeFileSync(spec.profile.file, JSON.stringify(profile)); profiling = false; }
      const { metrics } = await cdp.send('Performance.getMetrics');
      snaps[label] = Object.fromEntries(metrics.map(m => [m.name, m.value]));
      if (label.endsWith(':end')) await cpuSample(label);
      if (spec.profile && label === 'create:start') {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: spec.profile.intervalUs ?? 100 });
        await cdp.send('Profiler.start');
        profiling = true;
      }
    });
    await page.exposeBinding('__benchMemory', async (_src, label) => {
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const procs = await processes();
      mem[label] = {
        heap,
        processes: procs.filter(p => p.type === 'renderer' || p.type === 'GPU').map(p => ({ pid: p.id, type: p.type, cpuTime: p.cpuTime, ...procMemory(p.id) })),
      };
    });
    await page.exposeBinding('__benchDone', (_src, result) => settle({ kind: 'done', result }));
    page.on('crash', () => settle({ kind: 'crash' }));
    page.on('pageerror', e => pageErrors.push(String(e?.stack ?? e).slice(0, 600)));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    timer = setTimeout(() => settle({ kind: 'timeout' }), spec.timeoutMs);
    const q = new URLSearchParams({ adapter: spec.adapter, workload: spec.workload, params: JSON.stringify(spec.params), settle: String(spec.settleMs), aparams: JSON.stringify(spec.adapterParams ?? {}) });
    page.goto(`${base}?${q}`).catch(e => settle({ kind: 'error', error: `navigation: ${e.message}` }));
    // Test hook only (test/admission.test.mjs): crash the renderer to check that a crash is its own outcome.
    if (spec.testCrashAfterMs) setTimeout(() => cdp.send('Page.crash').catch(() => {}), spec.testCrashAfterMs);
    const end = await finished;
    const rec = { adapter: spec.adapter, adapterParams: spec.adapterParams ?? {}, durationMs: Date.now() - started, logs: logs.slice(0, 20), pageErrors: pageErrors.slice(0, 10) };
    if (end.kind === 'timeout') return { ...rec, outcome: 'timeout', reason: `no result within ${spec.timeoutMs} ms`, snapshots: Object.keys(snaps) };
    if (end.kind === 'crash') return { ...rec, outcome: 'crash', reason: 'renderer process crashed' };
    if (end.kind === 'error') return { ...rec, outcome: 'error', error: end.error };
    const result = end.result;
    if (result.outcome !== 'ok') return { ...rec, outcome: result.outcome, reason: result.reason, error: result.error, result: { env: result.env, adapter: result.adapter } };
    if (pageErrors.length) return { ...rec, outcome: 'error', error: `uncaught page error(s): ${pageErrors[0]}`, result: { env: result.env, adapter: result.adapter } };

    // The page's renderer is the renderer process that used the most CPU time over the run (the context may also
    // hold Chrome's initial and spare renderers); the GPU process is the one process of that type.
    const labels = Object.keys(cpu);
    let pagePid = null, gpuPid = null;
    const finalProcs = await processes();
    gpuPid = finalProcs.find(p => p.type === 'GPU')?.id ?? null;
    if (labels.length >= 2) {
      const first = cpu[labels[0]], last = cpu[labels[labels.length - 1]];
      let best = -1;
      for (const p of finalProcs) if (p.type === 'renderer' && p.id in first && p.id in last && last[p.id] - first[p.id] > best) { best = last[p.id] - first[p.id]; pagePid = p.id; }
    }
    const memory = Object.keys(mem).length ? {
      pagePid, gpuPid,
      samples: Object.fromEntries(Object.entries(mem).map(([label, m]) => [label, {
        heapUsed: m.heap.usedSize, heapTotal: m.heap.totalSize, embedderHeapUsed: m.heap.embedderHeapUsedSize, backingStorage: m.heap.backingStorageSize,
        renderer: m.processes.find(p => p.pid === pagePid) ?? { na: 'not available: page renderer not identified' },
        gpu: m.processes.find(p => p.pid === gpuPid) ?? { na: 'not available: no GPU process' },
        otherRenderers: m.processes.filter(p => p.type === 'renderer' && p.pid !== pagePid).map(p => ({ pid: p.pid, pss: p.pss })),
      }])),
    } : null;

    const admission = admit(spec, result, result.adapter.floor);
    const run = { ...rec, outcome: admission.admitted ? 'ok' : 'not-admitted', admission, result, deltas: deltas(snaps, cpu, pagePid, gpuPid), memory };
    if (!admission.admitted) {
      // A timing that failed admission is not kept; only what the chart reported and why it was rejected.
      run.reason = admission.reasons.slice(0, 5).join('; ');
      delete run.deltas;
      delete run.memory;
      run.result = { env: result.env, adapter: result.adapter, checksum: result.checksum, describe: result.describe, themeCheck: result.themeCheck, resizeCheck: result.resizeCheck };
    }
    return run;
  } catch (e) {
    return { adapter: spec.adapter, outcome: 'error', error: String(e?.stack ?? e).slice(0, 1000), durationMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
    await bcdp?.detach().catch(() => {});
    await ctx.close().catch(() => {});
  }
}
