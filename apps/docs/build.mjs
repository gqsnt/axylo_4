// Builds the documentation site into apps/docs/dist. Needs the library built first (`npm run build`).
// Usage: node apps/docs/build.mjs
import { buildSite } from './lib/site.mjs';

const started = Date.now();
const result = await buildSite({ log: message => console.warn(message) });
const words = result.pages.reduce((sum, p) => sum + p.words, 0);
console.log(`built ${result.pages.length} pages (${words} words), ${result.diagnostics} diagnostic pages and ${result.examples.length} examples in ${Date.now() - started} ms`);
for (const p of result.pages) console.log(`  ${p.page.padEnd(18)} ${String(p.words).padStart(5)} words`);
