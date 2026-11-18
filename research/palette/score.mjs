// Scores the palette that ships (packages/axylo/src/theme/palette.ts) against the hard constraints of decision
// 0003 and writes the record the decision quotes, research/palette/palette.json. The unit test
// (packages/axylo/test/theme/palette.test.ts) recomputes every value with its own code and compares.
//
//   node research/palette/score.mjs [--md]     (--md also prints the tables of the decision record)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THRESHOLDS as T, TOKEN_NAMES, VISIONS, checkScheme, lch } from './color.mjs';
import { readThemeFile } from './theme-file.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const md = process.argv.includes('--md');
const theme = readThemeFile();
const r3 = x => +x.toFixed(3);

const record = { thresholds: T, schemes: {} };
for (const [name, other] of [['light', 'dark'], ['dark', 'light']]) {
  const s = theme[name], { checks, measured: m } = checkScheme(s, theme[other]);
  record.schemes[name] = {
    background: s.background,
    tokens: Object.fromEntries(['axis', 'grid', 'muted', 'reference', 'focus'].map(k => [k, s[k]])),
    series: s.series.map((hex, k) => ({ slot: k + 1, hex, oklch: lch(hex).map((v, i) => +v.toFixed(i === 2 ? 1 : 3)), contrast: +m.contrast[k].toFixed(2), hueDiffToOtherScheme: +m.hue[k].toFixed(1) })),
    minDelta: Object.fromEntries(VISIONS.map(v => [v, { min: r3(m.full[v].min), pair: m.full[v].pair.map(i => i + 1) }])),
    prefixes: Object.fromEntries(T.prefixes.map(n => [n, Object.fromEntries(VISIONS.map(v => [v, { min: r3(m.prefixes[n][v].min), pair: m.prefixes[n][v].pair.map(i => i + 1) }]))])),
    tokenDistance: Object.fromEntries(TOKEN_NAMES.map(t => [t, { min: r3(m.tokens[t].min), slot: m.tokens[t].slot + 1 }])),
    composites: Object.fromEntries(T.alphas.map(a => [a, Object.fromEntries(VISIONS.map(v => [v, {
      minNeighbour: r3(m.composites[a][v].minNeighbour.d), pair: m.composites[a][v].minNeighbour.pair.map(i => i + 1),
      neighbours: m.composites[a][v].neighbours.map(x => r3(x.d)),
      ringClosures: m.composites[a][v].ring.map(x => ({ slots: [x.pair[0] + 1, 1], d: r3(x.d) })),
    }]))])),
    checks: checks.map(c => ({ constraint: c.id, check: c.label, value: r3(c.value), limit: c.limit, ok: c.ok })),
  };
}
const strokes = path.join(here, 'strokes.json');
if (fs.existsSync(strokes)) record.strokes = JSON.parse(fs.readFileSync(strokes, 'utf8'));
fs.writeFileSync(path.join(here, 'palette.json'), JSON.stringify(record, null, 1) + '\n');

const failed = Object.values(record.schemes).flatMap(s => s.checks.filter(c => !c.ok));
console.log(failed.length ? `FAILED: ${failed.map(c => c.check).join('; ')}` : 'all hard constraints met');
if (md) {
  const L = record.schemes.light, D = record.schemes.dark, f = x => x.toFixed(3);
  console.log('\n| Constraint | Check | Limit | Light | Dark |\n|---|---|---|---|---|');
  L.checks.forEach((c, i) => { const d = D.checks[i]; console.log(`| ${c.constraint} | ${c.check} | ${c.constraint === 4 ? '≤ ' : '≥ '}${c.limit} | ${c.constraint === 1 ? c.value.toFixed(2) : c.constraint === 4 ? c.value.toFixed(1) : f(c.value)} | ${d.constraint === 1 ? d.value.toFixed(2) : d.constraint === 4 ? d.value.toFixed(1) : f(d.value)} |`); });
  console.log('\n| Prefix | Vision | Light (pair) | Dark (pair) |\n|---|---|---|---|');
  for (const n of T.prefixes) for (const v of VISIONS) console.log(`| first ${n} | ${v} | ${f(L.prefixes[n][v].min)} (${L.prefixes[n][v].pair.join('–')}) | ${f(D.prefixes[n][v].min)} (${D.prefixes[n][v].pair.join('–')}) |`);
  for (const v of VISIONS) console.log(`| all 8 | ${v} | ${f(L.minDelta[v].min)} (${L.minDelta[v].pair.join('–')}) | ${f(D.minDelta[v].min)} (${D.minDelta[v].pair.join('–')}) |`);
}
process.exitCode = failed.length ? 1 : 0;
