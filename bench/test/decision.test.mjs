// Pure tests: the renderer decision of plan 5.1 (review 2, findings 1-3). Synthetic endpoint results for each branch
// and the reviewer's examples; expected outcomes follow the rule text in docs/04-plan-performance.md 5.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, classifyEndpoint } from '../src/stats.js';
import { ENDPOINTS, FAMILY, FAMILY_LEVEL, decideRenderer, assessEndpoint, assessPilot, sessionEligibility, controlBand, environmentKey, endpointById, RENDERERS } from '../src/decision.js';
import { record, timedRuns } from './helpers.mjs';

test('the endpoint table is section 5.1: nine renderer endpoints, declared thresholds, 99.4% intervals', () => {
  assert.deepEqual(FAMILY.map(e => e.id), ['P1', 'P2-100k', 'P3-task', 'P3-late', 'P5', 'P8', 'scatter-50k', 'line-10x100k', 'zoom-100k']);
  assert.ok(Math.abs(FAMILY_LEVEL - 0.99444) < 1e-4);
  const t = id => { const e = endpointById(id); return [e.swi, e.tol]; };
  assert.deepEqual(t('P1'), [1, 0.5]);
  assert.deepEqual(t('P2-100k'), [6, 3]);
  assert.deepEqual(t('P2-1M'), [25, 12.5]);
  assert.deepEqual(t('P3-task'), [0.2, 0.1]);
  assert.deepEqual(t('P4'), [1.7, 0.8]);
  assert.deepEqual(t('P5'), [20, 10]);
  assert.deepEqual(t('P8'), [8, 4]);
  assert.deepEqual(t('P7-mem'), [1_600_000, 800_000]); // 10% and 5% of two 1,000,000-value Float64 columns
  for (const id of ['scatter-50k', 'line-10x100k', 'zoom-100k']) assert.deepEqual(endpointById(id).pilot, { swi: 0.10, tol: 0.05 });
  assert.equal(endpointById('scatter-50k').metric, 'readyFrameMs');
  assert.equal(endpointById('zoom-100k').metric, 'taskMsPerStep');
  assert.equal(endpointById('P7-lifecycle').gate, 0.01);
  assert.ok(ENDPOINTS.every(e => Object.isFrozen(e)));
});

test('the reviewer\'s P1 case: 20 identical pairs at 10.0 against 9.7 ms is "no worthwhile difference", not "better"', () => {
  const runs = timedRuns(20, () => 10.0, () => 9.7);
  const noise = { metrics: { taskMs: { lo: -0.2, hi: 0.2 } } };
  const m = analyze('first', runs, { endpoint: { metric: 'taskMs', swi: 1, tol: 0.5 }, noise, level: FAMILY_LEVEL }).metrics.taskMs;
  assert.equal(m.outcome, 'no worthwhile difference');
  // Against zero alone the same interval is "better": that is what the declared threshold prevents.
  assert.equal(analyze('first', runs).metrics.taskMs.outcome, 'better');
  // Without a calibrated control it is classified but labelled as no verdict.
  assert.match(analyze('first', runs, { endpoint: { metric: 'taskMs', swi: 1, tol: 0.5 } }).metrics.taskMs.outcomeNote, /not a verdict: no calibrated/);
});

test('thresholds are floored at the noise edge; an edge at the tolerance is "too noisy to gate"', () => {
  const c = classifyEndpoint({ lo: -3, hi: -2 }, { swi: 1, tol: 0.5 }, 0.3);
  assert.equal(c.label, 'better');
  assert.equal(classifyEndpoint({ lo: -3, hi: -2 }, { swi: 1, tol: 0.5 }, 0.5).label, 'too noisy to gate');
  // Edge 0.4 < tol: thresholds stay declared. [-1.2, -0.45] is beyond tolerance for A, not a worthwhile B win.
  const d = classifyEndpoint({ lo: -1.2, hi: -0.6 }, { swi: 1, tol: 0.5 }, 0.4);
  assert.equal(d.bWins, false);
  assert.equal(d.aBeyondTol, true);
  assert.equal(classifyEndpoint({ lo: 0.6, hi: 0.9 }, { swi: 1, tol: 0.5 }, null).label, 'worse beyond tolerance, not by the worthwhile margin');
  assert.equal(classifyEndpoint({ lo: -0.4, hi: 0.4 }, { swi: 1, tol: 0.5 }, null).label, 'no worthwhile difference');
  assert.equal(classifyEndpoint({ lo: -1.5, hi: 0.2 }, { swi: 1, tol: 0.5 }, null).label, 'inconclusive');
});

