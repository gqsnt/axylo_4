// Nearest feasible palette to a hand-designed target (decision 0003). Plain Node, no dependencies.
//
// The designer writes a target color per slot in OKLCH and a box around it (lightness, chroma, hue ranges) for
// each scheme (configs/fit-*.json). This script lays a grid over each box (8-bit-rounded hex, so what is scored is
// what ships), drops grid colors that fail on their own (contrast, gamut, distance to the focus, reference and
// muted tokens), and then runs a branch-and-bound search over slots with forward checking on the pairwise
// constraints (minimum OKLab difference under four visions, 0.14 inside the first four; neighbour composites at
// 25% and 80%). The cost is the weighted squared distance from the target, so the result is the feasible palette
// closest to what was asked for, on that grid. Pairwise differences are required both analytically and after the
// simulated colors are rounded to bytes; fills both ideally and on an 8-bit raster, at the worst case within one
// byte per channel. The light scheme is solved first; the dark scheme's hue boxes are then clipped to within
// `hueClip` degrees of the light result per slot (default 28, under constraint 4's 30).
//
//   node research/palette/fit.mjs --config=research/palette/configs/fit-x.json [--seconds=60] [--out=file.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPTIONS, THRESHOLDS as T, TOKEN_NAMES, VISIONS, byteBox, compositeLinear, contrast, dist, hueDiff, labOfBytes, labUnder, labUnderBytes, lch, lchToHex, oklab, rasterFill } from './color.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SCHEME_TOKENS = {
  light: { background: '#ffffff', focus: '#1f5fcc', reference: '#474b55', muted: '#62666f' },
  dark: { background: '#16181d', focus: '#79a8ff', reference: '#bcc0c9', muted: '#9da2ad' },
};

// Solver-only margins, stricter than the tests: contrast at least 3.02:1, so a contrast computed with slightly
// different rounding still passes; translucent fills checked at the worst case within one byte per channel of the
// byte model when OPTIONS.box is 1 (--box=1), because rasterizers round alpha and channels differently; by default
// both byte models (alpha rounded and floored) are required and the one-byte worst case is only recorded.
const CONTRAST_MARGIN = 0.02;
export { OPTIONS };

export function candidates(slot, box, tokens, hueClip, exactHex = null) {
  const out = new Map();
  const [tL, tC, tH] = box.target, [wL, wC, wH] = box.weights ?? [1, 1, 1];
  const step = box.step ?? [0.01, 0.01, 2];
  for (let L = box.L[0]; L <= box.L[1] + 1e-9; L += step[0])
    for (let C = box.C[0]; C <= box.C[1] + 1e-9; C += step[1])
      for (let dh = -box.hr; dh <= box.hr + 1e-9; dh += step[2]) {
        const hex = exactHex ?? lchToHex([L, C, (tH + dh + 360) % 360]);   // exactHex: price one given color
        if (!hex || out.has(hex)) continue;
        if (contrast(hex, tokens.background) < T.contrast + CONTRAST_MARGIN) continue;
        const labs = VISIONS.map(v => labUnder(hex, v));
        if (TOKEN_NAMES.some(t => dist(labs[0], labUnder(tokens[t], 'normal')) < T.token)) continue;
        const [l, c, h] = lch(hex);
        if (hueClip && hueDiff(h, hueClip.h) > hueClip.max) continue;
        const cost = wL * ((l - tL) / 0.05) ** 2 + wC * ((c - tC) / 0.03) ** 2 + (box.neutral ? 0 : wH * (hueDiff(h, tH) / 10) ** 2);
        const labsBytes = VISIONS.map(v => labUnderBytes(hex, v));
        // Fills: ideal composite, byte-model pixel, and the lattice within OPTIONS.box bytes of it with its radius.
        const fills = T.alphas.map(a => {
          const px = rasterFill(hex, a, tokens.background), centre = labOfBytes(px);
          const floor = labOfBytes(rasterFill(hex, a, tokens.background, Math.floor));
          const box = byteBox(px, OPTIONS.box).map(labOfBytes);
          return { ideal: oklab(compositeLinear(hex, a, tokens.background)), centre, floor, box, radius: Math.max(...box.map(q => dist(q, centre))) };
        });
        out.set(hex, { hex, labs, labsBytes, fills, cost, lch: [l, c, h] });
      }
  return [...out.values()].sort((a, b) => a.cost - b.cost);
}

