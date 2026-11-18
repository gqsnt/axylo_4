// Feasibility search over wide boxes (decision 0003). fit.mjs's branch and bound is exact but finds nothing in
// reasonable time when the feasible region is small and far from the targets; this script searches the same
// grids (fit.mjs `candidates`) with simulated annealing on the amount of violation, so it can find palettes the
// exact search cannot reach, but it proves nothing. Its output is meant to be polished: a small box around each
// color, solved to completion by fit.mjs (see configs/fit-final.json).
//
// State: one grid color per slot. Score: 100 × total violation + target cost, where violation sums, over every pair
// and vision, how far a difference falls short of its limit (analytic and after byte rounding), and over neighbours
// how far the fills fall short (ideal, and worst case within one byte of the 8-bit model). Moves re-pick one slot.
//
//   node research/palette/anneal.mjs --config=configs/x.json [--scheme=light] [--light=#…,…] [--seed=1] [--seeds=4]
//        [--steps=400000] [--out=file.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THRESHOLDS as T, VISIONS, dist, lch } from './color.mjs';
import { OPTIONS, SCHEME_TOKENS, candidates } from './fit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const cfg = JSON.parse(fs.readFileSync(args.config, 'utf8'));
const scheme = args.scheme ?? 'light';
if (args.box !== undefined) OPTIONS.box = +args.box;   // --box=1: also require fills within one byte (what-if)
for (const [k, v] of Object.entries(cfg.solverLimits ?? {})) T[k] = v;   // the same solver margins as fit.mjs
const tokens = { ...SCHEME_TOKENS[scheme], ...(cfg.tokens?.[scheme] ?? {}) };
const hueClip = +(args.hueClip ?? cfg.hueClip ?? T.hueMatch - 2);
const lightSet = args.light ? args.light.split(',') : null;
if (scheme === 'dark' && !lightSet) throw new Error('--light=#…,… is required for the dark scheme');
const clips = lightSet ? lightSet.map((h, k) => ({ h: lch(h)[2], max: cfg.slots[k].neutral ? T.hueMatch - 2 : hueClip })) : null;
// A neutral's hue is barely defined, so its dark box is centred on the light result's hue rather than its own target.
const centred = (s, k) => (s.neutral && clips?.[k] ? { target: [s[scheme].target[0], s[scheme].target[1], clips[k].h] } : {});
const domains = cfg.slots.map((s, k) => candidates(k, { ...s[scheme], neutral: !!s.neutral, ...centred(s, k) }, tokens, clips?.[k]));
// --start=#…,… begins from a given palette (each color is added to its slot's grid, priced by that slot's target);
// with it, the walk keeps every accepted state feasible once it is, so it moves along the feasible region.
const start = args.start ? args.start.split(',') : null;
const startIndex = start ? start.map((hex, k) => {
  const [l, c, h] = lch(hex), box = cfg.slots[k][scheme];
  const one = candidates(k, { ...box, neutral: !!cfg.slots[k].neutral, L: [l, l], C: [c, c], hr: 0, target: box.target, step: [1, 1, 1], at: h }, tokens, null, hex);
  if (!one.length) throw new Error(`start color ${hex} fails on its own (contrast or tokens)`);
  domains[k].push(one[0]);
  return domains[k].length - 1;
}) : null;
console.log(scheme, 'domains', domains.map(d => d.length).join(' '));
const n = domains.length;

const short = (d, limit) => (d < limit ? limit - d : 0);
function fillShort(fa, fb) {
  const c = dist(fa.centre, fb.centre);
  let s = short(dist(fa.ideal, fb.ideal), T.composite) + short(c, T.composite) + short(dist(fa.floor, fb.floor), T.composite);
  if (!OPTIONS.box || c - fa.radius - fb.radius >= T.composite) return s;
  let m = Infinity;
  for (const p of fa.box) for (const q of fb.box) { const d = dist(p, q); if (d < m) m = d; }
  return s + short(m, T.composite);
}
function violation(i, a, j, b) {
  const limit = i < 4 && j < 4 ? T.prefix4 : T.minDelta;
  let s = 0;
  for (let v = 0; v < VISIONS.length; v++) s += short(dist(a.labs[v], b.labs[v]), limit) + short(dist(a.labsBytes[v], b.labsBytes[v]), limit);
  if (Math.abs(i - j) === 1) for (let k = 0; k < T.alphas.length; k++) s += fillShort(a.fills[k], b.fills[k]);
  return s;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function run(seed, steps) {
  const r = rng(seed);
  const pick = k => domains[k][Math.floor(r() * domains[k].length)];
  let state = startIndex ? startIndex.map((i, k) => domains[k][i]) : domains.map((d, k) => pick(k));
  const V = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) V[i][j] = V[j][i] = violation(i, state[i], j, state[j]);
  let viol = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) viol += V[i][j];
  let cost = state.reduce((a, x) => a + x.cost, 0);
  let best = null;
  for (let step = 0; step < steps; step++) {
    const Tm = 2 * Math.pow(1e-3, step / steps);
    const k = Math.floor(r() * n), x = pick(k);
    let dv = 0; const row = new Array(n).fill(0);
    for (let j = 0; j < n; j++) if (j !== k) { row[j] = violation(k, x, j, state[j]); dv += row[j] - V[k][j]; }
    const dc = x.cost - state[k].cost, dScore = 100 * dv + dc;
    if (startIndex && viol < 1e-12 && viol + dv > 1e-12) continue;   // stay feasible once feasible
    if (dScore <= 0 || r() < Math.exp(-dScore / Tm)) {
      state[k] = x; viol += dv; cost += dc;
      for (let j = 0; j < n; j++) if (j !== k) V[k][j] = V[j][k] = row[j];
      if (viol < 1e-12 && (!best || cost < best.cost)) best = { cost, hex: state.map(s => s.hex) };
    }
  }
  const worst = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (V[i][j] > 0) worst.push(`${i + 1}-${j + 1}:${V[i][j].toFixed(4)}`);
  return { best, finalViolation: viol, worst: worst.join(' '), final: state.map(s => s.hex) };
}

const seeds = +(args.seeds ?? 4), steps = +(args.steps ?? 400000), first = +(args.seed ?? 1), results = [];
for (let s = first; s < first + seeds; s++) {
  const { best, finalViolation, worst, final } = run(s * 7919 + 13, steps);
  console.log('seed', s, best ? `feasible, cost ${best.cost.toFixed(2)}: ${best.hex.join(' ')}` : `no feasible palette (final violation ${finalViolation.toFixed(4)}; short pairs ${worst}; ${final.join(' ')})`);
  if (best) results.push({ seed: s, ...best });
}
results.sort((a, b) => a.cost - b.cost);
const out = { config: path.basename(args.config, '.json'), scheme, light: lightSet, results };
fs.writeFileSync(args.out ?? path.join(here, 'candidates', `anneal-${out.config}-${scheme}.json`), JSON.stringify(out, null, 1) + '\n');
