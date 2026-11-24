// Browser side of the runner: a file server for sealed artifacts that lives only as long as the calling script,
// system Chrome through Playwright, and one run in a fresh browser context.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { BENCH, REPO, sha256 } from '../build.mjs';
import { workloadData, expectedView, heldColumns, fixtureChecksum, zoomSteps } from '../src/fixtures.js';
import { checkViews } from '../src/admission.js';
import { streamCompletion } from '../src/stats.js';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.map': 'application/json' };

/**
 * Serves sealed artifacts (build.mjs readArtifact manifests), one per slot, at /<slot>/<path>. Only files in the
 * slot's manifest are served, each read whole, hashed and compared with the manifest before a byte goes out; a
 * mismatch is answered with 500 and recorded. `served()` returns, per slot, the hash of every file actually sent.
 */
export function startServer(slots) {
  const served = Object.fromEntries(Object.keys(slots).map(s => [s, {}]));
  const violations = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = /^\/([A-Za-z0-9]+)\/(.*)$/.exec(url.pathname);
    const slot = m && slots[m[1]];
    const rel = m ? decodeURIComponent(m[2]) || 'index.html' : null;
    const entry = slot?.files?.[rel];
    if (!entry || rel === 'manifest.json') { res.writeHead(404); res.end('not found'); return; }
    let bytes;
    try { bytes = fs.readFileSync(path.join(slot.dir, rel)); } catch { res.writeHead(404); res.end('not found'); return; }
    const h = sha256(bytes);
    if (h !== entry.sha256) { violations.push(`${m[1]}/${rel}: served bytes ${h.slice(0, 12)} differ from the manifest ${entry.sha256.slice(0, 12)}`); res.writeHead(500); res.end('artifact changed'); return; }
    served[m[1]][rel] = h;
    res.writeHead(200, { 'content-type': TYPES[path.extname(rel)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(bytes);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    base: `http://127.0.0.1:${server.address().port}/`,
    url: slot => `http://127.0.0.1:${server.address().port}/${slot}/`,
    served: () => JSON.parse(JSON.stringify(served)),
    violations: () => [...violations],
    close: () => new Promise(r => server.close(r)),
  })));
}

/** Flags that let headless Chrome rasterize on this machine's GPU (owner, 2026-11-18). Headed uses the desktop's. */
export const GPU_FLAGS = ['--enable-gpu', '--use-angle=gl', '--ignore-gpu-blocklist'];

export async function launchBrowser({ headed = false, gpu = false } = {}) {
  const args = gpu ? (headed ? ['--ignore-gpu-blocklist'] : GPU_FLAGS) : [];
  // A headed browser needs the desktop session; DISPLAY :0 unless the caller has one.
  const env = headed ? { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } : undefined;
  return chromium.launch({ channel: 'chrome', headless: !headed, args, ...(env ? { env } : {}) });
}

/**
 * What the browser says about rasterization, from a throwaway page and the browser's own report (the data behind
 * chrome://gpu, CDP SystemInfo.getInfo): the WebGL unmasked renderer string, the feature status of 2D canvas,
 * rasterization and compositing, the GPU device. `rasterLabel` turns it into the label a run may carry.
 */
export async function rasterInfo(browser) {
  const info = { webglRenderer: 'not available', featureStatus: null, devices: null, gl: null };
  let ctx;
  try {
    const cdp = await browser.newBrowserCDPSession();
    const { gpu } = await cdp.send('SystemInfo.getInfo');
    info.featureStatus = gpu?.featureStatus ?? null;
    info.devices = (gpu?.devices ?? []).map(d => ({ vendor: d.vendorString || d.vendorId, device: d.deviceString || d.deviceId, driver: d.driverVersion }));
    const aux = gpu?.auxAttributes ?? {};
    info.gl = Object.fromEntries(Object.entries(aux).filter(([k]) => /^(gl|angle|skia|displayType|passthrough)/i.test(k)).map(([k, v]) => [k, String(v).slice(0, 200)]));
    await cdp.detach().catch(() => {});
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    info.webglRenderer = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'not available: no WebGL context';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : `not available: ${gl.getParameter(gl.RENDERER)}`;
    });
  } catch (e) { info.error = String(e?.message ?? e); }
  finally { await ctx?.close().catch(() => {}); }
  return info;
}

/**
 * The raster label of a run or session: "gpu" only when the WebGL renderer is not SwiftShader (or another software
 * rasterizer) and Chrome reports 2D canvas and rasterization hardware-accelerated; else "software". A run asked
 * for GPU that comes out software is refused, never labelled "gpu".
 */