/** Worst-case distance between two fills' byte lattices: exact only when the cheap triangle bound is not enough. */
function fillsApart(fa, fb) {
  if (dist(fa.ideal, fb.ideal) < T.composite) return false;
  const c = dist(fa.centre, fb.centre);
  if (c < T.composite || dist(fa.floor, fb.floor) < T.composite) return false;   // both byte models
  if (!OPTIONS.box) return true;
  if (c - fa.radius - fb.radius >= T.composite) return true;
  if (c < T.composite) return false;
  for (const p of fa.box) for (const q of fb.box) if (dist(p, q) < T.composite) return false;
  return true;
}

export function compatible(i, a, j, b) {
  const limit = i < 4 && j < 4 ? T.prefix4 : T.minDelta;
  for (let v = 0; v < VISIONS.length; v++) {
    if (dist(a.labs[v], b.labs[v]) < limit) return false;               // analytic (constraint 2, 3)
    if (dist(a.labsBytes[v], b.labsBytes[v]) < limit) return false;     // after rounding the simulation to bytes
  }
  if (Math.abs(i - j) === 1) for (let k = 0; k < T.alphas.length; k++) if (!fillsApart(a.fills[k], b.fills[k])) return false;
  return true;
}

/**
 * Branch and bound with forward checking. Returns the cheapest assignment found within the time limit.
 * With restarts > 1, the first half of the time goes to the exact cost-ordered search and the rest is split
 * between restarts that try values in a jittered cost order (seeded, so runs repeat), sharing the best bound.
 * Only the first pass can prove that nothing exists; `complete` reports whether it finished.
 */
export function search(domains, seconds, compat = compatible, restarts = 1) {
  const n = domains.length, start = Date.now();
  let best = null, bestCost = Infinity, nodes = 0, complete = true, deadline = 0;
  const assigned = new Array(n).fill(null);
  const minCost = d => { let m = Infinity; for (const x of d) if (x.cost < m) m = x.cost; return m; };
  function recurse(doms, mins, cost, sorted) {
    if (Date.now() > deadline) return false;
    nodes++;
    let pick = -1;   // most constrained unassigned slot first
    for (let s = 0; s < n; s++) if (assigned[s] === null && (pick < 0 || doms[s].length < doms[pick].length)) pick = s;
    if (pick < 0) { if (cost < bestCost) { bestCost = cost; best = assigned.slice(); } return true; }
    let bound = cost;
    for (let s = 0; s < n; s++) if (assigned[s] === null) bound += mins[s];
    if (bound >= bestCost) return true;
    for (const cand of doms[pick]) {
      const rest = bound - mins[pick] + cand.cost;
      if (rest >= bestCost) { if (sorted) break; continue; }
      assigned[pick] = cand;
      const next = doms.slice(), nextMins = mins.slice();
      let ok = true, nb = cost + cand.cost;
      for (let s = 0; s < n && ok; s++) {
        if (assigned[s] !== null) continue;
        const f = doms[s].filter(x => compat(pick, cand, s, x));
        if (!f.length) ok = false; else { next[s] = f; nextMins[s] = sorted ? f[0].cost : minCost(f); nb += nextMins[s]; }
      }
      const finished = ok && nb < bestCost ? recurse(next, nextMins, cost + cand.cost, sorted) : true;
      assigned[pick] = null;
      if (!finished || Date.now() > deadline) return false;
    }
    return true;
  }
  const share = restarts > 1 ? 0.5 : 1;
  deadline = start + seconds * 1000 * share;
  complete = recurse(domains, domains.map(d => d[0]?.cost ?? Infinity), 0, true);
  let seed = 1;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let r = 1; r < restarts; r++) {
    deadline = start + seconds * 1000 * (share + (1 - share) * r / (restarts - 1));
    const jittered = domains.map(d => d.map(x => ({ x, k: x.cost * (0.5 + rand()) + rand() })).sort((a, b) => a.k - b.k).map(e => e.x));
    recurse(jittered, jittered.map(minCost), 0, false);
  }
  return { best, cost: bestCost, nodes, complete };
}

