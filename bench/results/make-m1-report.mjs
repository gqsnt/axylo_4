#!/usr/bin/env node
// Builds the M1 renderer comparison report from the history records listed in bench/results/m1-runs.tsv and the
// profile summaries pinned in PROFILES below. Numbers and provenance come only from those files: nothing is read from
// a build directory or the live checkout, so regenerating later cannot change what the report says about the session.
//   node bench/results/make-m1-report.mjs --out <file>
// The output path is explicit: bench/results/m1-renderer-comparison.md carries edits made after generation (the
// provisional-decision warning), which a regeneration would overwrite.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: cli } = parseArgs({ options: { out: { type: 'string' } } });
if (!cli.out) { console.error('usage: node bench/results/make-m1-report.mjs --out <file>'); process.exit(2); }
const HERE = path.dirname(fileURLToPath(import.meta.url));
// The profiles of the M1 session, by file name; each is checked against the session's bundle hashes below.
const PROFILES = [
  '20261118T025413Z-first-3x120-axylo_renderer_canvas_build_prod', '20261118T025415Z-first-3x120-axylo_renderer_canvas_build_dev',
  '20261118T025417Z-first-3x120-axylo_renderer_svg_build_prod', '20261118T025419Z-first-3x120-axylo_renderer_svg_build_dev',
  '20261118T025421Z-first-1x100000-axylo_renderer_canvas_build_prod', '20261118T025423Z-first-1x100000-axylo_renderer_canvas_build_dev',
  '20261118T025426Z-first-1x100000-axylo_renderer_svg_build_prod', '20261118T025428Z-first-1x100000-axylo_renderer_svg_build_dev',
];
const BENCH = path.resolve(HERE, '..');
const list = fs.readFileSync(path.join(HERE, 'm1-runs.tsv'), 'utf8').trim().split('\n').map(l => l.split('\t'));
const runs = Object.fromEntries(list.map(([label, id]) => {
  const f = path.join(BENCH, 'history', `${id}.json`);
  return [label, fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null];
}));
const ids = Object.fromEntries(list);

const num = (v, d = 2) => (typeof v !== 'number' || !Number.isFinite(v) ? 'n/a' : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(d));
const mib = v => (typeof v !== 'number' || !Number.isFinite(v) ? 'n/a' : `${(v / 2 ** 20).toFixed(2)}`);
const fmtFor = m => (m.unit === 'bytes' ? mib : v => num(v));
const pct = v => (v == null || !Number.isFinite(v) ? 'n/a' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);
const NAMES = { 'axylo-canvas': 'Canvas', 'axylo-svg': 'SVG', uplot: 'uPlot' };

function row(label, metricKey) {
  const r = runs[label];
  if (!r) return `| ${label} | missing | | | | | | |`;
  if (r.analysis?.notCompared) return `| ${NAMES[r.design.baseline]} (A) vs ${NAMES[r.design.candidate]} (B) | not compared: ${r.analysis.notCompared.join('; ').replace(/\|/g, '\\|')} | | | | | | | |`;
  const m = r.analysis?.metrics?.[metricKey];
  if (!m) return `| ${NAMES[r.design.baseline]} → ${NAMES[r.design.candidate]} | ${metricKey}: not recorded | | | | | | |`;
  if (m.na) return `| ${NAMES[r.design.baseline]} → ${NAMES[r.design.candidate]} | ${metricKey} | ${m.na} | | | | | |`;
  const f = fmtFor(m);
  const band = typeof m.noiseBand === 'object' ? `[${f(m.noiseBand.lo)}, ${f(m.noiseBand.hi)}]` : 'none';
  return `| ${NAMES[r.design.baseline]} (A) vs ${NAMES[r.design.candidate]} (B) | ${metricKey}${m.unit === 'bytes' ? ' (MiB)' : m.unit === 'ms' ? ' (ms)' : ` (${m.unit})`} | ${m.pairs}/${r.design.blocks} | ${f(m.medianA)} | ${f(m.medianB)} | ${f(m.diff)} [${f(m.lo)}, ${f(m.hi)}] | ${pct(m.relative)} | **${m.outcome}**${m.outcomeNote ? ' (few pairs)' : ''} | ${band} |`;
}
const HEAD = '| Comparison | Metric | Pairs/blocks | Median A | Median B | B − A [95% CI] | B/A − 1 | Outcome for B | Noise band |\n|---|---|---|---|---|---|---|---|---|';
const table = (labels, metrics) => [HEAD, ...labels.flatMap(l => (runs[l]?.analysis?.notCompared ? [row(l, metrics[0])] : metrics.map(k => row(l, k))))].join('\n');

