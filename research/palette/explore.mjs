// Which hue families, and which orders of them, can meet the hard constraints of decision 0003 at all?
// Uses the grid and branch-and-bound search of fit.mjs on the light scheme, which is the tighter one.
//
//   node research/palette/explore.mjs sets [--part=0 --parts=1]
//       Every set of eight families (blue plus seven of POOL) that has an orange, a purple, a green or teal and a
//       red, pink or magenta: can the eight be placed at least 0.10 apart under all four visions, with 3:1 on white
//       and clear of the tokens? (No order yet: no prefix or neighbour constraints.)
//   node research/palette/explore.mjs orders --set=blue,orange,... [--part=0 --parts=1 --seconds=1]
//       Every order of a set with blue first. Orders whose first four cannot reach 0.14 are skipped; the others get
//       the full search (prefixes and neighbour composites included) with a time limit.
//
// Prints one line per set or order: OK with the cost and colors of the cheapest palette found, "no" when the
// search proved that none exists on the grid, "??" when it ran out of time without either.
import { candidates, compatible, search, SCHEME_TOKENS } from './fit.mjs';
import { THRESHOLDS as T, dist } from './color.mjs';

const args = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
const mode = process.argv[2], part = +(args.part ?? 0), parts = +(args.parts ?? 1);
const tokens = SCHEME_TOKENS.light, LW = [0.38, 0.70];

// Target and box per family, light scheme. Targets are where a designer would put the color if nothing else
// mattered; the boxes are wide so that the search, not the target, decides what is possible.
export const POOL = {
  blue: { target: [0.63, 0.14, 252], L: [0.58, 0.70], C: [0.10, 0.17], hr: 10 },
  orange: { target: [0.64, 0.15, 52], L: LW, C: [0.10, 0.18], hr: 10 },
  green: { target: [0.50, 0.12, 145], L: LW, C: [0.08, 0.16], hr: 14 },
  teal: { target: [0.55, 0.10, 185], L: LW, C: [0.07, 0.14], hr: 15 },
  cyan: { target: [0.60, 0.11, 222], L: LW, C: [0.07, 0.15], hr: 12 },
  red: { target: [0.55, 0.15, 25], L: LW, C: [0.10, 0.18], hr: 10 },
  pink: { target: [0.60, 0.14, 0], L: LW, C: [0.09, 0.17], hr: 10 },
  magenta: { target: [0.50, 0.15, 335], L: LW, C: [0.10, 0.18], hr: 12 },
  purple: { target: [0.52, 0.15, 300], L: LW, C: [0.10, 0.18], hr: 12 },
  gold: { target: [0.62, 0.12, 82], L: LW, C: [0.07, 0.15], hr: 12 },
  brown: { target: [0.48, 0.09, 58], L: LW, C: [0.05, 0.12], hr: 14 },
  slate: { target: [0.60, 0.03, 255], L: LW, C: [0.0, 0.045], hr: 35, neutral: true },
};
const domain = name => candidates(0, { ...POOL[name], step: [0.01, 0.01, 3] }, tokens, null);
const line = (r, names) => console.log(r.best ? 'OK ' : (r.complete ? 'no ' : '?? '), r.best ? r.cost.toFixed(2).padStart(6) : '     -', names.join(','), r.best ? r.best.map(x => x.hex).join(' ') : '', r.best && !r.complete ? '(best within time limit)' : '');

if (mode === 'sets') {
  const doms = Object.fromEntries(Object.keys(POOL).map(k => [k, domain(k)]));
  const uniform = (i, a, j, b) => { for (let v = 0; v < 4; v++) if (dist(a.labs[v], b.labs[v]) < T.minDelta) return false; return true; };
  const others = Object.keys(POOL).filter(k => k !== 'blue'), combos = [];
  const pick = (start, acc) => { if (acc.length === 7) { combos.push(acc.slice()); return; } for (let i = start; i < others.length; i++) { acc.push(others[i]); pick(i + 1, acc); acc.pop(); } };
  pick(0, []);
  const required = c => c.includes('orange') && c.includes('purple') && (c.includes('green') || c.includes('teal')) && (c.includes('red') || c.includes('pink') || c.includes('magenta'));
  combos.filter(required).forEach((c, i) => {
    if (i % parts !== part) return;
    const fams = ['blue', ...c];
    line(search(fams.map(f => doms[f]), +(args.seconds ?? 3), uniform), fams);
  });
} else if (mode === 'orders') {
  const fams = args.set.split(','), doms = Object.fromEntries(fams.map(k => [k, domain(k)]));
  const four = (i, a, j, b) => { for (let v = 0; v < 4; v++) if (dist(a.labs[v], b.labs[v]) < T.prefix4) return false; return true; };
  const firstFour = new Map(), perms = [];
  const permute = (a, k = 0) => { if (k === a.length) { perms.push(a.slice()); return; } for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; permute(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; } };
  permute(fams.slice(1));
  for (let p = part; p < perms.length; p += parts) {
    const order = [fams[0], ...perms[p]], key = order.slice(0, 4).sort().join();
    if (!firstFour.has(key)) firstFour.set(key, !!search(order.slice(0, 4).map(f => doms[f]), 2, four).best);
    if (!firstFour.get(key)) continue;
    const r = search(order.map(f => doms[f]), +(args.seconds ?? 1), compatible);
    if (r.best) line(r, order);
  }
  console.error(`first-four sets that reach 0.14: ${[...firstFour].filter(([, v]) => v).map(([k]) => k).join(' | ')}`);
} else {
  console.error('usage: explore.mjs sets | orders --set=a,b,...');
  process.exitCode = 2;
}
