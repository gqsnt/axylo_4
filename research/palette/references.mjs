// Scores five categorical palettes that ship in d3-scale-chromatic as installed in this repository
// (research/harness/node_modules), with the same measures as the decision: contrast on #ffffff and #16181d, and the
// smallest pairwise OKLab difference of the first eight under normal vision and the three simulations. The arrays
// are read from the installed file, not typed in. Writes research/palette/references.json.
//
//   node research/palette/references.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VISIONS, contrast, minPair } from './color.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '../harness/node_modules/d3-scale-chromatic');
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
const src = fs.readFileSync(path.join(pkg, 'dist/d3-scale-chromatic.mjs'), 'utf8');
const read = name => {
  const m = src.match(new RegExp(`var ${name} = colors\\("([0-9a-f]+)"\\);`));
  if (!m) throw new Error(`${name} not found in d3-scale-chromatic ${version}`);
  return m[1].match(/.{6}/g).map(h => '#' + h);
};
const out = { source: `d3-scale-chromatic ${version}, dist/d3-scale-chromatic.mjs`, palettes: {} };
for (const [label, name] of [['schemeTableau10', 'Tableau10'], ['schemeObservable10', 'observable10'], ['schemeCategory10', 'category10'], ['schemeDark2', 'Dark2'], ['schemeSet1', 'Set1']]) {
  const colors = read(name), first8 = colors.slice(0, 8);
  out.palettes[label] = {
    colors,
    belowThreeToOneOnWhite: colors.filter(c => contrast(c, '#ffffff') < 3).length,
    belowThreeToOneOnDark: colors.filter(c => contrast(c, '#16181d') < 3).length,
    contrastOnWhite: colors.map(c => +contrast(c, '#ffffff').toFixed(2)),
    first8MinDelta: Object.fromEntries(VISIONS.map(v => { const m = minPair(first8, v); return [v, { min: +m.min.toFixed(3), pair: m.pair.map(i => i + 1) }]; })),
  };
  console.log(label, JSON.stringify(out.palettes[label]));
}
fs.writeFileSync(path.join(here, 'references.json'), JSON.stringify(out, null, 1) + '\n');