const out = [];
const first = Object.values(runs).find(Boolean);
const env = first.environment;
const allRuns = Object.values(runs).filter(Boolean);
const loads = allRuns.flatMap(r => [r.environment.loadAverageAtStart?.[0], r.environment.loadAverageAtEnd?.[0]]).filter(Number.isFinite);
const pageEnv = env.page ?? {};
const starts = allRuns.map(r => r.startedAt).sort(), ends = allRuns.map(r => r.finishedAt).filter(Boolean).sort();
// Provenance from the records themselves: every distinct value, with how many records carry it.
const tally = f => { const m = new Map(); for (const r of allRuns) { const k = f(r) ?? 'not recorded'; m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()]; };
const commits = tally(r => r.environment.commit);
const prodHashes = tally(r => r.environment.axyloBundles?.['axylo.iife.min.js']?.sha256);
const devHashes = tally(r => r.environment.axyloBundles?.['axylo.iife.js']?.sha256);
const listTally = (t, f = v => v) => t.map(([k, n]) => `${f(k)} (${n} record${n === 1 ? '' : 's'})`).join('; ');

out.push(`# M1 renderer comparison: Axylo Canvas 2D against SVG

Generated by \`bench/results/make-m1-report.mjs\` from the history records listed in \`bench/results/m1-runs.tsv\`
(session script \`bench/results/m1-session.sh\`). Observations only; this file does not recommend a renderer.

How to read the tables: every comparison runs A and B in randomized balanced blocks (as many AB as BA), a fresh
browser context per run. "Median A / B" are medians of per-run values; "B − A" is the difference of medians with a
paired bootstrap 95% interval over blocks. **Outcome is for B relative to A, and lower is better for every metric**:
in "Canvas (A) vs SVG (B)", *better* means SVG measured lower, *worse* means SVG measured higher. *Inconclusive*
means the interval includes zero (or the noise band); it never means "no difference". Where a noise band is shown,
the interval had to clear it as well as zero; the band is the union of the two A-versus-A intervals (Canvas and SVG)
for that workload, from this session. Workloads without an A-versus-A band are classified against zero only.
Method and metric definitions: \`bench/README.md\`.

## Environment

| | |
|---|---|
| Session | ${starts[0]} to ${ends[ends.length - 1]} (UTC) |
| Browser | ${env.browser.name} ${env.browser.version}, ${env.browser.headless ? 'headless' : 'headed'}; Playwright ${env.playwright}; Node ${env.node} |
| Machine | ${env.cpu.model}, ${env.cpu.logicalCores} logical cores, governor ${env.cpu.governor}, ${env.memoryGiB} GiB; ${env.os.name} (${env.os.type} ${env.os.release}) |
| Load | 1-minute load average between ${Math.min(...loads).toFixed(1)} and ${Math.max(...loads).toFixed(1)} at run starts and ends; other agents were running tests on the machine |
| Display | ${pageEnv.refresh ? `${pageEnv.refresh.hz} Hz observed by the page` : 'n/a'}; viewport 1,440×900; device pixel ratio 1 unless marked dpr 2 |
| WebGL renderer | ${pageEnv.webglRenderer ?? 'n/a'} (software; not used by any configuration measured here) |
| Axylo | production build \`axylo.iife.min.js\` sha256 ${listTally(prodHashes, h => `${String(h).slice(0, 16)}…`)}, with \`__AXYLO_BENCH__\` set; development build \`axylo.iife.js\` sha256 ${listTally(devHashes, h => `${String(h).slice(0, 16)}…`)} (profiles only). The bundles were a snapshot of \`packages/axylo/dist\`; the records do not say when that was built or from which source state, so neither is stated here. Library sources had uncommitted changes when the first record was written: ${String(env.axyloBundles?.gitStatusOfLibrarySources ?? 'n/a').replace(/\n/g, ', ')} |
| Commit | checkout HEAD when each run started, which is not necessarily the source of the bundle: ${listTally(commits, c => String(c).slice(0, 8))} |
| Libraries | uPlot ${env.libraries.uplot}; Axylo ${env.libraries.axylo} |
`);

