// Scores the palette that ships (packages/axylo/src/theme/palette.ts) against the hard constraints of decision
// 0003 and writes the record the decision quotes, research/palette/palette.json. The unit test
// (packages/axylo/test/theme/palette.test.ts) recomputes the measured fields with its own code and compares them at
// the precision written here.
//
// Two browser measurements are folded in when they describe exactly the shipped colors and backgrounds, and are
// refused otherwise: strokes.json (strokes.mjs, 2 px lines) and raster.json (raster.mjs, translucent fills).
//
//   node research/palette/score.mjs [--md]     (--md also prints the tables of the decision record)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THRESHOLDS as T, TOKEN_NAMES, VISIONS, bytes, bytesToHex, checkScheme, dist, labOfBytes, lch, neighbourPairs } from './color.mjs';
import { readThemeFile } from './theme-file.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const md = process.argv.includes('--md');
const theme = readThemeFile();
const r3 = x => +x.toFixed(3);
const pair1 = p => p.map(i => i + 1);

/** Why a browser record does not describe the shipped palette, or null when it does. */
function mismatch(rec, name) {
  if (!rec?.schemes) return `${name}: no schemes`;
  for (const s of ['light', 'dark']) {
    const r = rec.schemes[s], t = theme[s];
    if (!r) return `${name}: no ${s} scheme`;
    if (r.background !== t.background) return `${name}: ${s} background ${r.background} is not ${t.background}`;
    const colors = r.series ?? r.rows?.map(x => x.color);
    if (JSON.stringify(colors) !== JSON.stringify(t.series)) return `${name}: ${s} colors ${JSON.stringify(colors)} are not the shipped ${JSON.stringify(t.series)}`;
  }
  return null;
}
const load = file => { const p = path.join(here, file); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
const strokes = load('strokes.json'), raster = load('raster.json');
const refused = [];
for (const [rec, name] of [[strokes, 'strokes.json'], [raster, 'raster.json']]) {
  const why = rec ? mismatch(rec, name) : `${name} missing`;
  if (why) refused.push(why);
}

const record = { thresholds: T, schemes: {} };
for (const [name, other] of [['light', 'dark'], ['dark', 'light']]) {
  const s = theme[name], { checks, measured: m } = checkScheme(s, theme[other]);
  const pairsOf = (map, n) => Object.fromEntries(VISIONS.map(v => [v, { min: r3(map[v].min), pair: pair1(map[v].pair) }]));
  const scheme = {
    background: s.background,
    tokens: Object.fromEntries(['axis', 'grid', 'muted', 'reference', 'focus'].map(k => [k, s[k]])),
    series: s.series.map((hex, k) => ({ slot: k + 1, hex, oklch: lch(hex).map((v, i) => +v.toFixed(i === 2 ? 1 : 3)), contrast: +m.contrast[k].toFixed(2), hueDiffToOtherScheme: +m.hue[k].toFixed(1) })),
    minDelta: pairsOf(m.full),
    prefixes: Object.fromEntries(T.prefixes.map(n => [n, pairsOf(m.prefixes[n])])),
    minDeltaBytes: pairsOf(m.fullBytes),
    prefixesBytes: Object.fromEntries(T.prefixes.map(n => [n, pairsOf(m.prefixesBytes[n])])),
    tokenDistance: Object.fromEntries(TOKEN_NAMES.map(t => [t, { min: r3(m.tokens[t].min), slot: m.tokens[t].slot + 1 }])),
    composites: Object.fromEntries(T.alphas.map(a => [a, Object.fromEntries(VISIONS.map(v => [v, {
      minNeighbour: r3(m.composites[a][v].minNeighbour.d), pair: pair1(m.composites[a][v].minNeighbour.pair),
      neighbours: m.composites[a][v].neighbours.map(x => r3(x.d)),
      ringClosures: m.composites[a][v].ring.map(x => ({ slots: [x.pair[0] + 1, 1], d: r3(x.d) })),
    }]))])),
    raster: Object.fromEntries(T.alphas.map(a => [a, {
      model: m.raster[a].pixels, modelFloor: m.raster[a].pixelsFloor,
      neighboursModel: m.raster[a].neighbours.map(x => r3(x.model)),
      neighboursWorstWithinOneByte: m.raster[a].neighbours.map(x => r3(x.worst)),
      minModel: r3(m.raster[a].minModel), minWorstWithinOneByte: r3(m.raster[a].minWorst),
    }])),
    checks: checks.map(c => ({ constraint: c.id, check: c.label, value: r3(c.value), limit: c.limit, ok: c.ok })),
  };
  if (raster && !mismatch(raster, 'raster.json')) {
    scheme.chromeRaster = Object.fromEntries(Object.entries(raster.schemes[name].pixels).map(([via, byAlpha]) => [via, Object.fromEntries(Object.entries(byAlpha).map(([a, px]) => {
      const nb = neighbourPairs(px.length).map(([i, j]) => dist(labOfBytes(bytes(px[i])), labOfBytes(bytes(px[j]))));
      return [a, { pixels: px, neighbours: nb.map(r3), min: r3(Math.min(...nb)) }];
    }))]));
    for (const [via, byAlpha] of Object.entries(scheme.chromeRaster)) for (const [a, x] of Object.entries(byAlpha)) {
      scheme.checks.push({ constraint: '6b', check: `min neighbour ΔE at ${+a * 100}%, Chrome ${via} pixels`, value: x.min, limit: T.composite, ok: x.min >= T.composite });
    }
  }
  // Evenness of weight: OKLab lightness range of the eight and of the first three, and the largest chroma.
  const Ls = s.series.map(h => lch(h)[0]), Cs = s.series.map(h => lch(h)[1]);
  scheme.lightness = { min: r3(Math.min(...Ls)), max: r3(Math.max(...Ls)), firstThreeSpread: r3(Math.max(...Ls.slice(0, 3)) - Math.min(...Ls.slice(0, 3))), maxChroma: r3(Math.max(...Cs)) };
  // The pairs that bind: every measured value within 5% of its limit, with its margin.
  scheme.tight = checks.filter(c => !c.upper && c.value < c.limit * 1.05).map(c => ({ check: c.label, value: r3(c.value), margin: r3(c.value - c.limit) }));
  record.schemes[name] = scheme;
}

// Sensitivity to a hand edit: every one-byte change of one channel of one color, and whether the scheme still meets
// every check above (analytic, byte-rounded and raster model). Measured, so the record says how fragile it is.
record.oneByteEdits = {};
for (const [name, other] of [['light', 'dark'], ['dark', 'light']]) {
  let total = 0, pass = 0;
  theme[name].series.forEach((hex, k) => {
    for (let ch = 0; ch < 3; ch++) for (const d of [-1, 1]) {
      const b = bytes(hex); b[ch] += d; if (b[ch] < 0 || b[ch] > 255) continue;
      const series = theme[name].series.slice(); series[k] = bytesToHex(b);
      const otherScheme = { ...theme[other] };
      total++; if (checkScheme({ ...theme[name], series }, otherScheme).checks.every(c => c.ok)) pass++;
    }
  });
  record.oneByteEdits[name] = { edits: total, stillMeetEveryCheck: pass };
}

if (strokes && !mismatch(strokes, 'strokes.json')) record.strokes = strokes;
record.refused = refused;
fs.writeFileSync(path.join(here, 'palette.json'), JSON.stringify(record, null, 1) + '\n');

for (const why of refused) console.log(`not folded in: ${why}`);
const failed = Object.values(record.schemes).flatMap(s => s.checks.filter(c => !c.ok));
console.log(failed.length ? `FAILED: ${failed.map(c => c.check).join('; ')}` : 'all hard constraints met');
if (md) {
  const L = record.schemes.light, D = record.schemes.dark, f = x => x.toFixed(3);
  const val = c => c.constraint === 1 ? c.value.toFixed(2) : c.constraint === 4 ? c.value.toFixed(1) : f(c.value);
  console.log('\n| Constraint | Check | Limit | Light | Dark |\n|---|---|---|---|---|');
  L.checks.forEach((c, i) => { const d = D.checks[i]; console.log(`| ${c.constraint} | ${c.check} | ${c.constraint === 4 ? '≤ ' : '≥ '}${c.limit} | ${val(c)} | ${val(d)} |`); });
  for (const [label, key, keyB] of [['analytic', 'prefixes', 'minDelta'], ['bytes', 'prefixesBytes', 'minDeltaBytes']]) {
    console.log(`\n| Prefix (${label}) | Vision | Light (pair) | Dark (pair) |\n|---|---|---|---|`);
    for (const n of T.prefixes) for (const v of VISIONS) console.log(`| first ${n} | ${v} | ${f(L[key][n][v].min)} (${L[key][n][v].pair.join('–')}) | ${f(D[key][n][v].min)} (${D[key][n][v].pair.join('–')}) |`);
    for (const v of VISIONS) console.log(`| all 8 | ${v} | ${f(L[keyB][v].min)} (${L[keyB][v].pair.join('–')}) | ${f(D[keyB][v].min)} (${D[keyB][v].pair.join('–')}) |`);
  }
  for (const s of ['light', 'dark']) { console.log(`\n${s} tight:`); for (const t of record.schemes[s].tight) console.log(`- ${t.check}: ${t.value} (margin ${t.margin})`); }
  console.log('\none-byte edits:', JSON.stringify(record.oneByteEdits));
  for (const s of ['light', 'dark']) console.log(s, 'lightness', JSON.stringify(record.schemes[s].lightness));
}
process.exitCode = failed.length ? 1 : 0;