// Synthetic measured results. `d` is the interval of B − A (SVG − Canvas); thresholds as declared or given.
const res = (id, d, extra = {}) => {
  const e = endpointById(id);
  const swi = extra.swi ?? e.swi ?? 1, tol = extra.tol ?? e.tol ?? 0.5;
  if (e.kind === 'late-runs') return { id, endpoint: e, status: 'measured', failed: { A: 0, B: 0 }, late: extra.late ?? { A: 0, B: 0 }, ...extra };
  const classification = classifyEndpoint({ lo: d[0], hi: d[1] }, { swi, tol }, extra.edge ?? 0);
  return { id, endpoint: e, status: 'measured', failed: extra.failed ?? { A: 0, B: 0 }, ci: { lo: d[0], hi: d[1] }, thresholds: classification.thresholds, classification };
};
const allEqual = over => FAMILY.map(e => over[e.id] ?? res(e.id, [-0.01 * (e.swi ?? 1), 0.01 * (e.swi ?? 1)], { swi: e.swi ?? 1, tol: e.tol ?? 0.5 }));

test('rule 1: a renderer worse beyond tolerance somewhere and better nowhere loses', () => {
  // SVG is 15 ms slower on P5 (tolerance 10), equal elsewhere: canvas.
  const d = decideRenderer(allEqual({ P5: res('P5', [12, 18]) }));
  assert.equal(d.kind, 'renderer');
  assert.equal(d.default, 'canvas');
  assert.match(d.rule, /rule 1: svg is worse beyond tolerance on P5/);
});

test('rule 1: a renderer whose runs failed on an endpoint has failed it (worse beyond tolerance), not left a gap', () => {
  const d = decideRenderer(allEqual({ 'P3-task': res('P3-task', [-0.01, 0.01], { failed: { A: 0, B: 2 } }) }));
  assert.equal(d.default, 'canvas');
  assert.match(d.rule, /svg is worse beyond tolerance on P3-task/);
});

test('rule 2: both win somewhere; the default wins more everyday workloads; the other is kept only for a 4x gain', () => {
  // Canvas wins P1 and P5; SVG wins scatter-50k (thresholds frozen at swi 3 ms) by at least 13 ms (> 4 x 3).
  const base = { P1: res('P1', [1.5, 2.5]), P5: res('P5', [25, 40]) };
  const kept = decideRenderer(allEqual({ ...base, 'scatter-50k': res('scatter-50k', [-20, -13], { swi: 3, tol: 1.5 }) }));
  assert.equal(kept.kind, 'renderer-with-kept');
  assert.equal(kept.default, 'canvas');
  assert.deepEqual(kept.kept.map(k => [k.renderer, k.chartType, k.endpoint]), [['svg', 'scatter', 'scatter-50k']]);
  assert.match(kept.rule, /canvas wins 2 everyday workloads \(P1, P5\), svg 0/);
  // A gain of 5 ms (less than 4 x 3) wins the endpoint but does not pay for keeping a second renderer.
  const notKept = decideRenderer(allEqual({ ...base, 'scatter-50k': res('scatter-50k', [-8, -5], { swi: 3, tol: 1.5 }) }));
  assert.equal(notKept.kind, 'renderer');
  assert.equal(notKept.default, 'canvas');
  assert.deepEqual(notKept.kept, []);
});

test('rule 2, P3 as one everyday workload: a renderer with more late runs does not win it', () => {
  // SVG wins P3 task time and P8; canvas wins P1 and P5. SVG had more late runs: P3 is not SVG's, so canvas 2, SVG 1.
  const over = { P1: res('P1', [1.5, 2.5]), P5: res('P5', [25, 40]), P8: res('P8', [-15, -9]), 'P3-task': res('P3-task', [-0.5, -0.3]), 'P3-late': res('P3-late', null, { late: { A: 0, B: 2 } }) };
  const d = decideRenderer(allEqual(over));
  assert.equal(d.default, 'canvas');
  assert.deepEqual(d.everyday, { A: ['P1', 'P5'], B: ['P8'] });
  // With no extra late runs P3 counts for SVG: 2 against 2, so rule 3 applies.
  const tie = decideRenderer(allEqual({ ...over, 'P3-late': res('P3-late', null, { late: { A: 0, B: 0 } }) }), { canvasBytesGzip: 3000 });
  assert.match(tie.rule, /rule 3/);
  assert.equal(tie.default, 'svg');
});