// Summary of every Canvas-vs-SVG metric, generated from the same records as the tables below.
{
  const cmp = [
    ['W-first 3×120', 'first-3x120-canvas-vs-svg'], ['W-first 1×10,000', 'first-1x10000-canvas-vs-svg'],
    ['W-first 1×100,000', 'first-1x100000-canvas-vs-svg'], ['W-first 1×100,000 gaps', 'first-1x100000gaps-canvas-vs-svg'],
    ['W-first 1×1,000,000', 'first-1x1000000-canvas-vs-svg'], ['W-page', 'page-canvas-vs-svg'], ['W-stream', 'stream-canvas-vs-svg'],
    ['Theme', 'theme-canvas-vs-svg'], ['Resize 1×100,000', 'resize-1x100000-canvas-vs-svg'], ['Resize 24 charts', 'resize-page-canvas-vs-svg'],
    ['W-first 1×100,000 dpr 2', 'dpr2-first-1x100000-canvas-vs-svg'], ['W-page dpr 2', 'dpr2-page-canvas-vs-svg'],
  ];
  out.push(`## Canvas against SVG: every metric with a verdict

Generated list of the Canvas (A) vs SVG (B) comparisons. "SVG lower" = outcome *better* for SVG, "SVG higher" =
*worse*. Metrics whose outcome was inconclusive are counted, not listed; the full tables follow.

| Workload | SVG lower (better) | SVG higher (worse) | Inconclusive |
|---|---|---|---|`);
  for (const [name, label] of cmp) {
    const ms = Object.entries(runs[label]?.analysis?.metrics ?? {});
    const f = (m, k) => `${k} ${fmtFor(m)(m.medianA)} → ${fmtFor(m)(m.medianB)}${m.unit === 'bytes' ? ' MiB' : m.unit === 'ms' ? ' ms' : ''}`;
    const lower = ms.filter(([, m]) => m.outcome === 'better').map(([k, m]) => f(m, k));
    const higher = ms.filter(([, m]) => m.outcome === 'worse').map(([k, m]) => f(m, k));
    const inc = ms.filter(([, m]) => m.outcome === 'inconclusive').length;
    out.push(`| ${name} | ${lower.join('; ') || '–'} | ${higher.join('; ') || '–'} | ${inc}${ms.some(([, m]) => m.outcomeNote) ? ' (fewer than 6 pairs: all inconclusive by rule)' : ''} |`);
  }
  out.push(`
Reading notes: frame timestamps are quantized to 0.1 ms, so frame-interval differences of 0.1 ms or less are
quantization, even where the rule calls them better or worse; process CPU times have a 10 ms resolution. The
A-versus-A bands for \`taskMs\` are wide because a few runs in those sessions were much slower than the rest (the
machine was loaded); the comparisons on those workloads had to clear them.
`);
}

