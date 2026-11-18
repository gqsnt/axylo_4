// Builds the documentation site into apps/docs/dist. Needs the library built first (`npm run build`).
// Usage: node apps/docs/build.mjs [--unchecked-library]
//
// --unchecked-library builds even when packages/axylo/dist is not the build of its current source, into
// apps/docs/.cache/unchecked-site, with every page saying so. It is for checking pages while a rebuild of the
// library is pending; it never replaces apps/docs/dist.
import { buildSite } from './lib/site.mjs';

const args = process.argv.slice(2);
const unknown = args.filter(a => a !== '--unchecked-library');
if (unknown.length) throw new Error(`unknown argument ${unknown[0]} (usage: node apps/docs/build.mjs [--unchecked-library])`);
const started = Date.now();
const result = await buildSite({ log: message => console.warn(message), uncheckedLibrary: args.includes('--unchecked-library') });
const words = result.pages.reduce((sum, p) => sum + p.words, 0);
console.log(`built ${result.pages.length} pages (${words} words), ${result.diagnostics} diagnostic pages and ${result.examples.length} examples in ${Date.now() - started} ms, into ${result.outDir}`);
for (const p of result.pages) console.log(`  ${p.page.padEnd(18)} ${String(p.words).padStart(5)} words`);
if (result.unchecked.length) console.log(`NOT FOR PUBLISHING: built against a packed library that is not the build of its source (${result.unchecked.length} differences).`);