test('rule 3: nothing separates them: SVG stays; canvas is removed only if it costs more than 0.5 KiB gzipped', () => {
  assert.match(decideRenderer(allEqual({}), { canvasBytesGzip: 2048 }).canvas, /removed from the 1\.0 bundle: it costs 2048 B/);
  assert.match(decideRenderer(allEqual({}), { canvasBytesGzip: 400 }).canvas, /kept behind the switch/);
  const open = decideRenderer(allEqual({}));
  assert.equal(open.default, 'svg');
  assert.match(open.canvas, /open: the marginal Canvas size is not measured/);
});

test('too noisy to gate counts for neither side', () => {
  // SVG would lose P5 by 15 ms, but the noise edge (12) reaches the tolerance (10): P5 counts for neither.
  const d = decideRenderer(allEqual({ P5: res('P5', [12, 18], { edge: 12 }) }), { canvasBytesGzip: 100 });
  assert.match(d.rule, /rule 3/);
  assert.equal(d.perEndpoint.P5.tooNoisy, true);
});

test('no decision yet: anything missing, ineligible, uncontrolled, withheld for carry-over or inconclusive is listed', () => {
  const results = allEqual({});
  results[1] = { id: 'P2-100k', endpoint: endpointById('P2-100k'), status: 'carry-over', why: 'AB -6, BA -2' };
  results[4] = { id: 'P5', endpoint: endpointById('P5'), status: 'no-control', why: '1 qualifying A-versus-A sessions' };
  results[0] = res('P1', [-1.5, 0.2]); // straddles the threshold
  const d = decideRenderer(results.filter(r => r.id !== 'zoom-100k'));
  assert.equal(d.kind, 'none');
  assert.deepEqual(d.missing.map(m => m.endpoint).sort(), ['P1', 'P2-100k', 'P5', 'zoom-100k']);
});

// Records for assessEndpoint: an eligible environment, per-block load, controls.
const blocksOf = (n, load = 0.4) => Array.from({ length: n }, (_, block) => ({ block, load1: load }));
const comparison = (runs, extra = {}) => ({ ...record({ runId: 'cmp', workload: 'first', params: { fixture: 'trend' }, baseline: RENDERERS.A.adapter, candidate: RENDERERS.B.adapter, runs, ...extra }), blocks: blocksOf(runs.length / 2), startedAt: '2026-11-19T00:00:00Z' });
const control = (id, adapter, runs, extra = {}) => ({ ...record({ runId: id, mode: 'aa', workload: 'first', params: { fixture: 'trend' }, baseline: adapter, candidate: adapter, runs, ...extra }), blocks: blocksOf(runs.length / 2) });
const quietAA = k => timedRuns(20, i => 10 + ((i + k) % 3) * 0.05, i => 10 + ((i + k + 1) % 3) * 0.05);
const controlsFor = adapters => adapters.flatMap(a => [0, 1, 2].map(k => control(`aa-${a}-${k}`, a, quietAA(k))));
const P1 = endpointById('P1');

test('a session counts only with load under 1.0 at the start of every block and one Chrome version', () => {
  const ok = comparison(timedRuns(20, () => 10, () => 10));
  assert.equal(sessionEligibility(ok).eligible, true);
  const busy = { ...ok, blocks: ok.blocks.map(b => (b.block === 7 ? { ...b, load1: 6.8 } : b)) };
  assert.match(sessionEligibility(busy).reasons[0], /block 7: one-minute load 6\.8/);
  const twoChromes = { ...ok, runs: ok.runs.map((r, i) => ({ ...r, chromeVersion: i ? '157.0' : '158.0' })) };
  assert.match(sessionEligibility(twoChromes).reasons.join(), /Chrome versions in the session: 157\.0, 158\.0/);
  assert.match(sessionEligibility({ ...ok, blocks: undefined }).reasons[0], /no per-block load/);
  const at = hz => ({ ...ok, environment: { ...ok.environment, page: { refresh: { hz } } } });
  assert.notEqual(environmentKey(at(59.94)), environmentKey(at(120)), 'a 120 Hz session is another environment');
  assert.equal(environmentKey(at(59.94)), environmentKey(at(60.02)));
  assert.equal(assessEndpoint(P1, { record: busy, controls: controlsFor(['axylo-canvas', 'axylo-svg']) }).status, 'ineligible');
});