// Noise
out.push(`## Noise bands (A versus A, same session)

| Run | Workload | Metric | Pairs | Median A | Median A' | A' − A [95% CI] |
|---|---|---|---|---|---|---|`);
for (const label of ['aa-canvas-first-100k', 'aa-svg-first-100k', 'aa-canvas-page', 'aa-svg-page']) {
  const r = runs[label];
  if (!r?.analysis?.metrics) { out.push(`| ${label} | missing | | | | | |`); continue; }
  for (const k of ['taskMs', 'readyFrameMs', 'heapChartBytes', 'rendererPssChartBytes']) {
    const m = r.analysis.metrics[k];
    if (!m || m.na) continue;
    const f = fmtFor(m);
    out.push(`| ${NAMES[r.design.baseline]} | ${r.design.workload} ${r.design.params.size}${r.design.workload === 'page' ? ' ×24' : ''} | ${k}${m.unit === 'bytes' ? ' (MiB)' : ' (ms)'} | ${m.pairs} | ${f(m.medianA)} | ${f(m.medianB)} | ${f(m.diff)} [${f(m.lo)}, ${f(m.hi)}] |`);
  }
}
out.push('\nOne session only (the plan asks for bands from at least three sessions).\n');

const sections = [
  ['W-first, 3×120', ['first-3x120-canvas-vs-svg', 'first-3x120-uplot-vs-canvas', 'first-3x120-uplot-vs-svg'], ['taskMs', 'readyFrameMs', 'scriptMs', 'layoutStyleMs']],
  ['W-first, 1×10,000', ['first-1x10000-canvas-vs-svg', 'first-1x10000-uplot-vs-canvas', 'first-1x10000-uplot-vs-svg'], ['taskMs', 'readyFrameMs', 'scriptMs', 'layoutStyleMs']],
  ['W-first, 1×100,000', ['first-1x100000-canvas-vs-svg', 'first-1x100000-uplot-vs-canvas', 'first-1x100000-uplot-vs-svg'], ['taskMs', 'readyFrameMs', 'scriptMs', 'layoutStyleMs']],
  ['W-first, 1×100,000 with 5% missing in runs', ['first-1x100000gaps-canvas-vs-svg', 'first-1x100000gaps-uplot-vs-canvas', 'first-1x100000gaps-uplot-vs-svg'], ['taskMs', 'readyFrameMs']],
  ['W-first, 1×1,000,000 (4 blocks)', ['first-1x1000000-canvas-vs-svg', 'first-1x1000000-uplot-vs-canvas', 'first-1x1000000-uplot-vs-svg'], ['taskMs', 'readyFrameMs']],
  ['W-page, 24 charts of 3×120', ['page-canvas-vs-svg', 'page-uplot-vs-canvas', 'page-uplot-vs-svg'], ['taskMs', 'readyFrameMs', 'scriptMs', 'layoutStyleMs']],
  ['W-stream, 600-point window, 300 samples at 60 Hz from an independent clock', ['stream-canvas-vs-svg', 'stream-uplot-vs-canvas', 'stream-uplot-vs-svg'], ['taskMsPerUpdate', 'delayP95Ms', 'maxBacklog', 'framesOverThreshold', 'frameP99Ms', 'createTaskMs']],
  ['Theme toggle, 3×120, 20 toggles', ['theme-canvas-vs-svg', 'theme-uplot-vs-canvas'], ['taskMsPerToggle', 'taskMsToggleMax', 'canvasCallsPerToggle', 'mutationsPerToggle', 'framesToNewColor']],
  ['Resize 1,200 → 400 → 1,200 px over 2 s, one chart of 1×100,000', ['resize-1x100000-canvas-vs-svg', 'resize-1x100000-uplot-vs-canvas', 'resize-1x100000-uplot-vs-svg'], ['taskMs', 'frameP95Ms', 'frameP99Ms', 'framesOverThreshold', 'frameMaxMs', 'rendererCpuMs', 'gpuCpuMs']],
  ['Resize, 24-chart page', ['resize-page-canvas-vs-svg', 'resize-page-uplot-vs-canvas', 'resize-page-uplot-vs-svg'], ['taskMs', 'frameP95Ms', 'frameP99Ms', 'framesOverThreshold', 'frameMaxMs', 'rendererCpuMs', 'gpuCpuMs']],
];
for (const [title, labels, metrics] of sections) {
  out.push(`## ${title}\n\n${table(labels, metrics)}\n`);
  const bad = labels.flatMap(l => (runs[l]?.runs ?? []).filter(x => x.phase === 'timed' && x.outcome !== 'ok').map(x => `${l} block ${x.block} ${x.ref ?? x.adapter}: ${x.outcome}${x.reason ? ` (${String(x.reason).slice(0, 160)})` : ''}`));
  if (bad.length) out.push(`Runs not paired: ${bad.join('; ')}\n`);
}

