/**
 * Runnable examples: files in apps/docs/examples, each one a complete program a reader can copy.
 *
 * - `name.ts`: a module that imports from 'axylo' and draws into elements it names by id, as in
 *   `line('#chart', …)`. Its host is a page with one empty <div> per id, and a bundler (or an import map)
 *   that resolves `axylo`.
 * - `name.html`: the body of a page: markup and scripts. A module script imports `axylo` by name, so its
 *   page needs a bundler or an import map; a classic script uses the `Axylo` global of the script-tag file.
 * - `_name.ts`: a helper module shared by examples (the Phase 1 fixtures), not an example.
 *
 * What an example promises is written in its own comments, in words the reader sees too:
 * - "Raises AX111 on purpose" (or "Raises AX102, AX103 and AX106 on purpose") lists the diagnostics it
 *   demonstrates; the browser test fails on any other code, and on a listed code that does not appear.
 * - "Draws no marks on purpose" marks an example whose charts show a state (loading, empty, error) instead.
 */
import fs from 'node:fs';
import path from 'node:path';

export const docsRoot = path.resolve(import.meta.dirname, '..');
export const repoRoot = path.resolve(docsRoot, '../..');
export const examplesDir = path.join(docsRoot, 'examples');
/** Generated inputs that are not the site: the packed consumer and compiler probes. Git-ignored. */
export const cacheDir = path.join(docsRoot, '.cache');