test('controls: matched by adapter and counted per metric; the reviewer\'s three uPlot sessions do not calibrate Canvas-SVG', () => {
  const cmp = comparison(timedRuns(20, () => 10, () => 10));
  const env = environmentKey(cmp);
  const uplot = controlBand(P1, 'axylo-canvas', controlsFor(['uplot']), env);
  assert.equal(uplot.calibrated, false);
  assert.ok(uplot.rejected.every(r => r.why.some(w => /adapter uplot/.test(w))));
  // Three sessions of the right adapter, only one with 20 pairs: one qualifying session, not three.
  const thin = [control('aa-c-0', 'axylo-canvas', quietAA(0)), control('aa-c-1', 'axylo-canvas', timedRuns(6, () => 10, () => 10.1)), control('aa-c-2', 'axylo-canvas', timedRuns(6, () => 10, () => 10.1))];
  const t = controlBand(P1, 'axylo-canvas', thin, env);
  assert.equal(t.calibrated, false);
  assert.match(t.why, /^1 qualifying A-versus-A sessions of axylo-canvas for taskMs; 3 needed/);
  assert.equal(controlBand(P1, 'axylo-canvas', controlsFor(['axylo-canvas']), env).calibrated, true);
  assert.equal(assessEndpoint(P1, { record: cmp, controls: controlsFor(['axylo-canvas']) }).status, 'no-control');
});

test('the reviewer\'s carry-over pattern at 20 pairs is withheld, not a win', () => {
  // Every first run takes 10; after A, 4; after B, 12. No renderer effect. AB: -6, BA: -2; aggregate [-4, -4].
  const runs = [];
  for (let b = 0; b < 20; b++) {
    const ab = b % 2 === 0;
    runs.push({ phase: 'timed', block: b, position: ab ? 0 : 1, config: 'A', outcome: 'ok', summary: { taskMs: ab ? 10 : 12 } });
    runs.push({ phase: 'timed', block: b, position: ab ? 1 : 0, config: 'B', outcome: 'ok', summary: { taskMs: ab ? 4 : 10 } });
  }
  assert.equal(analyze('first', runs).metrics.taskMs.outcome, 'better'); // what the old rule said
  const r = assessEndpoint(P1, { record: comparison(runs), controls: controlsFor(['axylo-canvas', 'axylo-svg']) });
  assert.equal(r.status, 'carry-over');
  assert.match(r.why, /AB estimate -6, BA estimate -2/);
  assert.equal(decideRenderer([r]).kind, 'none');
});

test('a measured endpoint with calibrated controls gives the classification at the family level', () => {
  const r = assessEndpoint(P1, { record: comparison(timedRuns(20, k => 10 + (k % 3) * 0.1, k => 7 + (k % 3) * 0.1)), controls: controlsFor(['axylo-canvas', 'axylo-svg']) });
  assert.equal(r.status, 'measured');
  assert.equal(r.ci.level, FAMILY_LEVEL);
  assert.equal(r.classification.label, 'better');
  const failed = timedRuns(20, () => 10, () => 10);
  failed[5] = { ...failed[5], outcome: 'incomplete', summary: undefined };
  const f = assessEndpoint(P1, { record: comparison(failed), controls: controlsFor(['axylo-canvas', 'axylo-svg']) });
  assert.deepEqual(f.failed, { A: 0, B: 1 });
});