out.push(`## Memory

Four figures, never added together. *JS heap* is \`Runtime.getHeapUsage\` used size after \`HeapProfiler.collectGarbage\`,
with the chart minus with only the input data on the page (same run). *Renderer PSS* and *GPU PSS* are the
proportional set sizes of the page's renderer process and of the GPU process from Linux \`/proc/<pid>/smaps_rollup\`
(CDP exposes no per-process memory; the page's renderer is the one that used the most CPU during the run), with the
chart minus with only the data. *Canvas backing (calculated)* is width × height × 4 bytes over the chart canvases in
device pixels; it is arithmetic, not a measurement, and the browser may hold more (double buffers, GPU copies).
All in MiB; medians of per-run values.
`);
for (const [title, labels] of [
  ['dpr 1, W-first 1×100,000', ['first-1x100000-canvas-vs-svg', 'first-1x100000-uplot-vs-canvas', 'first-1x100000-uplot-vs-svg']],
  ['dpr 2, W-first 1×100,000', ['dpr2-first-1x100000-canvas-vs-svg', 'dpr2-first-1x100000-uplot-vs-canvas', 'dpr2-first-1x100000-uplot-vs-svg']],
  ['dpr 1, W-first 3×120', ['first-3x120-canvas-vs-svg', 'first-3x120-uplot-vs-canvas', 'first-3x120-uplot-vs-svg']],
  ['dpr 1, W-page (24 charts)', ['page-canvas-vs-svg', 'page-uplot-vs-canvas', 'page-uplot-vs-svg']],
  ['dpr 2, W-page (24 charts)', ['dpr2-page-canvas-vs-svg', 'dpr2-page-uplot-vs-canvas', 'dpr2-page-uplot-vs-svg']],
]) out.push(`### ${title}\n\n${table(labels, ['heapChartBytes', 'rendererPssChartBytes', 'gpuPssChartBytes', 'canvasBackingBytes', 'domNodes', 'rendererPssBytes', 'gpuPssBytes'])}\n`);
out.push(`Timing at dpr 2 (same runs):\n\n${table(['dpr2-first-1x100000-canvas-vs-svg', 'dpr2-first-1x100000-uplot-vs-canvas', 'dpr2-first-1x100000-uplot-vs-svg', 'dpr2-page-canvas-vs-svg', 'dpr2-page-uplot-vs-canvas', 'dpr2-page-uplot-vs-svg'], ['taskMs'])}\n`);