export function rasterLabel(info, requestedGpu) {
  const r = String(info?.webglRenderer ?? '');
  const software = /swiftshader|llvmpipe|software|softpipe/i.test(r) || /^not available/.test(r);
  const fs = info?.featureStatus ?? {};
  const accel = k => typeof fs[k] === 'string' && fs[k].startsWith('enabled');
  const canvas2d = fs['2d_canvas'] ?? 'not reported', rasterization = fs.rasterization ?? 'not reported';
  const mode = !software && accel('2d_canvas') && accel('rasterization') ? 'gpu' : 'software';
  const refused = requestedGpu && mode !== 'gpu' ? `GPU mode requested, but the browser reports WebGL "${r}", 2D canvas "${canvas2d}", rasterization "${rasterization}": not a GPU run` : null;
  return { mode, requested: requestedGpu ? 'gpu' : 'default (software here)', webglRenderer: r, canvas2d, rasterization, gpuCompositing: fs.gpu_compositing ?? 'not reported', refused };
}

const tryRead = (p, fallback) => { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return fallback; } };
const fileHash = p => { try { return sha256(fs.readFileSync(p)); } catch { return 'not available: file missing'; } };

/** The machine and software record (plan 3.2). Per-run page facts (refresh rate, WebGL, pixel ratio) are added per run. */
export function machineRecord(browser, { headed }) {
  const cpus = os.cpus();
  const osRelease = tryRead('/etc/os-release', '').split('\n').find(l => l.startsWith('PRETTY_NAME='))?.slice(13).replace(/"/g, '');
  let runnerHead;
  try { runnerHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { runnerHead = 'not available'; }
  return {
    browser: { name: 'Google Chrome (system, via Playwright channel "chrome")', version: browser.version(), headless: !headed },
    playwright: JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules/playwright-core/package.json'), 'utf8')).version,
    node: process.version,
    host: { hostname: os.hostname(), cpuModel: cpus[0]?.model ?? 'not available', logicalCores: cpus.length },
    cpu: { model: cpus[0]?.model ?? 'not available', logicalCores: cpus.length, governor: tryRead('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor', 'not available: no cpufreq governor file') },
    memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
    os: { type: os.type(), release: os.release(), name: osRelease ?? 'not available', arch: os.arch() },
    loadAverageAtStart: os.loadavg(),
    hostIdle: 'not controlled: other processes (including other agents) may run on this machine during the session',
    power: 'not available: power settings are not read by this harness',
    // The source the measured bytes were built from is in each slot's artifact manifest (hashes.slots.*.source);
    // this is only the checkout the runner itself was started from.
    runnerCheckoutHead: runnerHead,
    lockfiles: { 'bench/package-lock.json': fileHash(path.join(BENCH, 'package-lock.json')), 'package-lock.json': fileHash(path.join(REPO, 'package-lock.json')) },
  };
}

const expectations = new Map();
/** Fixture facts the admission check compares against, computed in Node from the same generator as the page. */
export function expectedFor(workload, params) {
  const key = JSON.stringify([workload, params]);
  if (!expectations.has(key)) {
    const fixtures = workloadData(workload, params);
    const visible = workload === 'zoom' ? zoomSteps(fixtures[0]).at(-1) : null;
    expectations.set(key, { views: fixtures.map(f => expectedView(f, visible)), columns: fixtures.map(heldColumns), checksum: fixtureChecksum(fixtures) });
  }
  return expectations.get(key);
}

/**
 * Admission of one run's result. `requireDrawn`: the run had to capture drawn geometry (the untimed probe runs);
 * in timed runs an adapter whose drawn readback needs capture reports "not-captured", which is allowed there.
 */
export function admit(spec, result, floor, { requireDrawn = false } = {}) {
  if (floor) return { admitted: true, reasons: ['not applicable: measurement floor, draws nothing'], limits: [] };
  if (!Array.isArray(result.describe)) return { admitted: false, reasons: ['no readback'], limits: [] };
  // Release-build sanity runs: the shipped bytes, no hook. Admitted only as a sanity run: the renderer named, marks
  // present, no page error; the limit says it is no timing for an endpoint.
  if (result.describe.length && result.describe.every(d => d?.sanity)) {
    const reasons = [];
    result.describe.forEach((d, i) => {
      if (result.adapter?.expectRenderer && d.renderer.kind !== result.adapter.expectRenderer) reasons.push(`chart ${i}: renderer ${d.renderer.kind}, asked for ${result.adapter.expectRenderer}`);
      if (!d.hasMarks) reasons.push(`chart ${i}: no marks drawn`);
    });
    return { admitted: !reasons.length, reasons, limits: ['release build (shipped bytes, no hook): a sanity run, readiness guessed from two frames; not a timing for any endpoint'], sanity: true };
  }
  const exp = expectedFor(spec.workload, spec.params);
  if (result.checksum !== exp.checksum) return { admitted: false, reasons: [`page fixture checksum ${result.checksum} differs from the runner's ${exp.checksum}`], limits: [] };
  const expectRenderer = result.adapter?.expectRenderer;
  const viewOptions = exp.columns.map(columns => ({ columns, requireDrawn, expectRenderer, library: result.adapter?.library }));
  const view = checkViews(exp.views, result.describe, viewOptions);
  // Workload-specific end states, checked in the page: the marks changed color (theme), the charts follow their
  // container's width (resize), the readout followed the pointer (hover), the final zoom window (zoom).
  const extra = [];
  // Resize probe: the readback at the narrowest width is admitted like the final one (drawn geometry, renderer).
  if (result.intermediateDescribe) {
    const mid = checkViews(exp.views, result.intermediateDescribe, viewOptions);
    for (const r of mid.reasons) extra.push(`at the narrowest width: ${r}`);
  }
  for (const [key, label] of [['themeCheck', 'theme'], ['resizeCheck', 'resize'], ['hoverCheck', 'hover'], ['zoomCheck', 'zoom'], ['lifecycleCheck', 'lifecycle'], ['compactCheck', 'compact']]) {
    const c = result[key];
    if (c && !c.ok) for (const r of c.reasons) extra.push(`${label}: ${r}`);
  }
  return { admitted: view.admitted && extra.length === 0, reasons: [...view.reasons, ...extra], limits: view.limits };
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
 * ok | not-admitted | incomplete | not-available | error | timeout | crash.
 * spec: { adapter, adapterParams?, workload, params, settleMs, timeoutMs, dpr?, slot?, probe?: 'geometry' | 'counters',
 *         profile?: { file } }
 */
export async function runOnce(browser, server, spec) {
  const started = Date.now();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: spec.dpr ?? 1, timezoneId: 'UTC', locale: 'en-US' });
  const logs = [], pageErrors = [], snaps = {}, cpu = {}, mem = {}, profiles = {};
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
    let profiling = null;
    const startProfile = async name => {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: spec.profile.intervalUs ?? 100 });
      await cdp.send('Profiler.start');
      profiling = name;
    };
    const stopProfile = async () => {
      const { profile } = await cdp.send('Profiler.stop');
      profiles[profiling] = profile;
      profiling = null;
    };
    await page.exposeBinding('__benchMetrics', async (_src, label) => {
      // Order keeps the browser-side process sample outside the window: before the start, after the end.
      if (label.endsWith(':start')) await cpuSample(label);
      // Profiled runs split the create window at the ready frame: the active part, then the settle period.
      if (spec.profile && profiling && (label === 'create:ready' || label === 'create:end')) await stopProfile();
      const { metrics } = await cdp.send('Performance.getMetrics');
      snaps[label] = Object.fromEntries(metrics.map(m => [m.name, m.value]));
      if (label.endsWith(':end')) await cpuSample(label);
      if (spec.profile && label === 'create:start') await startProfile('active');
      if (spec.profile && label === 'create:ready') await startProfile('settle');
    });
    await page.exposeBinding('__benchMemory', async (_src, label) => {
      await cdp.send('HeapProfiler.collectGarbage');
      const heap = await cdp.send('Runtime.getHeapUsage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const pm = Object.fromEntries(metrics.map(m => [m.name, m.value]));
      const procs = await processes();
      mem[label] = {
        heap, listeners: pm.JSEventListeners, nodes: pm.Nodes,
        processes: procs.filter(p => p.type === 'renderer' || p.type === 'GPU').map(p => ({ pid: p.id, type: p.type, cpuTime: p.cpuTime, ...procMemory(p.id) })),
      };
    });
    // W-hover: the page asks for a real pointer move (CDP Input.dispatchMouseEvent through Playwright), so the
    // event goes through the browser's input pipeline like a user's.
    await page.exposeBinding('__benchPointer', async (_src, x, y) => { await page.mouse.move(x, y); });
    await page.exposeBinding('__benchDone', (_src, result) => settle({ kind: 'done', result }));
    page.on('crash', () => settle({ kind: 'crash' }));
    page.on('pageerror', e => pageErrors.push(String(e?.stack ?? e).slice(0, 600)));
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
    timer = setTimeout(() => settle({ kind: 'timeout' }), spec.timeoutMs);
    const q = new URLSearchParams({ adapter: spec.adapter, workload: spec.workload, params: JSON.stringify(spec.params), settle: String(spec.settleMs), aparams: JSON.stringify(spec.adapterParams ?? {}), probe: spec.probe ?? '', profile: spec.profile ? '1' : '' });
    page.goto(`${server.url(spec.slot ?? 'A')}index.html?${q}`).catch(e => settle({ kind: 'error', error: `navigation: ${e.message}` }));
    // Test hook only (test/browser): crash the renderer to check that a crash is its own outcome.
    if (spec.testCrashAfterMs) setTimeout(() => cdp.send('Page.crash').catch(() => {}), spec.testCrashAfterMs);
    const end = await finished;
    const rec = { adapter: spec.adapter, adapterParams: spec.adapterParams ?? {}, slot: spec.slot ?? 'A', probe: spec.probe ?? null, durationMs: Date.now() - started, logs: logs.slice(0, 20), pageErrors: pageErrors.slice(0, 10) };
    if (end.kind === 'timeout') return { ...rec, outcome: 'timeout', reason: `no result within ${spec.timeoutMs} ms`, snapshots: Object.keys(snaps) };
    if (end.kind === 'crash') return { ...rec, outcome: 'crash', reason: 'renderer process crashed' };
    if (end.kind === 'error') return { ...rec, outcome: 'error', error: end.error };
    const result = end.result;
    if (result.outcome !== 'ok') return { ...rec, outcome: result.outcome, reason: result.reason, error: result.error, result: { env: result.env, adapter: result.adapter } };
    if (pageErrors.length) return { ...rec, outcome: 'error', error: `uncaught page error(s): ${pageErrors[0]}`, result: { env: result.env, adapter: result.adapter } };
    if (spec.profile) {
      fs.writeFileSync(spec.profile.file, JSON.stringify(profiles.active ?? {}));
      if (profiles.settle) fs.writeFileSync(spec.profile.file.replace(/\.cpuprofile$/, '.settle.cpuprofile'), JSON.stringify(profiles.settle));
    }

    // The page's renderer is the renderer process that used the most CPU time over the run (the context may also
    // hold Chrome's initial and spare renderers); the GPU process is the one process of that type.
    const labels = Object.keys(cpu);
    let pagePid = null;
    const finalProcs = await processes();
    const gpuPid = finalProcs.find(p => p.type === 'GPU')?.id ?? null;
    if (labels.length >= 2) {
      const first = cpu[labels[0]], last = cpu[labels[labels.length - 1]];
      let best = -1;
      for (const p of finalProcs) if (p.type === 'renderer' && p.id in first && p.id in last && last[p.id] - first[p.id] > best) { best = last[p.id] - first[p.id]; pagePid = p.id; }
    }
    const memory = Object.keys(mem).length ? {
      pagePid, gpuPid,
      samples: Object.fromEntries(Object.entries(mem).map(([label, m]) => [label, {
        heapUsed: m.heap.usedSize, heapTotal: m.heap.totalSize, embedderHeapUsed: m.heap.embedderHeapUsedSize,
        backingStorage: Number.isFinite(m.heap.backingStorageSize) ? m.heap.backingStorageSize : null,
        listeners: m.listeners, nodes: m.nodes,
        renderer: m.processes.find(p => p.pid === pagePid) ?? { na: 'not available: page renderer not identified' },
        gpu: m.processes.find(p => p.pid === gpuPid) ?? { na: 'not available: no GPU process' },
        otherRenderers: m.processes.filter(p => p.type === 'renderer' && p.pid !== pagePid).map(p => ({ pid: p.pid, pss: p.pss })),
      }])),
    } : { na: 'memory not sampled in this workload' };

    // An unfinished stream is a failed run, whatever its readback says: the watchdog fired or sequences were never
    // acknowledged, so its per-update cost covers less work than a finished one.
    if (spec.workload === 'stream') {
      const c = streamCompletion(result.stream);
      if (!c.complete) return { ...rec, outcome: 'incomplete', reason: c.reasons.join('; '), result: { env: result.env, adapter: result.adapter, stream: { samples: result.stream?.samples, receivedCount: result.stream?.receivedCount, visibleCount: result.stream?.visibleCount, ended: result.stream?.ended } } };
    }
    const admission = admit(spec, result, result.adapter.floor, { requireDrawn: spec.probe === 'geometry' });
    const run = { ...rec, outcome: admission.admitted ? 'ok' : 'not-admitted', admission, result, deltas: deltas(snaps, cpu, pagePid, gpuPid), memory };
    if (!admission.admitted) {
      // A timing that failed admission is not kept; only what the chart reported and why it was rejected.
      run.reason = admission.reasons.slice(0, 5).join('; ');
      delete run.deltas;
      delete run.memory;
      run.result = { env: result.env, adapter: result.adapter, checksum: result.checksum, describe: result.describe, themeCheck: result.themeCheck, resizeCheck: result.resizeCheck, hoverCheck: result.hoverCheck, hover: result.hover, zoomCheck: result.zoomCheck, compactCheck: result.compactCheck };
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