const CHART_CALL = /\b(?:line|area|bar|histogram|scatter|donut)\(\s*(['"])#([\w-]+)\1|getElementById\(\s*(['"])([\w-]+)\3\s*\)/g;
const RAISES = /Raises ((?:AX\d{3})(?:(?:, | and )AX\d{3})*) on purpose/;
const NO_MARKS = /Draws no marks on purpose/;
export const MODULE_SCRIPT = /<script type="module">([\s\S]*?)<\/script>/g;
export const CLASSIC_SCRIPT = /<script>([\s\S]*?)<\/script>/g;
const HELPER_IMPORT = /from '\.\/(_[\w-]+)'/g;

/**
 * The first-chart snippets of the repository (examples/first-chart, maintained with the distribution tests)
 * also run on the site, under these names, so the Getting started page shows them live beside their source.
 */
export const EXTERNAL = [
  { name: 'first-chart-npm', path: 'examples/first-chart/npm.ts' },
  { name: 'first-chart-script', path: 'examples/first-chart/script.html' },
];

export function listExamples() {
  const own = fs.readdirSync(examplesDir)
    .filter(file => /\.(ts|html)$/.test(file) && !file.endsWith('.d.ts') && !file.startsWith('_'))
    .sort()
    .map(file => readExample(file));
  const external = EXTERNAL.filter(e => fs.existsSync(path.join(repoRoot, e.path)))
    .map(e => readExample(path.basename(e.path), path.join(repoRoot, path.dirname(e.path)), e.name));
  return [...external, ...own];
}

/** Helper modules (`_name.ts`) the examples import. */
export function listHelpers() {
  return fs.readdirSync(examplesDir).filter(file => /^_[\w-]+\.ts$/.test(file)).sort();
}

export function readExample(file, dir = examplesDir, as = null) {
  const ext = path.extname(file).slice(1);
  const name = as ?? path.basename(file, path.extname(file));
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  const repoFile = path.relative(repoRoot, path.join(dir, file)).split(path.sep).join('/');
  // The script-tag snippet is a whole document that loads the package from a CDN.
  const documentPage = ext === 'html' && /^<!doctype html>/i.test(source.trimStart());
  const raises = RAISES.exec(source)?.[1].split(/, | and /) ?? [];
  const targets = ext === 'ts' ? [...new Set([...source.matchAll(CHART_CALL)].map(m => m[2] ?? m[4]))] : [];
  if (ext === 'ts' && targets.length === 0) throw new Error(`${file}: no chart call with a '#id' target, and no getElementById('id')`);
  const helpers = [...new Set([...source.matchAll(HELPER_IMPORT)].map(m => `${m[1]}.ts`))];
  for (const helper of helpers) if (!fs.existsSync(path.join(examplesDir, helper))) throw new Error(`${file}: imports ${helper}, which does not exist`);
  const scriptTag = ext === 'html' && /<script src="[^"]*axylo\.iife(?:\.min)?\.js"><\/script>/.test(source);
  return { file, name, ext, source, repoFile, raises, noMarks: NO_MARKS.test(source), targets, helpers, scriptTag, documentPage };
}

/** The scripts of an .html example, in order, with the line each starts on. */
export function htmlScripts(example) {
  const out = [];
  let n = 0;
  for (const m of example.source.matchAll(MODULE_SCRIPT)) {
    out.push({ kind: 'module', file: `${example.name}.${++n}.js`, line: lineOf(example.source, m.index), code: m[1], match: m[0] });
  }
  for (const m of example.source.matchAll(CLASSIC_SCRIPT)) {
    out.push({ kind: 'classic', file: `${example.name}.${++n}.classic.js`, line: lineOf(example.source, m.index), code: m[1], match: m[0] });
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

/** What a reader must supply around an example to run it on their own page. */
export function hostOf(example) {
  if (example.documentPage) {
    return { markup: null, text: 'A whole page. Its two URLs point at jsDelivr, which serves published npm packages. Axylo is not published yet, so this site serves the page with those two files taken from the packed package, and adds its own stylesheet (for the font and colours of the frame) and the script that sizes the frame.' };
  }
  if (example.ext === 'ts') {
    return {
      markup: example.targets.map(id => `<div id="${id}"></div>`).join('\n'),
      text: `The page needs ${example.targets.length === 1 ? 'an element' : 'elements'} with ${example.targets.map(id => `id "${id}"`).join(', ')}, and a bundler (or an import map) that resolves the \`axylo\` package.`,
    };
  }
  if (example.scriptTag) {
    return { markup: null, text: 'This is the body of a page. It loads `axylo.iife.js` from the same folder: copy that file from `node_modules/axylo/dist/`.' };
  }
  return { markup: null, text: 'This is the body of a page. Its module script imports `axylo` by name, so the page needs a bundler or an import map that resolves it.' };
}

/**
 * Copies the examples into the packed consumer's `src`, so that they resolve `axylo` from the installed
 * tarball: .ts files and helpers as they are; each script of an .html example as
 * a .js file (classic scripts get `export {}` for a scope of their own, and a declaration of the `Axylo`
 * global from the package's own types); the Node examples under `src/node`.
 */
export function writeConsumerSources(consumerDir) {
  const src = path.join(consumerDir, 'src');
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(path.join(src, 'node'), { recursive: true });
  for (const e of listExamples().filter(e => e.ext !== 'html')) {
    fs.writeFileSync(path.join(src, `${e.name}.${e.ext}`), e.source);
  }
  for (const file of listHelpers()) fs.copyFileSync(path.join(examplesDir, file), path.join(src, file));
  fs.writeFileSync(path.join(src, 'globals.d.ts'), "declare const Axylo: typeof import('axylo');\n");
  const scripts = {};
  for (const example of listExamples().filter(e => e.ext === 'html')) {
    for (const script of htmlScripts(example)) {
      fs.writeFileSync(path.join(src, script.file), script.kind === 'classic' ? script.code + '\nexport {};\n' : script.code);
      scripts[script.file] = { example: example.file, line: script.line, kind: script.kind };
    }
  }
  for (const file of fs.readdirSync(path.join(examplesDir, 'node')).filter(f => /\.(ts|mjs)$/.test(f))) {
    fs.copyFileSync(path.join(examplesDir, 'node', file), path.join(src, 'node', file));
  }
  return { src, scripts };
}