// Profiles
const profDir = path.join(HERE, 'profiles');
const sessionBundles = new Set([...prodHashes, ...devHashes].map(([h]) => h));
const profs = PROFILES.map(name => {
  const f = path.join(profDir, `${name}.summary.json`);
  if (!fs.existsSync(f)) return null;
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const b = p.environment?.axyloBundles;
  const used = p.adapter?.includes('build=dev') ? b?.['axylo.iife.js']?.sha256 : b?.['axylo.iife.min.js']?.sha256;
  p.bundleMatches = !!used && sessionBundles.has(used);
  return p;
}).filter(Boolean);
out.push(`## CPU profiles

One Chrome CPU profile per renderer and build (CDP \`Profiler\`, 100 µs sampling), from the create call to the end of
the 500 ms settle window, at the two sizes where the uPlot gap was examined (3×120 and 1×100,000). Profiled runs
are slowed by the profiler and are not timings. Each sample is attributed to the deepest Axylo frame on its stack,
and that frame's source module gives the stage (\`bench/lib/profile-summary.mjs\`: data/ → normalize; view/, scale/
→ view; layout/, format/ → layout; scene/, simplify/ → scene; render/ → draw; dom/ → DOM; core/ etc. → orchestration).
Percentages are of busy time (all samples except idle). Raw \`.cpuprofile\` files are next to the summaries in
\`bench/results/profiles/\` and open in Chrome DevTools.
`);
for (const size of ['3x120', '1x100000']) {
  for (const renderer of ['canvas', 'svg']) {
    for (const build of ['dev', 'prod']) {
      const p = profs.find(x => x.params.size === size && x.adapter === `axylo:renderer=${renderer},build=${build}`);
      if (!p) { out.push(`**${size}, ${renderer}, ${build}**: profile missing.\n`); continue; }
      const s = p.summary;
      out.push(`**${size}, ${renderer}, ${build === 'dev' ? 'development build' : 'production build'}** — busy ${num(s.busyMs)} ms (${s.samples} samples); mapping: ${s.mapping}. File \`${p.profileFile}\`.${p.bundleMatches ? '' : ' **Its bundle hash is not one of the session records\' bundles.**'}\n`);
      out.push('| Stage | ms | % of busy |\n|---|---|---|');
      for (const st of s.stages.filter(x => x.k !== '(idle)')) out.push(`| ${st.k} | ${num(st.ms)} | ${st.ofBusy}% |`);
      if (build === 'dev') {
        out.push('\nTop functions (deepest Axylo frame; the line is in the bundle `axylo.iife.js`, not the source file):\n\n| Function @ module:bundle line | ms | % of busy |\n|---|---|---|');
        for (const fn of s.functions.slice(0, 8)) out.push(`| \`${fn.k}\` | ${num(fn.ms)} | ${fn.ofBusy}% |`);
      }
      out.push('');
    }
  }
}
out.push(`The development build runs \`__DEV__\` checks the production build does not, so its stage shares are a guide to
where time goes, not the production split. The production profiles could not be mapped to modules (see "mapping"),
so for them only Axylo's total against garbage collection and native work is shown.
`);

out.push(`## Run ids

All in \`bench/history/<run id>.json\` (raw per-run samples, environment record, admission readback).

| Label | Run id | Status |
|---|---|---|
${list.map(([l, id]) => `| ${l} | \`${id}\` | ${runs[l]?.status ?? 'missing'} |`).join('\n')}

## Limits

- One browser (Chrome stable, headless) on one machine. No Firefox, Safari/WebKit, Edge, phone or throttled profile.
- Headless Chrome here rasterizes WebGL with SwiftShader. No configuration measured here uses WebGL, but GPU raster of
  Canvas 2D and SVG is not measured either: main-thread task time and process CPU times are what was recorded, and the
  GPU process figures come from a headless browser whose raster path may differ from a headed browser with a GPU.
- The machine was under load from other agents' tests during the whole session (load average above). The A-versus-A
  bands are from the same session and show what that noise does to these workloads; they are one session, not three.
- Process CPU times (\`rendererCpuMs\`, \`gpuCpuMs\`) come from \`SystemInfo.getProcessInfo\`, whose resolution here is
  10 ms: useful for the 2 s resize window, too coarse for single charts.
- Readiness comes from Axylo's benchmark hook (\`chart.__bench.ready()\`) and uPlot's draw hook; it is not validated
  against screenshots. The admission check reads back ranges, counts and ends, not pixels (except in the theme
  workload, which samples mark colors).
- Theme: the per-toggle window is fixed (three animation frames plus 50 ms). Frames until the marks changed color
  are measured in four separate untimed toggles. uPlot has no theme mechanism; its marks keep their colors, so it is
  recorded as not admitted for this workload and not compared.
- Memory figures are Linux process figures (PSS), not Chrome task-manager figures, and the canvas figure is calculated.
- 1×1,000,000 used 4 blocks per comparison, fewer than the 8 used elsewhere; stream, resize and dpr 2 comparisons
  against uPlot used 6.
`);

fs.writeFileSync(path.resolve(cli.out), out.join('\n'));
console.log(`wrote ${cli.out} from ${allRuns.length} records and ${profs.length} pinned profiles`);
