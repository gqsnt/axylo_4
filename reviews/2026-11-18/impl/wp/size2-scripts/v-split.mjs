// Option-name lists as one space-separated string each (pure-annotated split), instead of array literals.
import { regex, variant } from './lib.mjs';
const d = variant('opt-split');
const n = regex(d, 'data/options.ts', /\[((?:\s*'[A-Za-z]+',?)+)\s*\]/g, (m, body) => {
  const words = [...body.matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]);
  return words.length < 4 ? m : `/* @__PURE__ */ '${words.join(' ')}'.split(' ')`;
});
console.log('lists', n);
