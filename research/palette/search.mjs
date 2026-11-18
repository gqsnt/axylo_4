// Feasibility search: how far apart can N categorical colors be, under normal vision and three simulated
// color-vision deficiencies, if every color must also reach 3:1 contrast against the chart background?
// Deterministic simulated annealing in OKLCH. Output is a starting point for Axylo's palette, not a final design.
import fs from 'node:fs';
const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gam = v => v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
const toLab = ([r, g, b]) => { const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; };
const fromLch = ([L, C, h]) => { const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]; };
const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const hex = rgb => '#' + rgb.map(v => Math.round(255 * gam(Math.min(1, Math.max(0, v)))).toString(16).padStart(2, '0')).join('');
const unhex = h => [1, 3, 5].map(i => lin(parseInt(h.slice(i, i + 2), 16) / 255));
const CVD = { normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]] };
const sim = (rgb, M) => toLab(M.map(row => Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))));
export const minDelta = rgbs => { const out = {}; for (const [k, M] of Object.entries(CVD)) { const labs = rgbs.map(c => sim(c, M)); let m = Infinity;
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) m = Math.min(m, Math.hypot(labs[i][0] - labs[j][0], labs[i][1] - labs[j][1], labs[i][2] - labs[j][2])); out[k] = m; } return out; };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// `pleasant` keeps colors in a usable band: no near-black, no near-gray.
function search(n, bgHex, seed, pleasant) {
  const bg = unhex(bgHex), r = rng(seed);
  const [lo, hi] = lum(bg) > 0.5 ? [0.42, 0.74] : [0.55, 0.88];
  const ok = lch => { if (pleasant && (lch[0] < lo || lch[0] > hi || lch[1] < 0.09)) return false; const c = fromLch(lch); return inGamut(c) && contrast(c, bg) >= 3.0; };
  const rand = () => { for (;;) { const c = [0.25 + r() * 0.7, 0.04 + r() * 0.2, r() * 2 * Math.PI]; if (ok(c)) return c; } };
  const score = p => Math.min(...Object.values(minDelta(p.map(fromLch))));
  let cur = Array.from({ length: n }, rand), curS = score(cur), best = cur, bestS = curS;
  const steps = 60000;
  for (let i = 0; i < steps; i++) {
    const T = 0.02 * (1 - i / steps), k = Math.floor(r() * n), next = cur.slice();
    const c = [cur[k][0] + (r() - 0.5) * 0.12, Math.max(0.02, cur[k][1] + (r() - 0.5) * 0.06), cur[k][2] + (r() - 0.5) * 0.8];
    if (!ok(c)) continue;
    next[k] = c; const s = score(next);
    if (s > curS || r() < Math.exp((s - curS) / Math.max(T, 1e-6))) { cur = next; curS = s; if (s > bestS) { best = next; bestS = s; } }
  }
  return { colors: best.map(c => hex(fromLch(c))), min: bestS };
}

const result = {};
for (const pleasant of [false, true]) for (const [theme, bg] of [['light', '#ffffff'], ['dark', '#16181d']]) for (const n of [6, 8]) {
  let best = null;
  for (let seed = 1; seed <= 6; seed++) { const s = search(n, bg, seed * 101 + n, pleasant); if (!best || s.min > best.min) best = s; }
  const rgbs = best.colors.map(unhex), d = minDelta(rgbs);
  result[`${pleasant ? 'usable' : 'unconstrained'}-${theme}-${n}`] = { background: bg, colors: best.colors, contrast: rgbs.map(c => +contrast(c, unhex(bg)).toFixed(2)), minDelta: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, +v.toFixed(3)])) };
  console.log(pleasant ? 'usable' : 'unconstrained', theme, n, JSON.stringify(result[`${pleasant ? 'usable' : 'unconstrained'}-${theme}-${n}`]));
}
fs.writeFileSync('feasibility.json', JSON.stringify(result, null, 1));