test('the pilot freezes budget-less thresholds at 10% and 5% of the slower median and checks order agreement', () => {
  const e = endpointById('zoom-100k');
  const rec = { runId: 'pilot', runs: timedRuns(10, () => 40, () => 50, 'taskMsPerStep'), design: {} };
  const p = assessPilot(e, rec, 1);
  assert.equal(p.frozen.swi, 5);
  assert.equal(p.frozen.tol, 2.5);
  assert.equal(p.isolate, false);
  assert.equal(assessPilot(e, rec, null).isolate, 'unknown: no calibrated control yet');
});

test('raster label: "gpu" only for a hardware WebGL renderer with accelerated 2D canvas and rasterization', async () => {
  const { rasterLabel } = await import('../lib/driver.mjs');
  const gpu = { webglRenderer: 'ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 2060 SUPER/PCIe/SSE2, OpenGL ES 3.2)', featureStatus: { '2d_canvas': 'enabled', rasterization: 'enabled', gpu_compositing: 'enabled' } };
  const sw = { webglRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', featureStatus: { '2d_canvas': 'unavailable_software', rasterization: 'disabled_software' } };
  assert.equal(rasterLabel(gpu, true).mode, 'gpu');
  assert.equal(rasterLabel(gpu, true).refused, null);
  assert.equal(rasterLabel(sw, false).mode, 'software');
  assert.match(rasterLabel(sw, true).refused, /GPU mode requested, but the browser reports WebGL "ANGLE \(Google, Vulkan 1\.3\.0 \(SwiftShader/);
  // A hardware renderer string with software canvas is not a GPU run either.
  assert.equal(rasterLabel({ ...gpu, featureStatus: { '2d_canvas': 'unavailable_software', rasterization: 'enabled' } }, true).mode, 'software');
});

test('GPU and software sessions are different environments; each family takes only its own', () => {
  const runs = timedRuns(20, () => 10, () => 10);
  const sw = comparison(runs);
  const gpuRec = { ...sw, environment: { ...sw.environment, raster: { mode: 'gpu' } } };
  assert.notEqual(environmentKey(sw), environmentKey(gpuRec));
  // A GPU session offered to the software family's P1 is refused.
  assert.match(assessEndpoint(P1, { record: { ...gpuRec, environment: { ...gpuRec.environment } }, controls: controlsFor(['axylo-canvas', 'axylo-svg']) }).why, /raster gpu; the renderer family is measured with software rasterization/);
  // The gpu family refuses a record without a raster record.
  const e = endpointById('gpu-dpr2-P1');
  assert.match(assessEndpoint(e, { record: { ...sw, design: { ...sw.design, dpr: 2 } } }).why, /no raster record/);
});

test('the gpu family: eight endpoints at 99.375%, same rule; a resize is won only without more late runs', async () => {
  const { FAMILIES, levelOf } = await import('../src/decision.js');
  assert.equal(FAMILIES.gpu.endpoints.length, 8);
  assert.ok(Math.abs(levelOf('gpu') - 0.99375) < 1e-9);
  const gres = (id, d, extra = {}) => res(id, d, extra);
  const equal = over => FAMILIES.gpu.endpoints.map(e => over[e.id] ?? gres(e.id, [-0.01 * (e.swi ?? 1), 0.01 * (e.swi ?? 1)], { swi: e.swi ?? 1, tol: e.tol ?? 0.5 }));
  // SVG is 3 ms slower at DPR 2 on P1 (tolerance 0.5) and better nowhere: canvas, rule 1.
  const r1 = decideRenderer(equal({ 'gpu-dpr2-P1': gres('gpu-dpr2-P1', [2, 4]) }), { family: 'gpu' });
  assert.equal(r1.default, 'canvas');
  assert.equal(r1.family, 'gpu');
  // Canvas wins the 100k resize task time but had more late runs; SVG wins DPR 2 P5: SVG 1 everyday, canvas 0.
  const r2 = decideRenderer(equal({
    'gpu-resize-100k': gres('gpu-resize-100k', [30, 60], { swi: 10, tol: 5 }),
    'gpu-resize-100k-late': gres('gpu-resize-100k-late', null, { late: { A: 3, B: 0 } }),
    'gpu-dpr2-P5': gres('gpu-dpr2-P5', [-40, -25]),
  }), { family: 'gpu', canvasBytesGzip: 2276 });
  assert.equal(r2.default, 'svg');
  assert.deepEqual(r2.everyday, { A: [], B: ['dpr2-P5'] });
});