export function fitScheme(cfg, scheme, hueClips, seconds, step, restarts = 1) {
  const tokens = { ...SCHEME_TOKENS[scheme], ...(cfg.tokens?.[scheme] ?? {}) };   // a config may try other token colors
  // A neutral's hue is barely defined, so its dark box is centred on the light result's hue rather than its own target.
  const centred = (s, k) => (s.neutral && hueClips?.[k] ? { target: [s[scheme].target[0], s[scheme].target[1], hueClips[k].h] } : {});
  const domains = cfg.slots.map((s, k) => candidates(k, { ...s[scheme], neutral: !!s.neutral, ...centred(s, k), ...(step ? { step } : {}) }, tokens, hueClips?.[k]));
  const sizes = domains.map(d => d.length);
  if (sizes.some(x => x === 0)) return { scheme, sizes, best: null };
  const r = search(domains, seconds, compatible, restarts);
  return { scheme, sizes, ...r };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
  const cfg = JSON.parse(fs.readFileSync(args.config, 'utf8'));
  const seconds = +(args.seconds ?? 60);
  // What-if runs only: --minDelta=, --prefix4=, --composite=, --token= override a threshold for this run.
  // A config's solverLimits are margins the search keeps above the tested limits (fit-final.json); the command-line
  // overrides --minDelta=, --prefix4=, --composite=, --token= are for what-if runs.
  for (const [k, v] of Object.entries(cfg.solverLimits ?? {})) { T[k] = v; console.log(`solver limit ${k} = ${v}`); }
  for (const k of ['minDelta', 'prefix4', 'composite', 'token']) if (args[k]) { T[k] = +args[k]; console.log(`override ${k} = ${T[k]}`); }
  if (args.box !== undefined) { OPTIONS.box = +args.box; console.log(`fills checked within ${OPTIONS.box} byte(s)`); }
  const hueClip = +(args.hueClip ?? cfg.hueClip ?? T.hueMatch - 2);   // largest light/dark hue shift the dark search may use
  const step = args.step ? args.step.split(',').map(Number) : null;   // --step=L,C,h overrides every box's grid
  const restarts = +(args.restarts ?? 1);                              // --restarts=N: see search()
  // --light=#hex,... skips the light search and solves only the dark scheme against that light set.
  const fixed = args.light ? args.light.split(',') : null;
  const light = fixed
    ? { sizes: fixed.map(() => 1), nodes: 0, complete: true, cost: 0, best: fixed.map(hex => ({ hex, lch: lch(hex) })) }
    : fitScheme(cfg, 'light', null, seconds, step, restarts);
  console.log('light domains', light.sizes.join(' '), 'nodes', light.nodes, light.complete ? 'complete' : 'timed out', 'cost', light.cost?.toFixed?.(3));
  if (!light.best) { console.log('no light solution'); process.exit(1); }
  console.log('light', light.best.map(c => c.hex).join(' '));
  const clips = light.best.map((c, k) => ({ h: c.lch[2], max: cfg.slots[k].neutral ? T.hueMatch - 2 : hueClip })); // neutrals too: the test checks every slot
  const dark = fitScheme(cfg, 'dark', clips, seconds, step, restarts);
  console.log('dark domains', dark.sizes.join(' '), 'nodes', dark.nodes, dark.complete ? 'complete' : 'timed out', 'cost', dark.cost?.toFixed?.(3));
  if (!dark.best) { console.log('no dark solution'); process.exit(1); }
  console.log('dark', dark.best.map(c => c.hex).join(' '));
  const out = { config: path.basename(args.config, '.json'), light: light.best.map(c => c.hex), dark: dark.best.map(c => c.hex),
    lch: { light: light.best.map(c => c.lch.map(v => +v.toFixed(3))), dark: dark.best.map(c => c.lch.map(v => +v.toFixed(3))) },
    cost: { light: +light.cost.toFixed(3), dark: +dark.cost.toFixed(3) }, complete: { light: light.complete, dark: dark.complete } };
  fs.writeFileSync(args.out ?? path.join(here, 'candidates', `${out.config}.json`), JSON.stringify(out, null, 1) + '\n');
}
